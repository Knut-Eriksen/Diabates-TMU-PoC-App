#pragma once

#include <cstdint>
#include <vector>
#include <string>
#include <cmath>

// ─────────────────────────────────────────
//  Row  –  one CGM reading + engineered features
// ─────────────────────────────────────────
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

    // Engineered: rolling 30-min window
    double glucose_rolling_mean_30min = NAN;
    double glucose_volatility         = NAN;
    double time_in_range              = NAN;

    // Engineered: first/second differences
    double glucose_change       = NAN;
    double glucose_acceleration = NAN;

    // Engineered: wall-clock time
    int hour   = -1;
    int minute = -1;

    // Engineered: hourly group stats
    double hour_mean_diff = NAN;
    double hour_trend     = NAN;
    double hour_range     = NAN;
};

// ─────────────────────────────────────────
//  Model  –  everything needed for inference
// ─────────────────────────────────────────
struct Model {
    int n_features   = 0;
    int n_bits_total = 0;
    int n_clauses    = 0;
    int n_words      = 0;

    // Per-feature threshold bins
    std::vector<int32_t> threshold_offsets;   // length = n_features + 1
    std::vector<float>   thresholds;          // flat array of all thresholds

    // Tsetlin clause rules (packed uint64 bitmasks)
    std::vector<uint64_t> pos_mask;           // [n_clauses * n_words]
    std::vector<uint64_t> neg_mask;           // [n_clauses * n_words]

    // Ridge regression head
    std::vector<float> head_clause_weights;   // [n_clauses]
    float              head_intercept = 0.0f;
};