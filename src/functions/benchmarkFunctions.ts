import { useRef, useState } from 'react';
import RNFS from 'react-native-fs';
import DeviceInfo from 'react-native-device-info';
import NativeSampleModule from '../../specs/NativeSampleModule';
import { LogEntry } from '../types/types';

const BENCHMARK_DURATION_H = 8;
const READING_INTERVAL_MIN = 5;
const TOTAL_READINGS = (BENCHMARK_DURATION_H * 60) / READING_INTERVAL_MIN; // 96 readings
type BenchmarkReadingRunner = (line: string, count: number) => Promise<void>;

export function useBenchmark(
  addLog: (text: string, kind: LogEntry['kind']) => void,
) {
  const [benchmarkRunning, setBenchmarkRunning] = useState(false);
  const [readingsDone, setReadingsDone] = useState(0);
  const [elapsedS, setElapsedS] = useState(0);

  const readingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const perfIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const csvLinesRef = useRef<string[]>([]);
  const lineIndexRef = useRef(0);
  const readingCountRef = useRef(0);
  const startTimeRef = useRef(0);
  const perfFilePathRef = useRef('');
  const readingInProgressRef = useRef(false);

  // Stop both timers
  function stopIntervals() {
    if (readingIntervalRef.current) {
      clearInterval(readingIntervalRef.current);
      readingIntervalRef.current = null;
    }
    if (perfIntervalRef.current) {
      clearInterval(perfIntervalRef.current);
      perfIntervalRef.current = null;
    }
  }

  function queueReading(runBenchmarkReading?: BenchmarkReadingRunner) {
    fireReading(runBenchmarkReading).catch((e: unknown) => {
      const message = e instanceof Error ? e.message : String(e);
      addLog(`Benchmark step failed: ${message}`, 'err');
    });
  }

  async function startBenchmark(
    csvLines: string[],
    runBenchmarkReading?: BenchmarkReadingRunner,
    modeLabel = 'device',
  ) {
    if (benchmarkRunning || csvLines.length === 0) return;

    // Reset everything
    NativeSampleModule.reset();
    csvLinesRef.current = csvLines;
    lineIndexRef.current = 0;
    readingCountRef.current = 0;
    startTimeRef.current = Date.now();
    readingInProgressRef.current = false;
    setBenchmarkRunning(true);
    setReadingsDone(0);
    setElapsedS(0);

    // Create the CSV file with header
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    perfFilePathRef.current = `${RNFS.DocumentDirectoryPath}/benchmark_perf_${ts}.csv`;
    await RNFS.writeFile(
      perfFilePathRef.current,
      'timestamp,cpu_pct,battery_pct,memory_mb\n',
      'utf8',
    );

    addLog(
      `── Benchmark started on ${modeLabel}: ${TOTAL_READINGS} readings at ${READING_INTERVAL_MIN}-min intervals (${BENCHMARK_DURATION_H}h). Keep the screen on. ──`,
      'info',
    );

    // 1 second performance sampler, gets CPU, battery and memory every second and adds to csv
    perfIntervalRef.current = setInterval(async () => {
      const cpu = NativeSampleModule.getCpuUsage();
      const battery = await DeviceInfo.getBatteryLevel() * 100;
      const memory = (await DeviceInfo.getUsedMemory()) / (1024 * 1024);
      const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
      const row = `${timestamp},${cpu.toFixed(2)},${battery.toFixed(1)},${memory.toFixed(2)}\n`;
      await RNFS.appendFile(perfFilePathRef.current, row, 'utf8');
      setElapsedS(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);

    // Fire first reading immediately, then every 5 minutes
    queueReading(runBenchmarkReading);
    readingIntervalRef.current = setInterval(
      () => queueReading(runBenchmarkReading),
      READING_INTERVAL_MIN * 60 * 1000,
    );
  }

  async function fireReading(runBenchmarkReading?: BenchmarkReadingRunner) {
    if (readingInProgressRef.current) return;
    readingInProgressRef.current = true;
    try {

      //Gets the next line
      const count = readingCountRef.current + 1;
      const lines = csvLinesRef.current;
      const line = lines[lineIndexRef.current % lines.length];
      lineIndexRef.current++;

      // Adds the reading and predicits
      if (runBenchmarkReading) {
        await runBenchmarkReading(line, count);
      } else {
        NativeSampleModule.addReading(line);
        NativeSampleModule.predict();
      }

      readingCountRef.current = count;
      setReadingsDone(count);
      addLog(`[${count}/${TOTAL_READINGS}]`, 'info');

      if (count >= TOTAL_READINGS) {
        finish();
      }
    } finally {
      readingInProgressRef.current = false;
    }
  }

  function finish() {
    stopIntervals();
    setBenchmarkRunning(false);
    addLog(`── Benchmark complete. Perf CSV saved to: ${perfFilePathRef.current} ──`, 'ok');
  }

  return {
    benchmarkRunning,
    readingsDone,
    totalReadings: TOTAL_READINGS,
    elapsedS,
    startBenchmark,
    finish,
  };
}
