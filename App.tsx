import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import RNFS from 'react-native-fs';
import NativeSampleModule from './specs/NativeSampleModule';
import { TIMELINE } from "./timeline_1000_hardcoded"

// Converts the timeline object into the exact 11 field raw CSV string C++ expects
function buildCsvLine(entry: (typeof TIMELINE)[0]): string {
  const { datetime, glucose, meal, exercise, heart_rate, steps, bolus, basal } =
    entry;
  return `${datetime},${glucose},0.0,${meal},${exercise},${heart_rate},0.0,${steps},0.0,${bolus},${basal}`;
}

type LogEntry = { text: string; kind: 'info' | 'ok' | 'warn' | 'err' };

export default function App() {
  const [modelLoaded, setModelLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [csvLine, setCsvLine] = useState(buildCsvLine(TIMELINE[0]));
  const [prediction, setPrediction] = useState<number | null>(null);
  const [readingCount, setReadingCount] = useState(0);
  const [log, setLog] = useState<LogEntry[]>([]);

  const scrollRef = useRef<ScrollView>(null);

  // Adds a new log entry and scrolls to the bottom
  function addLog(text: string, kind: LogEntry['kind'] = 'info') {
    setLog(prev => [...prev, { text, kind }]);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
  }

  // runs once when the app starts
  // copies model files then load the model nativly
  useEffect(() => {
    async function setup() {
      const destDir = `${RNFS.DocumentDirectoryPath}/mobile_export`;
      const files = [
        'meta.json',
        'thresholds.bin',
        'pos_mask.bin',
        'neg_mask.bin',
        'head_clause_weights.bin',
        'head_intercept.bin',
      ];

      try {
        await RNFS.mkdir(destDir);
        for (const file of files) {
          const src = `${RNFS.MainBundlePath}/${file}`;
          const dest = `${destDir}/${file}`;
          if (await RNFS.exists(dest)) await RNFS.unlink(dest);
          await RNFS.copyFile(src, dest);
        }
        addLog('Model files copied.', 'info');
      } catch (e: any) {
        addLog(`File copy failed:\n${e?.message ?? e}`, 'err');
        Alert.alert('Setup failed', e?.message ?? String(e));
        setLoading(false);
        return;
      }

      try {
        NativeSampleModule.loadModel(destDir);
        setModelLoaded(true);
        addLog('Model loaded.', 'ok');
      } catch (e: any) {
        addLog(`Model load failed:\n${e?.message ?? e}`, 'err');
        Alert.alert('Model load failed', e?.message ?? String(e));
      } finally {
        setLoading(false);
      }
    }

    setup();
    return () => {
      NativeSampleModule.reset();
    };
  }, []);

  // Replays the timeline through the native model one reading at a time
  // Logs each prediction and saves the last valid result
  function handleRunTimeline() {
    if (!modelLoaded) {
      addLog('Model not loaded.', 'warn');
      return;
    }

    try {
      const tButtonStart = performance.now();

      // Reset the timeline
      NativeSampleModule.reset();
      setReadingCount(0);
      setPrediction(null);
      addLog('── Running Python timeline ──', 'info');

      let count = 0;
      let lastPrediction: number | null = null;

      let totalPredictMs = 0;

      // Loops through each item in TIMELINE, convert into csv, sends the csv into native module with addReading
      for (const entry of TIMELINE) {
        const line = buildCsvLine(entry);
        NativeSampleModule.addReading(line);
        count++;

        const tPredictStart = performance.now();
        const result = NativeSampleModule.predict();
        const predictMs = performance.now() - tPredictStart;

        totalPredictMs += predictMs;

        const predStr = isNaN(result)
          ? '(not ready)'
          : `${result.toFixed(1)} mg/dL`;
        addLog(
          `${entry.datetime}  glucose=${entry.glucose}  → ${predStr}`,
          isNaN(result) ? 'warn' : 'ok',
        );

        if (!isNaN(result)) lastPrediction = result;
      }

      setReadingCount(count);

      const totalMs = performance.now() - tButtonStart;

      if (lastPrediction !== null) setPrediction(lastPrediction);
      addLog(
        `mg/dL (predict=${totalPredictMs.toFixed(2)}ms total=${totalMs.toFixed(
          2,
        )}ms)`,
        'ok',
      );
    } catch (e: any) {
      addLog(`Error: ${e?.message ?? e}`, 'err');
    }
  }

  // Sends the line in the custom raw line. ONLY FOR DEBUG
  function handleAddReading() {
    if (!modelLoaded) {
      addLog('Model not loaded.', 'warn');
      return;
    }
    const line = csvLine.trim();
    if (!line) {
      addLog('CSV line is empty.', 'warn');
      return;
    }

    const tButtonStart = performance.now();
    try {
      const fieldCount = line.split(',').length;
      if (fieldCount === 11) {
        NativeSampleModule.addReading(line);
      } else if (fieldCount === 21) {
        NativeSampleModule.addEngineeredReading(line);
      } else {
        addLog(
          `Bad field count: ${fieldCount}. Expected 11 (raw) or 21 (engineered).`,
          'err',
        );
        return;
      }

      const count = readingCount + 1;
      setReadingCount(count);

      const tPredictStart = performance.now();
      const result = NativeSampleModule.predict();
      const predictMs = performance.now() - tPredictStart;
      const totalMs = performance.now() - tButtonStart;
      if (isNaN(result)) {
        setPrediction(null);
        addLog(
          `Reading #${count} added — not ready yet. predict=${predictMs.toFixed(2)}ms total=${totalMs.toFixed(2)}ms`,
          'warn',
        );
      } else {
        setPrediction(result);
        addLog(
          `Reading #${count} → ${result.toFixed(1)} mg/dL (predict=${predictMs.toFixed(2)}ms total=${totalMs.toFixed(2)}ms)`,
          'ok',
        );
      }
    } catch (e: any) {
      addLog(`Error: ${e?.message ?? e}`, 'err');
    }
  }

  function handleReset() {
    NativeSampleModule.reset();
    setReadingCount(0);
    setPrediction(null);
    addLog('Session reset.', 'info');
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.title}>Glucose Predictor</Text>

        <View
          style={[styles.pill, modelLoaded ? styles.pillOk : styles.pillWarn]}
        >
          {loading ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.pillText}>
              {modelLoaded ? '✓ Model loaded' : '✗ Model not loaded'}
            </Text>
          )}
        </View>

        {/* Prediction display */}
        <View style={styles.predBox}>
          <Text style={styles.predLabel}>Latest prediction</Text>
          <Text style={styles.predValue}>
            {prediction !== null ? `${prediction.toFixed(1)}` : '—'}
          </Text>
          {prediction !== null && <Text style={styles.predUnit}>mg/dL</Text>}
          <Text style={styles.predSub}>
            {readingCount} reading{readingCount !== 1 ? 's' : ''} added
          </Text>
        </View>

        {/* Custom CSV input */}
        <Text style={styles.inputLabel}>
          Custom raw line (11 fields) or engineered (21 fields)
        </Text>
        <TextInput
          style={styles.input}
          value={csvLine}
          onChangeText={setCsvLine}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          placeholderTextColor="#888"
        />

        {/* Buttons */}
        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={[
              styles.btn,
              styles.btnPrimary,
              !modelLoaded && styles.btnDisabled,
            ]}
            onPress={handleRunTimeline}
            disabled={!modelLoaded}
          >
            <Text style={styles.btnText}>Run Python Timeline</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.btn,
              styles.btnSecondary,
              !modelLoaded && styles.btnDisabled,
            ]}
            onPress={handleAddReading}
            disabled={!modelLoaded}
          >
            <Text style={[styles.btnText, { color: '#333' }]}>
              Add + Predict
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.btn, styles.btnSecondary]}
            onPress={handleReset}
          >
            <Text style={[styles.btnText, { color: '#333' }]}>Reset</Text>
          </TouchableOpacity>
        </View>

        {/* Log */}
        <Text style={styles.logLabel}>Log</Text>
        <ScrollView ref={scrollRef} style={styles.logBox}>
          {log.map((entry, i) => (
            <Text key={i} style={[styles.logLine, logLineStyle(entry.kind)]}>
              {entry.text}
            </Text>
          ))}
          {log.length === 0 && (
            <Text style={styles.logEmpty}>Nothing yet.</Text>
          )}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

