import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';

// ── Types ──────────────────────────────────────────────────────────────────────

interface GlucosePoint {
  Timestamp: string;
  ValueInMgPerDl: number;
  Value: number;          // already in mmol/L from the API
  TrendArrow?: number;
  MeasurementColor: number;
  isHigh: boolean;
  isLow: boolean;
  insulin?: number;
  carbs?: number;
}

interface ConnectionData {
  firstName: string;
  lastName: string;
  targetLow: number;
  targetHigh: number;
  glucoseMeasurement: GlucosePoint;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function parseTs(raw: string): number {
  const m = raw.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)?/i,
  );
  if (m) {
    let h = parseInt(m[4], 10);
    const ampm = (m[7] ?? '').toUpperCase();
    if (ampm === 'AM' && h === 12) h = 0;
    if (ampm === 'PM' && h !== 12) h += 12;
    return new Date(+m[3], +m[1] - 1, +m[2], h, +m[5], +m[6]).getTime();
  }
  return new Date(raw).getTime();
}

function toMmol(mgdl: number): string {
  return (mgdl / 18.018).toFixed(1);
}

function trendFromPrediction(latestMmol: number, predictionMgdl: number | null): string {
  if (predictionMgdl == null) return '—';
  const predMmol = predictionMgdl / 18.018;
  const diff = predMmol - latestMmol;
  if (diff > 1.5) return '↑↑';
  if (diff > 0.5) return '↑';
  if (diff < -1.5) return '↓↓';
  if (diff < -0.5) return '↓';
  return '→';
}

// ── Chart ──────────────────────────────────────────────────────────────────────

const PAD = { t: 12, b: 28, l: 36, r: 10 };

interface ChartProps {
  data: GlucosePoint[];
  targetLow: number;
  targetHigh: number;
  predictionMgdl: number | null;
}

