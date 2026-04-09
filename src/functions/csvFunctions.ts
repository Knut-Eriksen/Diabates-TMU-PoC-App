import { Image, Platform } from 'react-native';
import RNFS from 'react-native-fs';

export async function loadValCsvLines(
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

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[idx];
}

export function formatPerfSummary(label: string, latenciesMs: number[]): string {
  if (latenciesMs.length === 0) {
    return `${label}: no requests`;
  }

  const totalMs = latenciesMs.reduce((sum, x) => sum + x, 0);
  const avgMs = totalMs / latenciesMs.length;
  const p50 = percentile(latenciesMs, 50);
  const p95 = percentile(latenciesMs, 95);
  const p99 = percentile(latenciesMs, 99);
  const rps = totalMs > 0 ? (latenciesMs.length * 1000) / totalMs : 0;

  return `${label}:\navg=${avgMs.toFixed(2)}ms\np50=${p50.toFixed(2)}ms\np95=${p95.toFixed(2)}ms\np99=${p99.toFixed(2)}ms\ntotal_request_time=${totalMs.toFixed(2)}ms\nrps=${rps.toFixed(2)}`;
}