function logLineStyle(kind: LogEntry['kind']) {
  switch (kind) {
    case 'ok':
      return { color: '#2e7d32' };
    case 'warn':
      return { color: '#e65100' };
    case 'err':
      return { color: '#c62828' };
    default:
      return { color: '#222' };
  }
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f5f5f5' },
  container: { flex: 1, padding: 20 },

  title: { fontSize: 22, fontWeight: '700', marginBottom: 12, color: '#111' },

  pill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    marginBottom: 16,
  },
  pillOk: { backgroundColor: '#2e7d32' },
  pillWarn: { backgroundColor: '#b71c1c' },
  pillText: { color: '#fff', fontSize: 13, fontWeight: '600' },

  predBox: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
    marginBottom: 20,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  predLabel: { fontSize: 13, color: '#888', marginBottom: 4 },
  predValue: {
    fontSize: 56,
    fontWeight: '700',
    color: '#1a237e',
    lineHeight: 64,
  },
  predUnit: { fontSize: 18, color: '#5c6bc0', marginTop: -4, marginBottom: 4 },
  predSub: { fontSize: 12, color: '#aaa', marginTop: 6 },

  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#555',
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    padding: 10,
    fontSize: 12,
    fontFamily: 'Menlo',
    color: '#111',
    minHeight: 60,
    marginBottom: 14,
  },

  buttonRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  btn: { flex: 1, paddingVertical: 13, borderRadius: 8, alignItems: 'center' },
  btnPrimary: { backgroundColor: '#1a237e' },
  btnSecondary: { backgroundColor: '#e0e0e0' },
  btnDisabled: { backgroundColor: '#9fa8da' },
  btnText: { color: '#fff', fontWeight: '600', fontSize: 14, textAlign: "center" },

  logLabel: { fontSize: 13, fontWeight: '600', color: '#555', marginBottom: 6 },
  logBox: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    padding: 10,
  },
  logLine: {
    fontSize: 12,
    fontFamily: 'Menlo',
    marginBottom: 4,
    lineHeight: 18,
  },
  logEmpty: { fontSize: 12, color: '#bbb', fontStyle: 'italic' },
});
