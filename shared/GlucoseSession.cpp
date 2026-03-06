#include "GlucoseSession.h"
#include "json.hpp"

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <ctime>
#include <fstream>
#include <iomanip>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

using json = nlohmann::json;

namespace glucose {

// ─────────────────────────────────────────
//  Internal helpers
// ─────────────────────────────────────────

namespace {

static time_t portable_timegm_local(std::tm* t) {
#ifdef _WIN32
    char* old_tz = getenv("TZ");
    _putenv("TZ=UTC"); _tzset();
    time_t ret = mktime(t);
    if (old_tz) { std::string r = std::string("TZ=") + old_tz; _putenv(r.c_str()); }
    else        { _putenv("TZ="); }
    _tzset();
    return ret;
#else
    return timegm(t);
#endif
}

static int64_t parse_datetime_string(const std::string& s) {
    std::tm tm{};
    std::istringstream ss(s);
    ss >> std::get_time(&tm, "%Y-%m-%d %H:%M:%S");
    if (ss.fail())
        throw std::runtime_error("Invalid datetime string: " + s);
    return static_cast<int64_t>(portable_timegm_local(&tm));
}

// Accepts "YYYY-MM-DD HH:MM:SS", Unix seconds, or Unix nanoseconds
static int64_t parse_date_cell(const std::string& cell) {
    if (cell.find('-') != std::string::npos)
        return parse_datetime_string(cell);
    double v = std::stod(cell);
    if (v >= 1e12) v /= 1e9;   // nanoseconds → seconds
    return static_cast<int64_t>(v);
}

static std::vector<std::string> split_csv(const std::string& line) {
    std::vector<std::string> cells;
    std::stringstream ss(line);
    std::string cell;
    while (std::getline(ss, cell, ','))
        cells.push_back(cell);
    return cells;
}

static double cell_double(const std::vector<std::string>& cells,
                           size_t idx, const char* name) {
    if (idx >= cells.size())
        throw std::runtime_error(std::string("Missing field: ") + name);
    try { return std::stod(cells[idx]); }
    catch (...) {
        throw std::runtime_error(std::string("Bad numeric field '")
                                 + name + "': " + cells[idx]);
    }
}

// Parse a 21-field engineered row.
// Column order matches C++ comparison CSV exactly:
//   0  date
//   1  glucose_level
//   2  missing_bg          (skipped — not a model feature)
//   3  meal
//   4  exercise
//   5  basis_heart_rate
//   6  basis_gsr           (skipped — not a model feature)
//   7  basis_steps
//   8  basis_sleep
//   9  bolus
//   10 basal
//   11 glucose_rolling_mean_30min
//   12 glucose_volatility
//   13 time_in_range
//   14 glucose_change
//   15 glucose_acceleration
//   16 hour
//   17 minute
//   18 hour_mean_diff
//   19 hour_trend
//   20 hour_range
static Row parse_engineered_csv_line(const std::string& line) {
    auto cells = split_csv(line);
    if (cells.size() != 21)
        throw std::runtime_error(
            "Engineered CSV must have 21 fields; got " +
            std::to_string(cells.size()) + "\nLine: " + line);

    Row row{};
    row.date                      = parse_date_cell(cells[0]);
    row.glucose_level              = cell_double(cells,  1, "glucose_level");
    // cells[2] = missing_bg — skip
    row.meal                       = cell_double(cells,  3, "meal");
    row.exercise                   = cell_double(cells,  4, "exercise");
    row.basis_heart_rate           = cell_double(cells,  5, "basis_heart_rate");
    // cells[6] = basis_gsr — skip
    row.basis_steps                = cell_double(cells,  7, "basis_steps");
    row.basis_sleep                = cell_double(cells,  8, "basis_sleep");
    row.bolus                      = cell_double(cells,  9, "bolus");
    row.basal                      = cell_double(cells, 10, "basal");
    row.glucose_rolling_mean_30min = cell_double(cells, 11, "glucose_rolling_mean_30min");
    row.glucose_volatility         = cell_double(cells, 12, "glucose_volatility");
    row.time_in_range              = cell_double(cells, 13, "time_in_range");
    row.glucose_change             = cell_double(cells, 14, "glucose_change");
    row.glucose_acceleration       = cell_double(cells, 15, "glucose_acceleration");
    row.hour                       = static_cast<int>(cell_double(cells, 16, "hour"));
    row.minute                     = static_cast<int>(cell_double(cells, 17, "minute"));
    row.hour_mean_diff             = cell_double(cells, 18, "hour_mean_diff");
    row.hour_trend                 = cell_double(cells, 19, "hour_trend");
    row.hour_range                 = cell_double(cells, 20, "hour_range");
    return row;
}

static bool infer_date_expects_nanos(const Model& model,
                                      const std::vector<std::string>& feature_names) {
    auto it = std::find(feature_names.begin(), feature_names.end(), "date");
    if (it == feature_names.end()) return false;
    const int idx   = static_cast<int>(std::distance(feature_names.begin(), it));
    const int start = model.threshold_offsets[idx];
    const int end   = model.threshold_offsets[idx + 1];
    if (end == start) return false;
    double max_t = 0.0;
    for (int i = start; i < end; ++i)
        max_t = std::max(max_t, std::fabs(static_cast<double>(model.thresholds[i])));
    return max_t >= 1e12;
}

} // anonymous namespace

// ─────────────────────────────────────────
//  Setup
// ─────────────────────────────────────────

void GlucoseSession::loadModel(const std::string& export_dir) {
    std::string meta_path = export_dir;
    if (!meta_path.empty() && meta_path.back() != '/' && meta_path.back() != '\\')
        meta_path += '/';
    meta_path += "meta.json";

    // Load model weights + feature names
    model_              = load_model_from_export_dir(export_dir, meta_path);
    feature_names_      = load_feature_names_from_meta(meta_path);
    date_expects_nanos_ = infer_date_expects_nanos(model_, feature_names_);

    // Load hourly stats — these are from the full training dataset and must
    // be used instead of computing from the live buffer, to match the Python
    // LivePredictor which does the same lookup from model_metadata.json.
    std::ifstream f(meta_path);
    if (!f) throw std::runtime_error("Cannot open meta.json: " + meta_path);
    json meta;
    f >> meta;

    hourly_mean_.clear();
    hourly_range_.clear();

    if (meta.contains("hourly_mean")) {
        for (auto& [k, v] : meta["hourly_mean"].items())
            hourly_mean_[std::stoi(k)] = v.get<double>();
    }
    if (meta.contains("hourly_range")) {
        for (auto& [k, v] : meta["hourly_range"].items())
            hourly_range_[std::stoi(k)] = v.get<double>();
    }

    model_loaded_ = true;
}

// ─────────────────────────────────────────
//  Per-reading update
// ─────────────────────────────────────────

void GlucoseSession::addReading(const std::string& csv_line) {
    Row row = parse_csv_line(csv_line);
    history_.push_back(row);
    while ((int)history_.size() > MAX_HISTORY) history_.pop_front();
    recompute_features();
    apply_training_hourly_stats();
}

void GlucoseSession::addEngineeredReading(const std::string& csv_line) {
    Row row = parse_engineered_csv_line(csv_line);
    history_.push_back(row);
    while ((int)history_.size() > MAX_HISTORY) history_.pop_front();
    // Features are pre-computed, but still override hour_mean_diff / hour_range
    // with training stats so they match Python exactly.
    apply_training_hourly_stats();
}

// ─────────────────────────────────────────
//  Prediction
// ─────────────────────────────────────────
int min_readings_required_ = 6;

float GlucoseSession::predict() const {
    if (!model_loaded_ || history_.empty()) return NAN;
    if ((int)history_.size() < min_readings_required_) return NAN;

    for (int i = (int)history_.size() - 1; i >= 0; --i) {
        const Row& r = history_[i];
        if (row_has_nan(r)) continue;

        std::vector<double> x;
        x.reserve(feature_names_.size());

        for (const auto& fn : feature_names_) {
            if (fn == "date") {
                double d = static_cast<double>(r.date);
                if (date_expects_nanos_) d *= 1e9;
                x.push_back(d);
            } else {
                x.push_back(get_feature_value(r, fn));
            }
        }

        return predict_glucose_from_Xreal(x, model_);
    }

    return NAN;
}

// ─────────────────────────────────────────
//  Housekeeping
// ─────────────────────────────────────────

void GlucoseSession::reset() {
    history_.clear();
}

// ─────────────────────────────────────────
//  Internal: re-engineer features on raw history
// ─────────────────────────────────────────

void GlucoseSession::recompute_features() {
    if (history_.empty()) return;

    std::vector<Row> tmp(history_.begin(), history_.end());
    engineer_features(tmp);

    for (size_t i = 0; i < tmp.size(); ++i) {
        history_[i].glucose_rolling_mean_30min = tmp[i].glucose_rolling_mean_30min;
        history_[i].glucose_volatility         = tmp[i].glucose_volatility;
        history_[i].time_in_range              = tmp[i].time_in_range;
        history_[i].glucose_change             = tmp[i].glucose_change;
        history_[i].glucose_acceleration       = tmp[i].glucose_acceleration;
        history_[i].hour                       = tmp[i].hour;
        history_[i].minute                     = tmp[i].minute;
        history_[i].hour_mean_diff             = tmp[i].hour_mean_diff;
        history_[i].hour_trend                 = tmp[i].hour_trend;
        history_[i].hour_range                 = tmp[i].hour_range;
    }
}

// ─────────────────────────────────────────
//  Override hour_mean_diff and hour_range with training-set stats.
//
//  Python LivePredictor does:
//    hour_mean_diff = glucose - HOURLY_MEAN[hour]   (from model_metadata.json)
//    hour_range     = HOURLY_RANGE[hour]             (from model_metadata.json)
//
//  We must do the same — computing these from the live buffer gives different
//  numbers and causes prediction error (~13 mg/dL in testing).
//
//  hour_trend is NOT overridden — Python computes it from the buffer too
//  (rolling(3, min_periods=1).mean() grouped by hour), which is what
//  our C++ engineer_features already does.
// ─────────────────────────────────────────

void GlucoseSession::apply_training_hourly_stats() {
    if (hourly_mean_.empty() && hourly_range_.empty()) return;

    for (auto& row : history_) {
        if (row.hour < 0) continue;

        auto it_mean  = hourly_mean_.find(row.hour);
        auto it_range = hourly_range_.find(row.hour);

        if (it_mean != hourly_mean_.end())
            row.hour_mean_diff = row.glucose_level - it_mean->second;

        if (it_range != hourly_range_.end())
            row.hour_range = it_range->second;
    }
}

} // namespace glucose