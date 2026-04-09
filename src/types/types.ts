export type LogEntry = { text: string; kind: 'info' | 'ok' | 'warn' | 'err' };

export type PredictionRow = {
  datetime: string;
  glucose: string;
  prediction: string;
  fetchMs?: string;
  requestMs: string;
  predictMs: string;
};

export const LOG_CAP = 100;
