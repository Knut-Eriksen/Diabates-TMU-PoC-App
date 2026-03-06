#pragma once

#include "inference_types.h"
#include "inference.h"

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
    // Format: "YYYY-MM-DD HH:MM:SS,glucose,missing_bg,meal,exercise,
    //          heart_rate,gsr,steps,sleep,bolus,basal"
    void addReading(const std::string& csv_line);

    // Add one fully-engineered 21-field CSV line — features used as-is.
    // Column order:
    //   date, glucose_level, missing_bg, meal, exercise,
    //   basis_heart_rate, basis_gsr, basis_steps, basis_sleep, bolus, basal,
    //   glucose_rolling_mean_30min, glucose_volatility, time_in_range,
    //   glucose_change, glucose_acceleration, hour, minute,
    //   hour_mean_diff, hour_trend, hour_range
    void addEngineeredReading(const std::string& csv_line);

    // Returns predicted glucose for the most recent complete row.
    // Returns NAN if model not loaded or not enough history yet.
    float predict() const;

    // Clear history. Model stays loaded.
    void reset();

    bool isModelLoaded() const { return model_loaded_; }
    int  historySize()   const { return (int)history_.size(); }

private:
    static constexpr int MAX_HISTORY = 200;

    Model                         model_;
    std::vector<std::string>      feature_names_;
    std::deque<Row>               history_;
    bool                          model_loaded_       = false;
    bool                          date_expects_nanos_ = false;

    // Loaded from meta.json — used to match Python LivePredictor exactly
    std::unordered_map<int, double> hourly_mean_;   // hour (0-23) → mean glucose
    std::unordered_map<int, double> hourly_range_;  // hour (0-23) → glucose range

    void recompute_features();
    void apply_training_hourly_stats();  // overwrites hour_mean_diff / hour_range
};

} // namespace glucose