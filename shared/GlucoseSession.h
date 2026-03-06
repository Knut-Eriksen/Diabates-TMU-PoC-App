// C++ version of LivePredictor

#pragma once

#include "inference_types.h"

#include <deque>
#include <string>
#include <unordered_map>
#include <vector>

namespace glucose {

class GlucoseSession {
public:
    // Load model + hourly stats from export_dir/meta.json
    void loadModel(const std::string& export_dir);

    // Add one raw 11-field CSV line — features computed automatically.
    // Format: "YYYY-MM-DD HH:MM:SS,glucose,missing_bg,meal,exercise,heart_rate,gsr,steps,sleep,bolus,basal"
    void addReading(const std::string& csv_line);

    // Add one fully-engineered 21-field CSV line — features used as-is.
    void addEngineeredReading(const std::string& csv_line);

    // Returns predicted glucose for the most recent complete row.
    // Returns NAN if model not loaded or not enough history yet.
    float predict() const;

    // Clear history. Model stays loaded.
    void reset();

private:
    static constexpr int MIN_READINGS_REQUIRED = 6; // minimum reading to get a prediction
    static constexpr int MAX_HISTORY = 200;

    Model                         model_;
    std::vector<std::string>      feature_names_;
    std::deque<Row>               history_;
    bool                          model_loaded_       = false;
    bool                          date_expects_nanos_ = false;

    // Loaded from meta.json — used to match Python LivePredictor exactly
    std::unordered_map<int, double> hourly_mean_;  
    std::unordered_map<int, double> hourly_range_;

    void recompute_features();
    void apply_training_hourly_stats();  // overwrites hour_mean_diff / hour_range
};

} // namespace glucose