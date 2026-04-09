import { useEffect, useRef, useState } from 'react';
import { Alert, Platform, ScrollView } from 'react-native';
import RNFS from 'react-native-fs';
import NativeSampleModule from '../../specs/NativeSampleModule';
import { loadValCsvLines, formatPerfSummary } from './csvFunctions';
import {
  PATIENT_VAL_ASSETS,
  PATIENT_VAL_FILE_NAMES,
  ONE_PATIENT_VAL_ASSET,
  DEFAULT_CSV_LINE,
  SERVER_BASE_URL,
  GLUCOSE_TIMELINE_API_BASE_URL,
  LV_PATIENT_ID,
} from '../config/patientAssets';
import { LogEntry, PredictionRow, LOG_CAP } from '../types/types';
import { useBenchmark } from './benchmarkFunctions';

const API_TIMELINE_REPEAT_COUNT = 50;

export function useAppFunctions() {
  const [modelLoaded, setModelLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [csvLine, setCsvLine] = useState(DEFAULT_CSV_LINE);
  const [prediction, setPrediction] = useState<number | null>(null);
  const [readingCount, setReadingCount] = useState(0);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState<number>(1);
  const [valPickerOpen, setValPickerOpen] = useState(false);
  const [useServer, setUseServer] = useState(false);
  const [useTimelineApi, setUseTimelineApi] = useState(false);

  const predictionsRef = useRef<PredictionRow[]>([]);
  const requestTimesRef = useRef<number[]>([]);
  const scrollRef = useRef<ScrollView>(null);

  const selectedValFileName =
    PATIENT_VAL_FILE_NAMES[selectedPatientId] ??
    `patient_${selectedPatientId}_val.csv`;
  const selectedValAsset =
    PATIENT_VAL_ASSETS[selectedPatientId] ?? ONE_PATIENT_VAL_ASSET;

  function addLog(text: string, kind: LogEntry['kind'] = 'info') {
    setLog(prev => [...prev, { text, kind }].slice(-LOG_CAP));
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
  }

  const {
    benchmarkRunning,
    readingsDone: benchmarkReadingsDone,
    totalReadings: benchmarkTotalReadings,
    elapsedS: benchmarkElapsedS,
    startBenchmark,
    finish,
  } = useBenchmark(addLog);

  function lineToServerPayload(line: string) {
    const parts = line.split(',');
    if (parts.length !== 11) {
      throw new Error(`Bad field count: ${parts.length}. Expected 11 raw fields.`);
    }
    const [
      datetime,
      glucose,
      _missingBg,
      meal,
      exercise,
      heartRate,
      _gsr,
      steps,
      sleep,
      bolus,
      basal,
    ] = parts;
    return {
      datetime,
      payload: {
        glucose: parseFloat(glucose),
        meal: parseFloat(meal || '0'),
        bolus: parseFloat(bolus || '0'),
        basal: parseFloat(basal || '0'),
        exercise: parseFloat(exercise || '0'),
        basis_heart_rate: parseFloat(heartRate || '0'),
        basis_steps: parseFloat(steps || '0'),
        basis_sleep: parseFloat(sleep || '0'),
        timestamp: datetime,
      },
    };
  }

  async function resetServerSession() {
    try {
      await fetch(`${SERVER_BASE_URL}/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
    } catch {
      // Ignore reset failures so a later request can report the real issue.
    }

    try {
      await fetch(`${normalizeApiBaseUrl(GLUCOSE_TIMELINE_API_BASE_URL)}/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
    } catch {
      // Best effort reset for local timeline API index.
    }
  }

  function normalizeApiBaseUrl(url: string): string {
    return url.endsWith('/') ? url.slice(0, -1) : url;
  }

  function buildDefaultCsvLine(
    datetime: string,
    glucose: number,
    extras?: { meal?: number; bolus?: number },
  ): string {
    const meal = Number.isFinite(extras?.meal) ? Number(extras?.meal) : 0;
    const bolus = Number.isFinite(extras?.bolus) ? Number(extras?.bolus) : 0;
    return [
      datetime,
      glucose.toFixed(1),
      '0.0',
      meal.toFixed(1),
      '0.0',
      '93.0',
      '0.01556',
      '0.0',
      '0.0',
      bolus.toFixed(1),
      '0.0',
    ].join(',');
  }

  function parseNumberish(value: unknown): number | null {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function normalizeLluTimestamp(raw: string): string {
    // ISO format: "2024-11-14T10:15:27" or "2024-11-14 10:15:27" → already correct
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
      return raw.replace('T', ' ').substring(0, 19);
    }

    // LibreLink Up format: "11/14/2024 10:15:27 AM" → "2024-11-14 10:15:27"
    const lluMatch = raw.match(
      /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)?/i,
    );
    if (lluMatch) {
      const [, month, day, year, rawHour, min, sec, ampm] = lluMatch;
      let hour = parseInt(rawHour, 10);
      if (ampm) {
        if (ampm.toUpperCase() === 'AM' && hour === 12) hour = 0;
        if (ampm.toUpperCase() === 'PM' && hour !== 12) hour += 12;
      }
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')} ${String(hour).padStart(2, '0')}:${min}:${sec}`;
    }

    // Fallback: return as-is and let C++ try
    return raw.replace('T', ' ').substring(0, 19);
  }

  function parseLluGlucoseRow(row: any): string | null {
    if (!row || typeof row !== 'object') return null;
    const valueMmol = parseNumberish(row?.Value);
    if (valueMmol == null) return null;
    const glucose = valueMmol * 18.018;

    const datetime = normalizeLluTimestamp(String(row?.Timestamp ?? row?.FactoryTimestamp ?? ''));
    if (!datetime) return null;

    const meal = parseNumberish(row?.carbs) ?? parseNumberish(row?.meal) ?? 0;
    const bolus = parseNumberish(row?.insulin) ?? parseNumberish(row?.bolus) ?? 0;
    return buildDefaultCsvLine(datetime, glucose, { meal, bolus });
  }
//
  function parseGraphApiToCsvLines(data: any): string[] {
    const graphRows = Array.isArray(data?.data?.graphData)
      ? data.data.graphData
      : Array.isArray(data?.graphData)
        ? data.graphData
        : [];
    return graphRows
      .map((row: any) => parseLluGlucoseRow(row))
      .filter((line: string | null): line is string => Boolean(line));
  }

  async function loadTimelineLines(): Promise<string[]> {
    return loadValCsvLines(selectedValAsset, selectedValFileName);
  }

  // Fetches the graph endpoint and returns the most recent reading (last in graphData).
  async function fetchLatestFromGraph(): Promise<{ line: string; fetchMs: number }> {
    const baseUrl = normalizeApiBaseUrl(GLUCOSE_TIMELINE_API_BASE_URL);
    const connId = LV_PATIENT_ID;
    const graphUrl = `${baseUrl}/llu/connections/${connId}/graph`;
    const tFetchStart = performance.now();
    const res = await fetch(graphUrl);
    const fetchMs = performance.now() - tFetchStart;
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} (${graphUrl})`);
    }
    const json = await res.json();
    const lines = parseGraphApiToCsvLines(json);
    if (lines.length === 0) {
      throw new Error(`No parseable glucose rows from graph (${graphUrl})`);
    }
    // graphData is ordered oldest → newest; take the last entry
    return { line: lines[lines.length - 1], fetchMs };
  }

  async function sendServerReading(
    line: string,
    count: number,
    fetchMs?: number,
  ): Promise<PredictionRow> {
    const headers = { 'Content-Type': 'application/json' };
    const { datetime, payload } = lineToServerPayload(line);
    const extras: string[] = [];
    if (payload.meal > 0) extras.push(`meal=${payload.meal}g`);
    if (payload.bolus > 0) extras.push(`bolus=${payload.bolus}u`);
    const extrasStr = extras.length ? ` [${extras.join(', ')}]` : '';

    const t0 = performance.now();
    const res = await fetch(`${SERVER_BASE_URL}/predict`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    const latencyMs = performance.now() - t0;
    const data = await res.json();
    const pred = data.prediction as number | null;
    const predictMs = data.predict_ms as number | null;
    const status = data.message ?? '';
    const predictMsFinite =
      predictMs != null && Number.isFinite(predictMs) ? Number(predictMs) : null;

    // For API timeline mode, include Libre fetch in final request metrics.
    requestTimesRef.current.push(latencyMs + (fetchMs ?? 0));
    setReadingCount(count);

    if (pred != null && !isNaN(pred)) {
      setPrediction(pred);
      addLog(
        `${datetime} glucose=${payload.glucose}${extrasStr} → ${pred.toFixed(4)} mg/dL (status="${status}"${fetchMs != null ? ` fetch=${fetchMs.toFixed(2)}ms` : ''} request=${latencyMs.toFixed(2)}ms predict=${predictMsFinite != null ? predictMsFinite.toFixed(2) : '—'}ms)`,
        'ok',
      );
    } else {
      setPrediction(null);
      addLog(
        `${datetime} glucose=${payload.glucose}${extrasStr} → (not ready) (status="${status}"${fetchMs != null ? ` fetch=${fetchMs.toFixed(2)}ms` : ''} request=${latencyMs.toFixed(2)}ms predict=${predictMsFinite != null ? predictMsFinite.toFixed(2) : '—'}ms)`,
        'warn',
      );
    }

    return {
      datetime,
      glucose: String(payload.glucose),
      prediction: pred != null && !isNaN(pred) ? pred.toFixed(4) : '',
      fetchMs: fetchMs != null ? fetchMs.toFixed(2) : '',
      requestMs: latencyMs.toFixed(2),
      predictMs: predictMsFinite != null ? predictMsFinite.toFixed(2) : '',
    };
  }

  // Copies model files from bundle/assets into DocumentDirectory, then loads the C++ model.
  useEffect(() => {
    async function setup() {
      const destDir = `${RNFS.DocumentDirectoryPath}/mobile_export`;
      const files = [
        'meta.json',
        'thresholds.bin',
        'pos_mask.bin',
        'neg_mask.bin',
        'clause_weights.bin',
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

  // Replays the selected val CSV through the model (device or server) one reading at a time.
  async function handleRunTimeline() {
    if (!modelLoaded) {
      addLog('Model not loaded.', 'warn');
      return;
    }

    try {
      const timelineLines = useTimelineApi ? [] : await loadTimelineLines();
      const timelineLabel = useTimelineApi
        ? `timeline API /graph latest x${API_TIMELINE_REPEAT_COUNT}`
        : selectedValFileName;

      if (useServer) {
        await resetServerSession();
      } else {
        NativeSampleModule.reset();
      }
      setReadingCount(0);
      setPrediction(null);
      predictionsRef.current = [];
      addLog(
        `── Running ${timelineLabel} on ${useServer ? 'server' : 'device'} (${useTimelineApi ? API_TIMELINE_REPEAT_COUNT : timelineLines.length} rows) ──`,
        'info',
      );

      let count = 0;
      let lastPrediction: number | null = null;
      const runRequestTimesMs: number[] = [];
      let firstLineUsed: string | null = null;

      const totalRows = useTimelineApi ? API_TIMELINE_REPEAT_COUNT : timelineLines.length;
      for (let i = 0; i < totalRows; i++) {
        let line = timelineLines[i];
        let fetchMs: number | undefined;
        if (useTimelineApi) {
          const latest = await fetchLatestFromGraph();
          line = latest.line;
          fetchMs = latest.fetchMs;
        }
        if (!firstLineUsed) firstLineUsed = line;
        count++;
        if (useServer) {
          const serverRow = await sendServerReading(line, count, fetchMs);
          runRequestTimesMs.push(Number(serverRow.requestMs) + (fetchMs ?? 0));
          const serverPredictMs = Number(serverRow.predictMs);
          predictionsRef.current.push(serverRow);
          if (serverRow.prediction) lastPrediction = Number(serverRow.prediction);
        } else {
          const tRequestStart = performance.now();
          NativeSampleModule.addReading(line);

          const tPredictStart = performance.now();
          const result = NativeSampleModule.predict();
          const predictMs = performance.now() - tPredictStart;
          const requestMs = performance.now() - tRequestStart;

          runRequestTimesMs.push(requestMs + (fetchMs ?? 0));
          requestTimesRef.current.push(requestMs + (fetchMs ?? 0));

          const [datetime, glucose] = line.split(',');
          addLog(
            `${datetime} glucose=${glucose} → ${isNaN(result) ? '(not ready)' : `${result.toFixed(4)} mg/dL`} (${fetchMs != null ? `fetch=${fetchMs.toFixed(2)}ms ` : ''}request=${requestMs.toFixed(2)}ms predict=${predictMs.toFixed(2)}ms)`,
            isNaN(result) ? 'warn' : 'ok',
          );
          predictionsRef.current.push({
            datetime,
            glucose,
            prediction: isNaN(result) ? '' : result.toFixed(4),
            fetchMs: fetchMs != null ? fetchMs.toFixed(2) : '',
            requestMs: requestMs.toFixed(2),
            predictMs: predictMs.toFixed(2),
          });

          setReadingCount(count);
          if (!isNaN(result)) {
            lastPrediction = result;
            setPrediction(result);
          } else {
            setPrediction(null);
          }
        }
      }

      setReadingCount(count);
      if (firstLineUsed) setCsvLine(firstLineUsed);
      if (lastPrediction !== null) setPrediction(lastPrediction);
      addLog(formatPerfSummary(`${timelineLabel} run metrics`, runRequestTimesMs), 'info');
      addLog('', 'info');
      addLog(formatPerfSummary('Session request metrics', requestTimesRef.current), 'info');
    } catch (e: any) {
      addLog(`Error: ${e?.message ?? e}`, 'err');
    }
  }

  // Sends a single custom CSV line (debug).
  async function handleAddReading() {
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
      if (useServer) {
        const fieldCount = line.split(',').length;
        if (fieldCount !== 11) {
          addLog(`Bad field count: ${fieldCount}. Server mode expects 11 raw fields.`, 'err');
          return;
        }
        const count = readingCount + 1;
        const serverRow = await sendServerReading(line, count);
        predictionsRef.current.push(serverRow);
        addLog(formatPerfSummary('Session request metrics', requestTimesRef.current), 'info');
        return;
      }

      const fieldCount = line.split(',').length;
      if (fieldCount === 11) {
        NativeSampleModule.addReading(line);
      } else if (fieldCount === 21) {
        NativeSampleModule.addEngineeredReading(line);
      } else {
        addLog(`Bad field count: ${fieldCount}. Expected 11 (raw) or 21 (engineered).`, 'err');
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
      addLog(formatPerfSummary('Session request metrics', requestTimesRef.current), 'info');
    } catch (e: any) {
      addLog(`Error: ${e?.message ?? e}`, 'err');
    }
  }

  async function handleStartBenchmark() {
    try {
      const timelineLabel = useTimelineApi ? 'timeline API current endpoint' : selectedValFileName;
      requestTimesRef.current = [];
      predictionsRef.current = [];
      setReadingCount(0);
      setPrediction(null);

      if (useServer) {
        await resetServerSession();
        if (useTimelineApi) {
          await startBenchmark(
            ['api-graph'],
            async (_line, count) => {
              const { line: latestLine, fetchMs } = await fetchLatestFromGraph();
              const serverRow = await sendServerReading(latestLine, count, fetchMs);
              predictionsRef.current.push(serverRow);
            },
            `server (${timelineLabel})`,
          );
          return;
        }

        const lines = await loadTimelineLines();
        await startBenchmark(
          lines,
          async (line, count) => {
            const serverRow = await sendServerReading(line, count);
            predictionsRef.current.push(serverRow);
          },
          `server (${timelineLabel})`,
        );
      } else {
        NativeSampleModule.reset();
        if (useTimelineApi) {
          await resetServerSession();
          await startBenchmark(
            ['api-graph'],
            async (_line, count) => {
              const { line: latestLine, fetchMs } = await fetchLatestFromGraph();
              const tRequestStart = performance.now();
              NativeSampleModule.addReading(latestLine);
              const tPredictStart = performance.now();
              const result = NativeSampleModule.predict();
              const predictMs = performance.now() - tPredictStart;
              const requestMs = performance.now() - tRequestStart;

              requestTimesRef.current.push(requestMs + fetchMs);
              const [datetime, glucose] = latestLine.split(',');
              addLog(
                `${datetime} glucose=${glucose} → ${isNaN(result) ? '(not ready)' : `${result.toFixed(4)} mg/dL`} (fetch=${fetchMs.toFixed(2)}ms request=${requestMs.toFixed(2)}ms predict=${predictMs.toFixed(2)}ms)`,
                isNaN(result) ? 'warn' : 'ok',
              );
              predictionsRef.current.push({
                datetime,
                glucose,
                prediction: isNaN(result) ? '' : result.toFixed(4),
                fetchMs: fetchMs.toFixed(2),
                requestMs: requestMs.toFixed(2),
                predictMs: predictMs.toFixed(2),
              });
              setReadingCount(count);
              if (!isNaN(result)) setPrediction(result);
            },
            `device (${timelineLabel})`,
          );
          return;
        }

        const lines = await loadTimelineLines();
        await startBenchmark(lines, undefined, `device (${timelineLabel})`);
      }
    } catch (e: any) {
      addLog(`Benchmark load error: ${e?.message ?? e}`, 'err');
    }
  }

  function handleReset() {
    NativeSampleModule.reset();
    if (useServer) resetServerSession();
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
      const fileName = `predictions_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.csv`;
      const destPath = `${RNFS.DocumentDirectoryPath}/${fileName}`;

      const header = 'datetime,glucose,prediction,fetch_ms,request_ms,predict_ms';
      const rows = predictionsRef.current.map(
        row =>
          `${row.datetime},${row.glucose},${row.prediction},${row.fetchMs ?? ''},${row.requestMs},${row.predictMs}`,
      );
      await RNFS.writeFile(destPath, `${header}\n${rows.join('\n')}\n`, 'utf8');
      addLog(`Saved predictions CSV: ${destPath}`, 'ok');
    } catch (e: any) {
      addLog(`Save failed: ${e?.message ?? e}`, 'err');
    }
  }

  return {
    // state
    modelLoaded,
    loading,
    csvLine,
    setCsvLine,
    prediction,
    readingCount,
    log,
    selectedPatientId,
    setSelectedPatientId,
    valPickerOpen,
    setValPickerOpen,
    useServer,
    setUseServer,
    useTimelineApi,
    setUseTimelineApi,
    selectedValFileName,
    // refs
    scrollRef,
    // handlers
    handleRunTimeline,
    handleAddReading,
    handleReset,
    handleSavePredictionsCsv,
    handleStartBenchmark,
    finish,
    // benchmark state
    benchmarkRunning,
    benchmarkReadingsDone,
    benchmarkTotalReadings,
    benchmarkElapsedS,
  };
}
