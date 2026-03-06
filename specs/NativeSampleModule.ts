import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export interface Spec extends TurboModule {
  /**
   * Load the Tsetlin Machine model from a directory on the device.
   * The directory must contain meta.json and all referenced .bin files.
   * Call once on app start. Throws if files are missing or corrupt.
   *
   * @param exportDir  Absolute path to the model export directory.
   */
  loadModel(exportDir: string): void;

  /**
   * Feed one CGM reading into the session.
   * Call every ~5 minutes as sensor data arrives.
   *
   * @param csvLine  A single data row (no header) in this exact format:
   *   "YYYY-MM-DD HH:MM:SS,glucose_level,missing_bg,meal,exercise,
   *    basis_heart_rate,basis_gsr,basis_steps,basis_sleep,bolus,basal"
   *
   *   Example:
   *   "2021-11-07 08:10:00,145.0,0.0,0.0,0.0,82.0,0.05106,0.0,0.0,0.0,0.0"
   */
  addReading(csvLine: string): void;

  /**
   * Feed one fully engineered row into the session (no header).
   * This bypasses native feature engineering and is meant for
   * direct inference testing with precomputed features.
   *
   * @param csvLine  A single data row in this exact format:
   *   "date,glucose_level,meal,exercise,basis_heart_rate,basis_steps,basis_sleep,
   *    bolus,basal,glucose_rolling_mean_30min,glucose_volatility,time_in_range,
   *    glucose_change,glucose_acceleration,hour,minute,hour_mean_diff,hour_trend,hour_range"
   *
   * date may be either Unix seconds (e.g. 1634161200.0) or
   * "YYYY-MM-DD HH:MM:SS" (UTC).
   */
  addEngineeredReading(csvLine: string): void;

  /**
   * Get the predicted glucose value for the most recent complete reading.
   *
   * Returns NaN if:
   *   - loadModel() has not been called yet
   *   - fewer than ~3 readings have been added (not enough history for
   *     rolling std-dev and difference features)
   *
   * Check the return value with isNaN() before displaying it.
   */
  predict(): number;

  /**
   * Clear all accumulated readings. The model stays loaded.
   * Use this if the user logs out, or if you detect a large time gap
   * between readings that would make the rolling window stale.
   */
  reset(): void;
}

export default TurboModuleRegistry.getEnforcing<Spec>('NativeSampleModule');
