// defines the core data structures

#pragma once

#include <cstdint>
#include <vector>
#include <string>
#include <cmath>

// One row is one GLucose reading + engineered features
struct Row {
    // Raw columns (from CSV)
    int64_t date          = 0;
    double glucose_level  = 0.0;
    double missing_bg     = 0.0;
    double meal           = 0.0;
    double exercise       = 0.0;
    double basis_heart_rate = 0.0;
    double basis_gsr      = 0.0;
    double basis_steps    = 0.0;
    double basis_sleep    = 0.0;
    double bolus          = 0.0;
    double basal          = 0.0;

    // engineered: rolling
    double glucose_rolling_mean_30min = NAN;
    double glucose_volatility         = NAN;
    double time_in_range              = NAN;

    // engineered: diffs
    double glucose_change       = NAN;
    double glucose_acceleration = NAN;

    // engineered: time
    int hour   = -1;
    int minute = -1;

    // engineered: hourly group
    double hour_mean_diff = NAN;
    double hour_trend     = NAN;
    double hour_range     = NAN;
};

// Holsd everything needed to run the saved Tsetlin Machine
struct Model {
    int n_features   = 0;
    int n_bits_total = 0;
    int n_clauses    = 0;
    int n_words      = 0;
    int t_param = 0;
    float min_y = 0.0f;
    float max_y = 0.0f;

    // Thresholds
    std::vector<int32_t> threshold_offsets;
    std::vector<float>   thresholds;

    // Clause rules
    std::vector<uint64_t> pos_mask;
    std::vector<uint64_t> neg_mask;

    // TM clause weights
    std::vector<float> clause_weights;
};