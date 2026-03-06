#include "inference.h"
#include "json.hpp"

#include <algorithm>
#include <cmath>
#include <ctime>
#include <deque>
#include <fstream>
#include <iomanip>
#include <limits>
#include <sstream>
#include <stdexcept>
#include <unordered_map>

using json = nlohmann::json;
using namespace std;

static constexpr int64_t kUnixNanosPerSecond = 1000000000LL;

// ─────────────────────────────────────────
//  Internal file helpers
// ─────────────────────────────────────────

static string join_path(const string& a, const string& b) {
    if (a.empty()) return b;
    char last = a.back();
    if (last == '/' || last == '\\') return a + b;
    return a + "/" + b;
}

static json read_json(const string& path) {
    ifstream f(path);
    if (!f) throw runtime_error("Failed to open JSON: " + path);
    json j;
    f >> j;
    return j;
}

template <typename T>
static vector<T> read_binary_vec(const string& path) {
    ifstream f(path, ios::binary);
    if (!f) throw runtime_error("Failed to open binary file: " + path);

    f.seekg(0, ios::end);
    streamsize bytes = f.tellg();
    f.seekg(0, ios::beg);

    if (bytes % (streamsize)sizeof(T) != 0)
        throw runtime_error("File size not multiple of type size: " + path);

    size_t n = (size_t)(bytes / (streamsize)sizeof(T));
    vector<T> out(n);
    if (!out.empty()) {
        f.read(reinterpret_cast<char*>(out.data()), bytes);
        if (!f) throw runtime_error("Failed to read binary file: " + path);
    }
    return out;
}

static float read_single_float(const string& path) {
    auto v = read_binary_vec<float>(path);
    if (v.size() != 1)
        throw runtime_error("Expected exactly 1 float in: " + path);
    return v[0];
}

// ─────────────────────────────────────────
//  Time
// ─────────────────────────────────────────

static time_t portable_timegm(tm* t) {
#ifdef _WIN32
    char* old_tz = getenv("TZ");
    _putenv("TZ=UTC");
    _tzset();
    time_t ret = mktime(t);
    if (old_tz) { string r = string("TZ=") + old_tz; _putenv(r.c_str()); }
    else         { _putenv("TZ="); }
    _tzset();
    return ret;
#else
    return timegm(t);
#endif
}

static int64_t parse_timestamp_to_unix(const std::string& s) {
    std::tm tm{};
    std::istringstream ss(s);

    ss >> std::get_time(&tm, "%Y-%m-%d %H:%M:%S");

    time_t t = portable_timegm(&tm);
    return static_cast<int64_t>(t);
}

// ─────────────────────────────────────────
//  CSV parsing
// ─────────────────────────────────────────

Row parse_csv_line(const string& line) {
    stringstream ss(line);
    string cell;
    Row row{};

    getline(ss, cell, ','); row.date              = parse_timestamp_to_unix(cell);
    getline(ss, cell, ','); row.glucose_level     = stod(cell);
    getline(ss, cell, ','); row.missing_bg        = stod(cell);
    getline(ss, cell, ','); row.meal              = stod(cell);
    getline(ss, cell, ','); row.exercise          = stod(cell);
    getline(ss, cell, ','); row.basis_heart_rate  = stod(cell);
    getline(ss, cell, ','); row.basis_gsr         = stod(cell);
    getline(ss, cell, ','); row.basis_steps       = stod(cell);
    getline(ss, cell, ','); row.basis_sleep       = stod(cell);
    getline(ss, cell, ','); row.bolus             = stod(cell);
    getline(ss, cell, ','); row.basal             = stod(cell);

    return row;
}

vector<Row> load_csv_file(const string& path) {
    ifstream iFile(path);
    if (!iFile) throw runtime_error("Failed to open CSV: " + path);

    string line;
    vector<Row> rows;

    getline(iFile, line); // skip header

    while (getline(iFile, line)) {
        if (line.empty()) continue;
        rows.push_back(parse_csv_line(line));
    }

    stable_sort(rows.begin(), rows.end(),
        [](const Row& a, const Row& b) { return a.date < b.date; });

    return rows;
}

// ─────────────────────────────────────────
//  Feature engineering
// ─────────────────────────────────────────

