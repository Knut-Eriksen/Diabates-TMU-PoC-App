/**
 * useGlucosePrediction.ts
 *
 * Example hook showing how to drive NativeSampleModule from React Native.
 * Drop this in your app's hooks/ folder and adapt as needed.
 */

import { useEffect, useRef } from 'react';
import NativeSampleModule from './NativeSampleModule'; // your TurboModule spec

// Format a Date + raw sensor fields into the CSV line the C++ layer expects.
function buildCsvLine(
  timestamp: Date,
  glucoseLevel: number,
  missingBg: number,
  meal: number,
  exercise: number,
  heartRate: number,
  gsr: number,
  steps: number,
  sleep: number,
  bolus: number,
  basal: number,
): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const dateStr =
    `${timestamp.getUTCFullYear()}-` +
    `${pad(timestamp.getUTCMonth() + 1)}-` +
    `${pad(timestamp.getUTCDate())} ` +
    `${pad(timestamp.getUTCHours())}:` +
    `${pad(timestamp.getUTCMinutes())}:` +
    `${pad(timestamp.getUTCSeconds())}`;

  return [
    dateStr,
    glucoseLevel,
    missingBg,
    meal,
    exercise,
    heartRate,
    gsr,
    steps,
    sleep,
    bolus,
    basal,
  ].join(',');
}

export function useGlucosePrediction(modelExportDir: string) {
  const loaded = useRef(false);

  useEffect(() => {
    if (!loaded.current) {
      try {
        NativeSampleModule.loadModel(modelExportDir);
        loaded.current = true;
        console.log('[Glucose] Model loaded from:', modelExportDir);
      } catch (e) {
        console.error('[Glucose] Failed to load model:', e);
      }
    }

    // Clear history when the hook unmounts (e.g. user logs out)
    return () => {
      NativeSampleModule.reset();
      loaded.current = false;
    };
  }, [modelExportDir]);

  /**
   * Call this every time a new CGM reading arrives (~every 5 minutes).
   * Returns the predicted glucose, or null if not enough history yet.
   */
  function submitReading(params: {
    timestamp: Date;
    glucoseLevel: number;
    missingBg?: number;
    meal?: number;
    exercise?: number;
    heartRate?: number;
    gsr?: number;
    steps?: number;
    sleep?: number;
    bolus?: number;
    basal?: number;
  }): number | null {
    if (!loaded.current) {
      console.warn('[Glucose] submitReading called before model loaded');
      return null;
    }

    const line = buildCsvLine(
      params.timestamp,
      params.glucoseLevel,
      params.missingBg ?? 0,
      params.meal ?? 0,
      params.exercise ?? 0,
      params.heartRate ?? 0,
      params.gsr ?? 0,
      params.steps ?? 0,
      params.sleep ?? 0,
      params.bolus ?? 0,
      params.basal ?? 0,
    );

    NativeSampleModule.addReading(line);

    const prediction = NativeSampleModule.predict();

    if (isNaN(prediction)) {
      console.log('[Glucose] Not enough history yet for prediction');
      return null;
    }

    console.log('[Glucose] Predicted glucose:', prediction);
    return prediction;
  }

  return { submitReading };
}