const GlucoseChart: React.FC<ChartProps> = ({ data, targetLow, targetHigh, predictionMgdl }) => {
  const [w, setW] = useState(300);
  const [h, setH] = useState(200);

  const iW = w - PAD.l - PAD.r;
  const iH = h - PAD.t - PAD.b;

  const pts = data
    .map(d => ({ ...d, ts: parseTs(d.Timestamp) }))
    .filter(d => !isNaN(d.ts))
    .sort((a, b) => a.ts - b.ts);

  if (pts.length < 2) return null;

  const tMin = pts[0].ts;
  const tMax = pts[pts.length - 1].ts;
  const tRange = tMax - tMin || 1;

  // Use Value (mmol/L) directly; convert mg/dL targets
  const tLowMmol = targetLow / 18.018;
  const tHighMmol = targetHigh / 18.018;

  const values = pts.map(d => d.Value);
  const yMin = Math.max(0, Math.min(...values, tLowMmol) - 1);
  const yMax = Math.max(...values, tHighMmol) + 1;
  const yRange = yMax - yMin;

  const toX = (ts: number) => PAD.l + ((ts - tMin) / tRange) * iW;
  const toY = (v: number) => PAD.t + iH - ((v - yMin) / yRange) * iH;

  const tHighY = toY(tHighMmol);
  const tLowY = toY(tLowMmol);
  const nowX = toX(tMax);

  // Time labels every 2 h
  const timeLabels: { x: number; label: string }[] = [];
  const step = 2 * 3600000;
  for (let t = Math.ceil(tMin / step) * step; t <= tMax; t += step) {
    const d = new Date(t);
    timeLabels.push({
      x: toX(t),
      label: `${String(d.getHours()).padStart(2, '0')}:00`,
    });
  }

  // Y grid every 2 mmol/L
  const yGrid: number[] = [];
  for (let v = Math.floor(yMin); v <= Math.ceil(yMax); v++) {
    if (v % 2 === 0) yGrid.push(v);
  }

  return (
    <View
      style={{ flex: 1 }}
      onLayout={e => { setW(e.nativeEvent.layout.width); setH(e.nativeEvent.layout.height); }}
    >
      {/* Y grid */}
      {yGrid.map(v => {
        const y = toY(v);
        if (y < PAD.t || y > PAD.t + iH) return null;
        return (
          <React.Fragment key={v}>
            <View style={[st.gridLine, { top: y, left: PAD.l, width: iW }]} />
            <Text style={[st.yLabel, { top: y - 7 }]}>{v}</Text>
          </React.Fragment>
        );
      })}

      {/* Target band */}
      <View style={{ position: 'absolute', left: PAD.l, top: tHighY, width: iW, height: Math.max(0, tLowY - tHighY), backgroundColor: 'rgba(66,133,244,0.12)' }} />
      <View style={{ position: 'absolute', left: PAD.l, top: tHighY, width: iW, height: 1, backgroundColor: 'rgba(66,133,244,0.4)' }} />
      <View style={{ position: 'absolute', left: PAD.l, top: tLowY, width: iW, height: 1, backgroundColor: 'rgba(66,133,244,0.4)' }} />

      {/* Line */}
      {pts.map((pt, i) => {
        if (i === 0) return null;
        const prev = pts[i - 1];
        const x1 = toX(prev.ts); const y1 = toY(prev.Value);
        const x2 = toX(pt.ts);   const y2 = toY(pt.Value);
        const dx = x2 - x1; const dy = y2 - y1;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 0.5) return null;
        const outside = prev.isHigh || pt.isHigh || prev.isLow || pt.isLow;
        return (
          <View key={i} style={{
            position: 'absolute',
            left: (x1 + x2) / 2 - len / 2,
            top: (y1 + y2) / 2 - 1.5,
            width: len, height: 3,
            backgroundColor: outside ? '#e53935' : '#222',
            transform: [{ rotate: `${Math.atan2(dy, dx) * 180 / Math.PI}deg` }],
          }} />
        );
      })}

      {/* Prediction marker on now-line */}
      {predictionMgdl != null && (() => {
        const pY = toY(predictionMgdl / 18.018);
        return (
          <>
            <View style={{ position: 'absolute', left: PAD.l, top: pY, width: iW, height: 1, backgroundColor: 'rgba(245,124,0,0.3)' }} />
            <View style={{ position: 'absolute', left: nowX - 6, top: pY - 6, width: 12, height: 12, borderRadius: 6, backgroundColor: '#fff', borderWidth: 2.5, borderColor: '#f57c00' }} />
          </>
        );
      })()}

      {/* Now line */}
      <View style={{ position: 'absolute', left: nowX - 1, top: PAD.t, width: 2, height: iH, backgroundColor: '#4285f4', opacity: 0.7 }} />

      {/* X time labels */}
      {timeLabels.map(({ x, label }) => (
        <Text key={label} style={[st.xLabel, { left: x - 16, top: PAD.t + iH + 5 }]}>{label}</Text>
      ))}
    </View>
  );
};

const st = StyleSheet.create({
  gridLine: { position: 'absolute', height: 1, backgroundColor: 'rgba(0,0,0,0.06)' },
  yLabel: { position: 'absolute', left: 0, width: PAD.l - 4, textAlign: 'right', fontSize: 10, color: '#bbb' },
  xLabel: { position: 'absolute', width: 32, textAlign: 'center', fontSize: 9, color: '#bbb' },
});

// ── DashboardTab ───────────────────────────────────────────────────────────────

interface Props {
  graphData: GlucosePoint[];
  connection: ConnectionData | null;
  loading: boolean;
  error: string | null;
  prediction: number | null;
  modelLoaded: boolean;
  onRefresh: () => void;
}