static bool in_range_70_180(double g) {
    return g >= 70.0 && g <= 180.0;
}

void add_time_features(vector<Row>& rows) {
    for (auto& row : rows) {
        time_t t = static_cast<time_t>(row.date);
        tm tm_val = *gmtime(&t);
        row.hour   = tm_val.tm_hour;
        row.minute = tm_val.tm_min;
    }
}

void add_rolling_30min_features(vector<Row>& rows) {
    const int64_t window_sec = 30 * 60;
    deque<size_t> window;
    double sum = 0.0, sum2 = 0.0, sumIR = 0.0;

    for (size_t i = 0; i < rows.size(); i++) {
        const int64_t t  = rows[i].date;
        const double  g  = rows[i].glucose_level;

        window.push_back(i);
        sum   += g;
        sum2  += g * g;
        sumIR += in_range_70_180(g) ? 1.0 : 0.0;

        while (!window.empty() && rows[window.front()].date <= t - window_sec) {
            size_t j  = window.front(); window.pop_front();
            double gj = rows[j].glucose_level;
            sum   -= gj;
            sum2  -= gj * gj;
            sumIR -= in_range_70_180(gj) ? 1.0 : 0.0;
        }

        const int count = static_cast<int>(window.size());
        rows[i].glucose_rolling_mean_30min = sum / count;
        rows[i].time_in_range              = sumIR / count;

        if (count >= 2) {
            const double mean     = sum / count;
            const double var_samp = (sum2 - count * mean * mean) / (count - 1);
            rows[i].glucose_volatility = sqrt(max(0.0, var_samp));
        } else {
            rows[i].glucose_volatility = NAN;
        }
    }
}

void add_diff_features(vector<Row>& rows) {
    if (rows.empty()) return;

    rows[0].glucose_change       = NAN;
    rows[0].glucose_acceleration = NAN;

    if (rows.size() >= 2) {
        rows[1].glucose_change       = rows[1].glucose_level - rows[0].glucose_level;
        rows[1].glucose_acceleration = NAN;
    }

    for (size_t i = 2; i < rows.size(); i++) {
        rows[i].glucose_change       = rows[i].glucose_level - rows[i-1].glucose_level;
        rows[i].glucose_acceleration = rows[i].glucose_change - rows[i-1].glucose_change;
    }
}

void add_hourly_group_features(vector<Row>& rows) {
    unordered_map<int, vector<size_t>> groups;
    for (size_t i = 0; i < rows.size(); ++i)
        groups[rows[i].hour].push_back(i);

    for (auto& [hour, idxs] : groups) {
        if (idxs.empty()) continue;

        stable_sort(idxs.begin(), idxs.end(),
            [&](size_t a, size_t b) { return rows[a].date < rows[b].date; });

        // mean
        double sum = 0.0;
        for (auto idx : idxs) sum += rows[idx].glucose_level;
        double mean = sum / (double)idxs.size();

        // range
        double min_v = rows[idxs[0]].glucose_level;
        double max_v = rows[idxs[0]].glucose_level;
        for (auto idx : idxs) {
            min_v = min(min_v, rows[idx].glucose_level);
            max_v = max(max_v, rows[idx].glucose_level);
        }
        double range = max_v - min_v;

        // rolling window of 3 (within the hour group)
        double window_sum  = 0.0;
        int    window_size = 0;

        for (size_t i = 0; i < idxs.size(); ++i) {
            const size_t idx = idxs[i];
            const double g   = rows[idx].glucose_level;

            window_sum  += g;
            window_size++;

            if (window_size > 3) {
                window_sum -= rows[idxs[i - 3]].glucose_level;
                window_size--;
            }

            double rolling_mean = window_sum / window_size;

            rows[idx].hour_mean_diff = g - mean;
            rows[idx].hour_trend     = rolling_mean;
            rows[idx].hour_range     = range;
        }
    }
}

void engineer_features(vector<Row>& rows) {
    add_rolling_30min_features(rows);
    add_diff_features(rows);
    add_time_features(rows);
    add_hourly_group_features(rows);
    // No debug cout — safe to call on every new reading
}

