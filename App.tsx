import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Platform,
} from 'react-native';
import RNFS from 'react-native-fs';
import NativeSampleModule from './specs/NativeSampleModule';
const ONE_PATIENT_VAL_ASSET = require('./one_patient_val.csv');

const PATIENT_VAL_ASSETS: Record<number, any> = {
  1: require('./patient_val/patient_1_val.csv'),
  2: require('./patient_val/patient_2_val.csv'),
  3: require('./patient_val/patient_3_val.csv'),
  4: require('./patient_val/patient_4_val.csv'),
  5: require('./patient_val/patient_5_val.csv'),
  6: require('./patient_val/patient_6_val.csv'),
  7: require('./patient_val/patient_7_val.csv'),
  8: require('./patient_val/patient_8_val.csv'),
  9: require('./patient_val/patient_9_val.csv'),
  10: require('./patient_val/patient_10_val.csv'),
  11: require('./patient_val/patient_11_val.csv'),
  12: require('./patient_val/patient_12_val.csv'),
};

async function loadValCsvLines(
  valAsset: any,
  valFileName: string,
): Promise<string[]> {
  const assetSource = Image.resolveAssetSource(valAsset);
  const assetUri = assetSource?.uri;

  if (!assetUri) {
    throw new Error(`Could not resolve bundled ${valFileName} asset.`);
  }

  let csvText = '';

  try {
    const response = await fetch(assetUri);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    csvText = await response.text();
  } catch {
    // Fallback: Android assets vs iOS bundle.
    if (Platform.OS === 'android') {
      csvText = await RNFS.readFileAssets(valFileName, 'utf8');
    } else {
      const bundlePath = `${RNFS.MainBundlePath}/${valFileName}`;
      csvText = await RNFS.readFile(bundlePath, 'utf8');
    }
  }

  const lines = csvText
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    throw new Error(`${valFileName} is empty.`);
  }

  const firstLine = lines[0].toLowerCase();
  const dataLines =
    firstLine.startsWith('date,') || firstLine.startsWith('datetime,')
      ? lines.slice(1)
      : lines;

  const validLines = dataLines.filter(line => line.split(',').length === 11);
  if (validLines.length === 0) {
    throw new Error(`${valFileName} has no valid 11-field data lines.`);
  }

  return validLines;
}

type LogEntry = { text: string; kind: 'info' | 'ok' | 'warn' | 'err' };
type PredictionRow = {
  datetime: string;
  glucose: string;
  prediction: string;
  requestMs: string;
  predictMs: string;
};
const LOG_CAP = 100;

function percentile(values: number[], p: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[idx];
}

function formatPerfSummary(label: string, latenciesMs: number[]): string {
  if (latenciesMs.length === 0) {
    return `${label}: no requests`;
  }

  const totalMs = latenciesMs.reduce((sum, x) => sum + x, 0);
  const avgMs = totalMs / latenciesMs.length;
  const p50 = percentile(latenciesMs, 50);
  const p95 = percentile(latenciesMs, 95);
  const p99 = percentile(latenciesMs, 99);
  const rps = totalMs > 0 ? (latenciesMs.length * 1000) / totalMs : 0;

  return `${label}: avg=${avgMs.toFixed(2)}ms p50=${p50.toFixed(2)}ms p95=${p95.toFixed(2)}ms p99=${p99.toFixed(2)}ms total_request_time=${totalMs.toFixed(2)}ms rps=${rps.toFixed(2)}`;
}

