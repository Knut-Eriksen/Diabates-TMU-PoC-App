import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

// Define which functions the native code exposes and the type of them
export interface Spec extends TurboModule {
  // Load the model
  loadModel(exportDir: string): void;

  // Add one raw reading
  addReading(csvLine: string): void;

  // Add one already feature engineered reading
  addEngineeredReading(csvLine: string): void;

  // Get the latest prediction
  predict(): number;

  // Clear all readings
  reset(): void;

  // Process CPU usage as a percentage. Returns -1 if unavailable.
  getCpuUsage(): number;
}

// Checks the native module exists
export default TurboModuleRegistry.getEnforcing<Spec>('NativeSampleModule');
