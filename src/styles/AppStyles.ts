import { StyleSheet } from 'react-native';
import { LogEntry } from '../types/types';

export function logLineStyle(kind: LogEntry['kind']) {
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

export const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f5f5f5' },
  container: { flex: 1, padding: 20 },

  title: { fontSize: 22, fontWeight: '700', marginBottom: 12, color: '#111' },
  tabRow: {
    flexDirection: 'row',
    backgroundColor: '#e8eaf6',
    borderRadius: 10,
    padding: 4,
    marginBottom: 14,
    gap: 6,
  },
  tabBtn: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
  },
  tabBtnActive: { backgroundColor: '#1a237e' },
  tabBtnText: { color: '#1a237e', fontWeight: '600' },
  tabBtnTextActive: { color: '#fff' },

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
  predHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  predLabel: { fontSize: 13, color: '#888' },
  unitToggle: {
    flexDirection: 'row',
    backgroundColor: '#f0f0f0',
    borderRadius: 8,
    padding: 2,
  },
  unitBtn: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  unitBtnActive: {
    backgroundColor: '#1a237e',
  },
  unitBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#888',
  },
  unitBtnTextActive: {
    color: '#fff',
  },
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

  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 14,
  },
  toggleTextWrap: { flex: 1, paddingRight: 12 },
  toggleLabel: { fontSize: 14, fontWeight: '600', color: '#111' },
  toggleSubLabel: { fontSize: 12, color: '#666', marginTop: 2 },

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
    marginBottom: 12,
  },
  logLine: {
    fontSize: 12,
    fontFamily: 'Menlo',
    marginBottom: 4,
    lineHeight: 18,
  },
  logEmpty: { fontSize: 12, color: '#bbb', fontStyle: 'italic' },
  logPreview: {
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: '#fff',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#ddd',
    minHeight: 52,
  },
});