// ─────────────────────────────────────────
//  NaN helpers
// ─────────────────────────────────────────

bool row_has_nan(const Row& row) {
    return
        isnan(row.glucose_rolling_mean_30min) ||
        isnan(row.glucose_volatility)         ||
        isnan(row.time_in_range)              ||
        isnan(row.glucose_change)             ||
        isnan(row.glucose_acceleration)       ||
        isnan(row.hour_mean_diff)             ||
        isnan(row.hour_trend)                 ||
        isnan(row.hour_range)                 ||
        row.hour   < 0                        ||
        row.minute < 0;
}

void drop_nan_rows(vector<Row>& rows) {
    rows.erase(
        remove_if(rows.begin(), rows.end(),
            [](const Row& r) { return row_has_nan(r); }),
        rows.end());
}

// ─────────────────────────────────────────
//  Feature matrix
// ─────────────────────────────────────────

double get_feature_value(const Row& row, const string& name) {
    // Training pipeline stores date as pandas datetime int64 (Unix nanoseconds).
    // Keep internal time arithmetic in seconds, but expose the model feature in ns.
    if (name == "date")                       return static_cast<double>(row.date * kUnixNanosPerSecond);
    if (name == "meal")                       return row.meal;
    if (name == "exercise")                   return row.exercise;
    if (name == "basis_heart_rate")           return row.basis_heart_rate;
    if (name == "basis_steps")                return row.basis_steps;
    if (name == "basis_sleep")                return row.basis_sleep;
    if (name == "bolus")                      return row.bolus;
    if (name == "basal")                      return row.basal;
    if (name == "glucose_rolling_mean_30min") return row.glucose_rolling_mean_30min;
    if (name == "glucose_volatility")         return row.glucose_volatility;
    if (name == "time_in_range")              return row.time_in_range;
    if (name == "glucose_change")             return row.glucose_change;
    if (name == "glucose_acceleration")       return row.glucose_acceleration;
    if (name == "hour")                       return row.hour;
    if (name == "minute")                     return row.minute;
    if (name == "hour_mean_diff")             return row.hour_mean_diff;
    if (name == "hour_trend")                 return row.hour_trend;
    if (name == "hour_range")                 return row.hour_range;
    throw runtime_error("Unknown feature name: " + name);
}

vector<vector<double>> build_X_real(
        const vector<Row>& rows,
        const vector<string>& feature_names) {

    vector<vector<double>> X;
    X.reserve(rows.size());

    for (const auto& r : rows) {
        vector<double> x;
        x.reserve(feature_names.size());
        for (const auto& fn : feature_names)
            x.push_back(get_feature_value(r, fn));
        X.push_back(move(x));
    }
    return X;
}

// ─────────────────────────────────────────
//  Model loading
// ─────────────────────────────────────────

vector<string> load_feature_names_from_meta(const string& path) {
    ifstream file(path);
    if (!file) throw runtime_error("Failed to open meta.json: " + path);
    json j; file >> j;
    if (!j.contains("feature_names"))
        throw runtime_error("meta.json missing 'feature_names'");
    return j["feature_names"].get<vector<string>>();
}

