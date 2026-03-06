#pragma once

#include "inference_types.h"
#include <string>
#include <vector>

// ─────────────────────────────────────────
//  Time
// ─────────────────────────────────────────
static int64_t parse_timestamp_to_unix(const std::string& s);

// ─────────────────────────────────────────
//  CSV parsing
// ─────────────────────────────────────────

// Parse a single CSV data line (no header).
// Expected column order:
//   date, glucose_level, missing_bg, meal, exercise,
//   basis_heart_rate, basis_gsr, basis_steps, basis_sleep, bolus, basal
Row parse_csv_line(const std::string& line);

// Parse a whole CSV file (with header line). Sorted by date on return.
std::vector<Row> load_csv_file(const std::string& path);

// ─────────────────────────────────────────
//  Feature engineering
//  All functions operate in-place on a vector<Row>.
// ─────────────────────────────────────────
void add_time_features           (std::vector<Row>& rows);
void add_rolling_30min_features  (std::vector<Row>& rows);
void add_diff_features           (std::vector<Row>& rows);
void add_hourly_group_features   (std::vector<Row>& rows);

// Runs all four in the correct order. Does NOT print debug output.
void engineer_features(std::vector<Row>& rows);

// ─────────────────────────────────────────
//  NaN / cleaning helpers
// ─────────────────────────────────────────
bool row_has_nan(const Row& row);
void drop_nan_rows(std::vector<Row>& rows);

// ─────────────────────────────────────────
//  Feature matrix builder
// ─────────────────────────────────────────
double get_feature_value(const Row& row, const std::string& name);

std::vector<std::vector<double>> build_X_real(
    const std::vector<Row>& rows,
    const std::vector<std::string>& feature_names);

// ─────────────────────────────────────────
//  Model loading
// ─────────────────────────────────────────
Model load_model_from_export_dir(const std::string& export_dir,
                                  const std::string& meta_path);

std::vector<std::string> load_feature_names_from_meta(const std::string& path);

// ─────────────────────────────────────────
//  Inference
// ─────────────────────────────────────────
float predict_glucose_from_Xreal(const std::vector<double>& X_real,
                                  const Model& model);