export default function App() {
  const [modelLoaded, setModelLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [csvLine, setCsvLine] = useState('');
  const [prediction, setPrediction] = useState<number | null>(null);
  const [readingCount, setReadingCount] = useState(0);
  const [log, setLog] = useState<LogEntry[]>([]);
  const predictionsRef = useRef<PredictionRow[]>([]);
  const requestTimesRef = useRef<number[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState<number>(1);
  const [valPickerOpen, setValPickerOpen] = useState(false);

  const scrollRef = useRef<ScrollView>(null);

  const selectedValFileName = `patient_${selectedPatientId}_val.csv`;
  const selectedValAsset =
    PATIENT_VAL_ASSETS[selectedPatientId] ?? ONE_PATIENT_VAL_ASSET;

  // Adds a new log entry and scrolls to the bottom
  function addLog(text: string, kind: LogEntry['kind'] = 'info') {
    setLog(prev => [...prev, { text, kind }].slice(-LOG_CAP));
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
          const isIOS = Platform.OS === 'ios';
          const src = isIOS ? `${RNFS.MainBundlePath}/${file}` : file;
          const dest = `${destDir}/${file}`;
          if (await RNFS.exists(dest)) await RNFS.unlink(dest);
            if (isIOS) {
            await RNFS.copyFile(src, dest);
          } else {
            await RNFS.copyFileAssets(src, dest);
          }
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
  async function handleRunTimeline() {
    if (!modelLoaded) {
      addLog('Model not loaded.', 'warn');
      return;
    }

    try {
      const timelineLines = await loadValCsvLines(
        selectedValAsset,
        selectedValFileName,
      );

      // Reset the timeline
      NativeSampleModule.reset();
      setReadingCount(0);
      setPrediction(null);
      predictionsRef.current = [];
      addLog(
        `── Running ${selectedValFileName} timeline (${timelineLines.length} rows) ──`,
        'info',
      );

      let count = 0;
      let lastPrediction: number | null = null;

      const runRequestTimesMs: number[] = [];

      for (const line of timelineLines) {
        const tRequestStart = performance.now();
        NativeSampleModule.addReading(line);
        count++;

        const tPredictStart = performance.now();
        const result = NativeSampleModule.predict();
        const predictMs = performance.now() - tPredictStart;
        const requestMs = performance.now() - tRequestStart;

        runRequestTimesMs.push(requestMs);
        requestTimesRef.current.push(requestMs);

        const [datetime, glucose] = line.split(',');
        const predStr = isNaN(result)
          ? '(not ready)'
          : `${result.toFixed(4)} mg/dL`;
        addLog(
          `${datetime} glucose=${glucose} → ${predStr} (request=${requestMs.toFixed(2)}ms predict=${predictMs.toFixed(2)}ms)`,
          isNaN(result) ? 'warn' : 'ok',
        );
        predictionsRef.current.push({
          datetime,
          glucose,
          prediction: isNaN(result) ? '' : result.toFixed(4),
          requestMs: requestMs.toFixed(2),
          predictMs: predictMs.toFixed(2),
        });

        if (!isNaN(result)) lastPrediction = result;
      }

      setReadingCount(count);
      setCsvLine(timelineLines[0]);

      if (lastPrediction !== null) setPrediction(lastPrediction);
      addLog(
        formatPerfSummary(`${selectedValFileName} run metrics`, runRequestTimesMs),
        'info',
      );
      addLog(
        formatPerfSummary(
          'Session request metrics',
          requestTimesRef.current,
        ),
        'info',
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
      const requestMs = performance.now() - tButtonStart;
      requestTimesRef.current.push(requestMs);
      if (isNaN(result)) {
        setPrediction(null);
        addLog(
          `Reading #${count} added — not ready yet. request=${requestMs.toFixed(2)}ms predict=${predictMs.toFixed(2)}ms`,
          'warn',
        );
      } else {
        setPrediction(result);
        addLog(
          `Reading #${count} → ${result.toFixed(4)} mg/dL (request=${requestMs.toFixed(2)}ms predict=${predictMs.toFixed(2)}ms)`,
          'ok',
        );
      }
      addLog(
        formatPerfSummary('Session request metrics', requestTimesRef.current),
        'info',
      );
    } catch (e: any) {
      addLog(`Error: ${e?.message ?? e}`, 'err');
    }
  }

  function handleReset() {
    NativeSampleModule.reset();
    requestTimesRef.current = [];
    predictionsRef.current = [];
    setReadingCount(0);
    setPrediction(null);
    addLog('Session reset.', 'info');
  }

  async function handleSavePredictionsCsv() {
    if (predictionsRef.current.length === 0) {
      addLog('No predictions to save yet.', 'warn');
      return;
    }

    try {
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const fileName = `predictions_${now.getFullYear()}${pad(
        now.getMonth() + 1,
      )}${pad(now.getDate())}_${pad(now.getHours())}${pad(
        now.getMinutes(),
      )}${pad(now.getSeconds())}.csv`;
      const destPath = `${RNFS.DocumentDirectoryPath}/${fileName}`;

      const header = 'datetime,glucose,prediction,request_ms,predict_ms';
      const rows = predictionsRef.current.map(
        row =>
          `${row.datetime},${row.glucose},${row.prediction},${row.requestMs},${row.predictMs}`,
      );
      const csv = `${header}\n${rows.join('\n')}\n`;

      await RNFS.writeFile(destPath, csv, 'utf8');
      addLog(`Saved predictions CSV: ${destPath}`, 'ok');
    } catch (e: any) {
      addLog(`Save failed: ${e?.message ?? e}`, 'err');
    }
  }

  async function handleRunServerBenchmark() {
    if (!modelLoaded) {
      addLog('Model not loaded.', 'warn');
      return;
    }
  
    const baseUrl = 'http://192.168.68.131:8000'; // or whatever URL you want
    const headers = { 'Content-Type': 'application/json' };
  
    addLog(
      `── Running server benchmark from ${selectedValFileName} ──`,
      'info',
    );
  
    let success = 0;
    let fail = 0;
    const latencies: number[] = [];
  
    // Optional: reset server
    try {
      await fetch(`${baseUrl}/reset`, { method: 'POST', headers, body: '{}' });
    } catch {
      /* ignore */
    }
  
    const lines = await loadValCsvLines(selectedValAsset, selectedValFileName);
  
    for (const line of lines) {
      const parts = line.split(',');
      if (parts.length !== 11) continue;

  
      const [
        datetime,
        glucose,
        meal,
        exercise,
        heartRate,
        steps,
        , // sleep or unused
        bolus,
        basal,
        , // extra
        , // extra
      ] = parts;
      const payload = {
        glucose: parseFloat(glucose),
        meal: parseFloat(meal || '0'),
        bolus: parseFloat(bolus || '0'),
        basal: parseFloat(basal || '0'),
        exercise: parseFloat(exercise || '0'),
        basis_heart_rate: parseFloat(heartRate || '0'),
        basis_steps: parseFloat(steps || '0'),
        basis_sleep: parseFloat(sleep || '0'),
        timestamp: datetime,
      };
  
      try {
        const t0 = performance.now();
        const res = await fetch(`${baseUrl}/predict`, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        });
        const t1 = performance.now();
        const latencyMs = t1 - t0;
  
        latencies.push(latencyMs);
  
        const data = await res.json();
        const status = data.message ?? '';
        const pred = data.prediction as number | null;
        const predictMs = data.predict_ms as number | null;
  
        success += 1;
  
        const extras: string[] = [];
        if (payload.meal > 0) extras.push(`meal=${payload.meal}g`);
        if (payload.bolus > 0) extras.push(`bolus=${payload.bolus}u`);
        const extrasStr = extras.length ? ` [${extras.join(', ')}]` : '';
  
        const predStr =
          pred != null && !isNaN(pred) ? `${pred.toFixed(4)} mg/dL` : '(not ready)';
  
        addLog(
          `${datetime} glucose=${payload.glucose}${extrasStr} → ${predStr} (status="${status}" request=${latencyMs.toFixed(
            2,
          )}ms predict=${predictMs ?? '—'}ms)`,
          pred != null && !isNaN(pred) ? 'ok' : 'warn',
        );
      } catch (e: any) {
        fail += 1;
        addLog(
          `${datetime} glucose=${payload.glucose} → REQUEST FAILED (${e?.message ?? e})`,
          'err',
        );
      }
    }
  
    if (latencies.length) {
      // Keep the same output format as the mobile inference path
      // (avg/p50/p95/p99 + total_request_time + rps).
      addLog(
        formatPerfSummary(`${selectedValFileName} run metrics`, latencies),
        'info',
      );
      addLog(
        formatPerfSummary('Session request metrics', latencies),
        'info',
      );

      addLog(
        `Reliability (server): success=${success} fail=${fail} failure_rate=${(((fail / (success + fail)) * 100) || 0).toFixed(2)}%`,
        fail > 0 ? 'warn' : 'ok',
      );
    } else {
      addLog(
        `Server benchmark: no successful requests (success=${success} fail=${fail})`,
        'err',
      );
    }
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
            {prediction !== null ? `${prediction.toFixed(4)}` : '—'}
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

        {/* Val file selector */}
        <TouchableOpacity
          style={[styles.pill, styles.pillNeutral]}
          onPress={() => setValPickerOpen(true)}
        >
          <Text style={styles.pillText}>Val file: {selectedValFileName}</Text>
        </TouchableOpacity>

        <Modal
          transparent
          visible={valPickerOpen}
          animationType="fade"
          onRequestClose={() => setValPickerOpen(false)}
        >
          <TouchableOpacity
            style={styles.modalBackdrop}
            activeOpacity={1}
            onPress={() => setValPickerOpen(false)}
          />
          <View style={styles.modalSheet}>
            <ScrollView style={styles.modalList}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map(id => {
                const name = `patient_${id}_val.csv`;
                const isSelected = id === selectedPatientId;
                return (
                  <TouchableOpacity
                    key={id}
                    style={[
                      styles.modalItem,
                      isSelected && styles.modalItemSelected,
                    ]}
                    onPress={() => {
                      setSelectedPatientId(id);
                      setValPickerOpen(false);
                    }}
                  >
                    <Text
                      style={[
                        styles.modalItemText,
                        isSelected && styles.modalItemTextSelected,
                      ]}
                    >
                      {name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </Modal>

        {/* Buttons */}
        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={[
              styles.btn,
              styles.btnSecondary,
              !modelLoaded && styles.btnDisabled,
            ]}
            onPress={handleRunServerBenchmark}
            disabled={!modelLoaded}
          >
            <Text style={[styles.btnText, { color: '#333' }]}>
              Run Server Benchmark
            </Text>
          </TouchableOpacity>
        </View>

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
            <Text style={styles.btnText}>Run {selectedValFileName} Timeline</Text>
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

          <TouchableOpacity
            style={[styles.btn, styles.btnSecondary]}
            onPress={handleSavePredictionsCsv}
          >
            <Text style={[styles.btnText, { color: '#333' }]}>
              Save Predictions CSV
            </Text>
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
  pillNeutral: { backgroundColor: '#444' },

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

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  modalSheet: {
    position: 'absolute',
    top: 120,
    left: 20,
    right: 20,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 10,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  modalList: { maxHeight: 320 },
  modalItem: {
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: '#f2f2f2',
    marginBottom: 8,
  },
  modalItemSelected: {
    backgroundColor: '#1a237e',
  },
  modalItemText: {
    color: '#111',
    fontWeight: '600',
  },
  modalItemTextSelected: {
    color: '#fff',
  },

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
  btnText: { color: '#fff', fontWeight: '600', fontSize: 14, textAlign: 'center' },

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
