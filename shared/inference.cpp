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

// Helper for converting from seconds to nanoseconds
static constexpr int64_t kUnixNanosPerSecond = 1000000000LL;

// ───────────────────────────────────────── Internal file helpers ─────────────────────────────────────────

// Build folder paths without double slashes (//)
static string join_path(const string& a, const string& b) {
    if (a.empty()) return b;
    char last = a.back();
    if (last == '/' || last == '\\') return a + b;
    return a + "/" + b;
}

// Loads and parses json files
static json read_json(const string& path) {
    ifstream f(path);
    if (!f) throw runtime_error("Failed to open JSON: " + path);
    json j;
    f >> j;
    return j;
}

//template makes the function work with any number type
template <typename T>
static vector<T> read_binary_vec(const string& path) {
    //Opens the file at path and reads raw bytes
    ifstream f(path, ios::binary);
    if (!f) throw runtime_error("Failed to open binary file: " + path);

    //Get file sizes by moving to end of the file and asking where it is
    f.seekg(0, ios::end);
    streamsize bytes = f.tellg();
    f.seekg(0, ios::beg);

    //cheks if filesize is divisable by type size. viktig
    if (bytes % (streamsize)sizeof(T) != 0)
        throw runtime_error("File size not multiple of type size: " + path);

    //Compute number of elements and create vector with type
    size_t n = (size_t)(bytes / (streamsize)sizeof(T));
    vector<T> out(n);

    // Read raw bytes into the vectors memory
    if (!out.empty()) {
        f.read(reinterpret_cast<char*>(out.data()), bytes);
        if (!f) throw runtime_error("Failed to read binary file: " + path);
    }
    return out;
}

// Loads a .bin file and checks if it contains exactly one float
static float read_single_float(const string& path) {
    auto v = read_binary_vec<float>(path);
    if (v.size() != 1)
        throw runtime_error("Expected exactly 1 float in: " + path);
    return v[0];
}

// ───────────────────────────────────────── Time ─────────────────────────────────────────

// Convert datetime into unix seconds
static int64_t parse_timestamp_to_unix(const std::string& s) {
    std::tm tm{};
    std::istringstream ss(s);

    ss >> std::get_time(&tm, "%Y-%m-%d %H:%M:%S");

    time_t t = timegm(&tm);
    return static_cast<int64_t>(t);
}
// ───────────────────────────────────────── CSV parsing ─────────────────────────────────────────

// This parses a raw 11-field CSV line
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

// ───────────────────────────────────────── Feature engineering ─────────────────────────────────────────

static bool in_range_70_180(double g) {
    return g >= 70.0 && g <= 180.0;
}

void add_time_features(vector<Row>& rows) {
    for (auto& row : rows) {
        //Convert type into time_t
        time_t t = static_cast<time_t>(row.date);

        //creates stuct called tm as type tm
        tm tm_val = *gmtime(&t);

        //add the tm values into row
        row.hour   = tm_val.tm_hour;
        row.minute = tm_val.tm_min;
    }
}