const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export const DashboardTab: React.FC<Props> = ({
  graphData, connection, loading, error, prediction, modelLoaded, onRefresh,
}) => {
  const hasAutoRefreshed = React.useRef(false);
  const onRefreshRef = React.useRef(onRefresh);
  useEffect(() => { onRefreshRef.current = onRefresh; });

  useEffect(() => {
    if (modelLoaded && !hasAutoRefreshed.current) {
      hasAutoRefreshed.current = true;
      onRefresh();
    }
  }, [modelLoaded]);

  useEffect(() => {
    if (!modelLoaded) return;
    const id = setInterval(() => { onRefreshRef.current(); }, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [modelLoaded]);

  const latest = connection?.glucoseMeasurement;
  const targetLow = connection?.targetLow ?? 70;
  const targetHigh = connection?.targetHigh ?? 153;
  const isHigh = latest?.isHigh ?? false;
  const isLow = latest?.isLow ?? false;
  const valueColor = isHigh ? '#ff9800' : isLow ? '#e53935' : '#4caf50';

  return (
    <View style={d.root}>

      {/* ── Patient + timestamp ── */}
      <View style={d.header}>
        {connection && <Text style={d.name}>{connection.firstName} {connection.lastName}</Text>}
        <Text style={d.time}>{latest?.Timestamp ?? '—'}</Text>
      </View>

      {/* ── Error ── */}
      {error && <Text style={d.error}>⚠ {error}</Text>}

      {/* ── Model not ready ── */}
      {!modelLoaded && !error && (
        <Text style={d.error}>Loading model…</Text>
      )}

      {/* ── Chart (fixed shorter height) ── */}
      <View style={d.chartWrap}>
        {loading && !graphData.length && (
          <ActivityIndicator color="#1a237e" style={{ marginTop: 40 }} />
        )}
        {graphData.length > 1 && (
          <GlucoseChart
            data={graphData}
            targetLow={targetLow}
            targetHigh={targetHigh}
            predictionMgdl={prediction}
          />
        )}
      </View>

      {/* ── Latest reading ── */}
      <View style={d.readingBlock}>
        <Text style={d.readingLabel}>Latest reading</Text>
        <View style={d.readingRow}>
          <Text style={[d.readingValue, { color: valueColor }]}>
            {latest ? latest.Value.toFixed(1) : '—'}
          </Text>
          {latest && (
              <Text style={[d.trend, { color: valueColor }]}>
                {trendFromPrediction(latest.Value, prediction)}
              </Text>
          )}
          <Text style={d.unit}>mmol/L</Text>
        </View>
      </View>

      {/* ── Prediction ── */}
      <View style={d.predBlock}>
        <Text style={d.readingLabel}>Prediction</Text>
        <View style={d.readingRow}>
          <Text style={d.predValue}>
            {prediction != null ? toMmol(prediction) : '—'}
          </Text>
          <Text style={d.unit}>mmol/L</Text>
        </View>
      </View>

      {/* ── Refresh ── */}
      <TouchableOpacity
        style={[d.btn, loading && d.btnDisabled]}
        onPress={onRefresh}
        disabled={loading}
        activeOpacity={0.8}
      >
        {loading
          ? <ActivityIndicator color="#fff" size="small" />
          : <Text style={d.btnTxt}>↻  Refresh</Text>}
      </TouchableOpacity>
    </View>
  );
};

// ── Styles ─────────────────────────────────────────────────────────────────────

const d = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#fff',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 20,
  },

  header: { marginBottom: 10 },
  name: { fontSize: 13, fontWeight: '600', color: '#555' },
  time: { fontSize: 11, color: '#bbb', marginTop: 1 },

  error: { color: '#c62828', fontSize: 12, marginBottom: 8 },

  // Fixed shorter height — not flex
  chartWrap: {
    height: 180,
    borderRadius: 10,
    backgroundColor: '#fafafa',
    overflow: 'hidden',
    marginBottom: 20,
  },

  readingBlock: { marginBottom: 16 },
  predBlock: {
    marginBottom: 20,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },

  readingLabel: { fontSize: 12, color: '#aaa', marginBottom: 2 },
  readingRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  readingValue: { fontSize: 56, fontWeight: '800', lineHeight: 60, letterSpacing: -2 },
  predValue: { fontSize: 42, fontWeight: '700', color: '#f57c00', lineHeight: 46 },
  trend: { fontSize: 28, fontWeight: '700', paddingBottom: 6 },
  unit: { fontSize: 14, color: '#aaa', paddingBottom: 8 },

  btn: {
    backgroundColor: '#1a237e',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  btnDisabled: { backgroundColor: '#9fa8da' },
  btnTxt: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