Model load_model_from_export_dir(const string& export_dir,
                                  const string& meta_path) {
    Model model;
    json meta = read_json(meta_path);

    model.n_features   = meta.at("n_features").get<int>();
    model.n_bits_total = meta.at("n_bits_total").get<int>();
    model.n_clauses    = meta.at("n_clauses").get<int>();
    model.n_words      = meta.at("n_words").get<int>();

    auto offsets = meta.at("threshold_offsets");
    if (!offsets.is_array())
        throw runtime_error("threshold_offsets is not an array in meta.json");

    model.threshold_offsets.reserve(offsets.size());
    for (auto& v : offsets)
        model.threshold_offsets.push_back((int32_t)v.get<int>());

    if ((int)model.threshold_offsets.size() != model.n_features + 1)
        throw runtime_error("threshold_offsets length != n_features + 1");

    const string thresholds_file         = meta.value("thresholds_file",         "thresholds.bin");
    const string pos_mask_file           = meta.value("pos_mask_file",           "pos_mask.bin");
    const string neg_mask_file           = meta.value("neg_mask_file",           "neg_mask.bin");
    const string head_clause_weights_file = meta.value("head_clause_weights_file", "head_clause_weights.bin");
    const string head_int_file           = meta.value("head_intercept_file",     "head_intercept.bin");

    model.thresholds           = read_binary_vec<float>   (join_path(export_dir, thresholds_file));
    model.pos_mask             = read_binary_vec<uint64_t>(join_path(export_dir, pos_mask_file));
    model.neg_mask             = read_binary_vec<uint64_t>(join_path(export_dir, neg_mask_file));
    model.head_clause_weights  = read_binary_vec<float>   (join_path(export_dir, head_clause_weights_file));
    model.head_intercept       = read_single_float        (join_path(export_dir, head_int_file));

    // Validate sizes
    int expected_thresholds = model.threshold_offsets.back();
    if ((int)model.thresholds.size() != expected_thresholds)
        throw runtime_error("thresholds.bin size mismatch. Expected " +
            to_string(expected_thresholds) + " floats, got " +
            to_string(model.thresholds.size()));

    size_t expected_masks = (size_t)model.n_clauses * (size_t)model.n_words;
    if (model.pos_mask.size() != expected_masks)
        throw runtime_error("pos_mask.bin size mismatch");
    if (model.neg_mask.size() != expected_masks)
        throw runtime_error("neg_mask.bin size mismatch");
    if ((int)model.head_clause_weights.size() != model.n_clauses)
        throw runtime_error("head_clause_weights.bin size mismatch");

    return model;
}

// ─────────────────────────────────────────
//  Inference
// ─────────────────────────────────────────

static vector<uint8_t> booleanize(const vector<double>& X_real,
                                   const Model& model) {
    if ((int)X_real.size() != model.n_features)
        throw runtime_error("X_real length != n_features");

    vector<uint8_t> X_bool(model.n_bits_total, 0);
    int bit_index = 0;

    for (int i = 0; i < model.n_features; i++) {
        double x    = X_real[i];
        int    start = model.threshold_offsets[i];
        int    end   = model.threshold_offsets[i + 1];

        for (int j = start; j < end; j++)
            X_bool[bit_index++] = (x > model.thresholds[j]) ? 1 : 0;
    }

    if (bit_index != model.n_bits_total)
        throw runtime_error("Internal error: bit_index != n_bits_total");

    return X_bool;
}

static vector<uint64_t> pack_bits_to_words(const vector<uint8_t>& X_bool,
                                            int n_words) {
    vector<uint64_t> X_words(n_words, 0ULL);
    for (int i = 0; i < (int)X_bool.size(); i++) {
        if (X_bool[i]) {
            int w = i / 64;
            int k = i % 64;
            X_words[w] |= (uint64_t(1) << uint64_t(k));
        }
    }
    return X_words;
}

static vector<float> clause_outputs_from_words(const vector<uint64_t>& Xw,
                                                 const Model& m) {
    vector<float> clauses(m.n_clauses, 0.0f);

    for (int clause = 0; clause < m.n_clauses; clause++) {
        bool ok = true;
        const uint64_t* pos = &m.pos_mask[(size_t)clause * (size_t)m.n_words];
        const uint64_t* neg = &m.neg_mask[(size_t)clause * (size_t)m.n_words];

        for (int word = 0; word < m.n_words; word++) {
            if ((Xw[word] & pos[word]) != pos[word])   { ok = false; break; }
            if ((Xw[word] & neg[word]) != 0ULL)        { ok = false; break; }
        }
        clauses[clause] = ok ? 1.0f : 0.0f;
    }
    return clauses;
}

static float ridge_predict(const vector<float>& clauses, const Model& model) {
    double prediction = (double)model.head_intercept;
    for (int c = 0; c < model.n_clauses; c++)
        prediction += (double)clauses[c] * (double)model.head_clause_weights[c];
    return (float)prediction;
}

float predict_glucose_from_Xreal(const vector<double>& X_real,
                                   const Model& model) {
    auto X_bool    = booleanize(X_real, model);
    auto X_words   = pack_bits_to_words(X_bool, model.n_words);
    auto cl_out    = clause_outputs_from_words(X_words, model);
    return ridge_predict(cl_out, model);
}