void add_rolling_30min_features(vector<Row>& rows) {
    const int64_t window_sec = 30 * 60; // 1800 seconds

    //Window queue
    deque<size_t> window;
    double sum = 0.0;
    double sum2 = 0.0;
    double sumIR = 0.0;

    // Loop though rows one by one
    for (size_t i = 0; i < rows.size(); i++) {
        const int64_t t  = rows[i].date;
        const double  g  = rows[i].glucose_level;

        window.push_back(i);
        sum   += g;
        sum2  += g * g;
        sumIR += in_range_70_180(g) ? 1.0 : 0.0;

        // Remove old rows, outside 30 min
        while (!window.empty() && rows[window.front()].date <= t - window_sec) {
            size_t j  = window.front(); window.pop_front();
            double gj = rows[j].glucose_level;
            sum   -= gj;
            sum2  -= gj * gj;
            sumIR -= in_range_70_180(gj) ? 1.0 : 0.0;
        }

        //Compute the rolling mean and time in range
        const int count = static_cast<int>(window.size());
        rows[i].glucose_rolling_mean_30min = sum / count;
        rows[i].time_in_range              = sumIR / count;

        // rolling standard deviation
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

    //set first row to NAN because you cant calculate change from before data starts
    rows[0].glucose_change       = NAN;
    rows[0].glucose_acceleration = NAN;

     // If more than or = two rows, set the first change at index 1, no acceleration
    if (rows.size() >= 2) {
        rows[1].glucose_change       = rows[1].glucose_level - rows[0].glucose_level;
        rows[1].glucose_acceleration = NAN;
    }

    //Start at row 2, change is current glucose - previous, acceleration is current change - previous
    for (size_t i = 2; i < rows.size(); i++) {
        rows[i].glucose_change       = rows[i].glucose_level - rows[i-1].glucose_level;
        rows[i].glucose_acceleration = rows[i].glucose_change - rows[i-1].glucose_change;
    }
}


void add_hourly_group_features(vector<Row>& rows) {
     // group: hour -> indices
    unordered_map<int, vector<size_t>> groups;

    for (size_t i = 0; i < rows.size(); ++i)
        groups[rows[i].hour].push_back(i);

    // process each hour group
    for (auto& [hour, idxs] : groups) {
        if (idxs.empty()) continue;

        // 🔹 IMPORTANT: ensure time order inside hour (matches pandas)
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
}

// ───────────────────────────────────────── NaN helpers ─────────────────────────────────────────

// Checks each value in row if its NAN, returns true if one in a row is NAN
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

// Remove the rows that include one NAN value
void drop_nan_rows(vector<Row>& rows) {
    rows.erase(
        remove_if(rows.begin(), rows.end(),
            [](const Row& r) { return row_has_nan(r); }),
        rows.end());
}

// ───────────────────────────────────────── Feature matrix ─────────────────────────────────────────

double get_feature_value(const Row& row, const string& name) {

    // Raw values
    // Training pipeline stores date as pandas datetime int64 (Unix nanoseconds).
    if (name == "date")                       return static_cast<double>(row.date * kUnixNanosPerSecond);
    if (name == "meal")                       return row.meal;
    if (name == "exercise")                   return row.exercise;
    if (name == "basis_heart_rate")           return row.basis_heart_rate;
    if (name == "basis_steps")                return row.basis_steps;
    if (name == "basis_sleep")                return row.basis_sleep;
    if (name == "bolus")                      return row.bolus;
    if (name == "basal")                      return row.basal;
    
    //engineered
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

// ───────────────────────────────────────── Model loading ─────────────────────────────────────────

// Check if meta.json includes feature_names
vector<string> load_feature_names_from_meta(const string& path) {
    ifstream file(path);
    if (!file) throw runtime_error("Failed to open meta.json: " + path);
    json j; file >> j;
    if (!j.contains("feature_names"))
        throw runtime_error("meta.json missing 'feature_names'");
    return j["feature_names"].get<vector<string>>();
}

// Load all neccecary files from export and check if its junk
Model load_model_from_export_dir(const string& export_dir, const string& meta_path) {
    Model model;

    //Read meta.json
    json meta = read_json(meta_path);

    // Required fields from meta.json
    model.n_features   = meta.at("n_features").get<int>();
    model.n_bits_total = meta.at("n_bits_total").get<int>();
    model.n_clauses    = meta.at("n_clauses").get<int>();
    model.n_words      = meta.at("n_words").get<int>();

    // read from json into model by converting to an interger
    auto offsets = meta.at("threshold_offsets");
    if (!offsets.is_array()) throw runtime_error("threshold_offsets is not an array in meta.json");
    model.threshold_offsets.reserve(offsets.size());
    for (auto& v : offsets) model.threshold_offsets.push_back((int32_t)v.get<int>());

    //there should always be +1 offset than features
    if ((int)model.threshold_offsets.size() != model.n_features + 1)
        throw runtime_error("threshold_offsets length != n_features + 1");

    // Get file names from meta.json or set it as default value
    const string thresholds_file         = meta.value("thresholds_file",         "thresholds.bin");
    const string pos_mask_file           = meta.value("pos_mask_file",           "pos_mask.bin");
    const string neg_mask_file           = meta.value("neg_mask_file",           "neg_mask.bin");
    const string head_clause_weights_file = meta.value("head_clause_weights_file", "head_clause_weights.bin");
    const string head_int_file           = meta.value("head_intercept_file",     "head_intercept.bin");

    // Load binary files (blobs) with the path as argument
    model.thresholds           = read_binary_vec<float>   (join_path(export_dir, thresholds_file));
    model.pos_mask             = read_binary_vec<uint64_t>(join_path(export_dir, pos_mask_file));
    model.neg_mask             = read_binary_vec<uint64_t>(join_path(export_dir, neg_mask_file));
    model.head_clause_weights  = read_binary_vec<float>   (join_path(export_dir, head_clause_weights_file));
    model.head_intercept       = read_single_float        (join_path(export_dir, head_int_file));

    // Validate sizes, if everything matches model now contains all rules, thresholds, and ridge head weights needed for inference
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

// ───────────────────────────────────────── Inference ─────────────────────────────────────────

// Turns real features into bits
static vector<uint8_t> booleanize(const vector<double>& X_real,
                                   const Model& model) {
    if ((int)X_real.size() != model.n_features)
        throw runtime_error("X_real length != n_features");

    //Create empty vector to hold all bits of all features
    vector<uint8_t> X_bool(model.n_bits_total, 0);
    int bit_index = 0;

    //Loop through each feature, read its value and find both start and end of the thresholds that belongs to it
    for (int i = 0; i < model.n_features; i++) {
        double x    = X_real[i];
        int    start = model.threshold_offsets[i];
        int    end   = model.threshold_offsets[i + 1];

        // Compare x against each threshold and produce bits
        for (int j = start; j < end; j++)
            X_bool[bit_index++] = (x > model.thresholds[j]) ? 1 : 0;
    }

    if (bit_index != model.n_bits_total)
        throw runtime_error("Internal error: bit_index != n_bits_total");

    return X_bool;
}

// Pack bit vector into uint64 words for speed
static vector<uint64_t> pack_bits_to_words(const vector<uint8_t>& X_bool, int n_words) {

    //Create n_words amount of words all initialized to 0
    vector<uint64_t> X_words(n_words, 0ULL);

    //Loop though all bits,
    for (int i = 0; i < (int)X_bool.size(); i++) {
        if (X_bool[i]) {
            int w = i / 64;
            int k = i % 64;
            X_words[w] |= (uint64_t(1) << uint64_t(k));
        }
    }
    return X_words;
}

// Evaluate each clause using pos/neg masks to check if it fires
// Clause output is 1 if (X includes all pos bits) AND (X includes none of neg bits).
static vector<float> clause_outputs_from_words(const vector<uint64_t>& Xw, const Model& m) {
    
    //creates amount of clauses initialized to 0
    vector<float> clauses(m.n_clauses, 0.0f);

    //Loop over each clause, assume its true and disprove it
    for (int clause = 0; clause < m.n_clauses; clause++) {
        bool ok = true;

        // Grab this clauses masks
        const uint64_t* pos = &m.pos_mask[(size_t)clause * (size_t)m.n_words];
        const uint64_t* neg = &m.neg_mask[(size_t)clause * (size_t)m.n_words];

        // Loop though word by word
        for (int word = 0; word < m.n_words; word++) {
            // Must contain all positive literals
            if ((Xw[word] & pos[word]) != pos[word])   { ok = false; break; }
            // Must contain none of the negative literals
            if ((Xw[word] & neg[word]) != 0ULL)        { ok = false; break; }
        }

        // If it passes all checks = 1, else 0
        clauses[clause] = ok ? 1.0f : 0.0f;
    }
    return clauses;
}

// Predict glucose, start with the intercept as a baseline, then end up with the prediciton
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
