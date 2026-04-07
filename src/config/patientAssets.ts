export const ONE_PATIENT_VAL_ASSET = require('../../one_patient_val.csv');

export const PATIENT_VAL_ASSETS: Record<number, any> = {
  1: require('../../patient_val/patient_1_val.csv'),
  2: require('../../patient_val/patient_2_val.csv'),
  3: require('../../patient_val/patient_3_val.csv'),
  4: require('../../patient_val/patient_4_val.csv'),
  5: require('../../patient_val/patient_5_val.csv'),
  6: require('../../patient_val/patient_6_val.csv'),
  7: require('../../patient_val/patient_7_val.csv'),
  8: require('../../patient_val/patient_8_val.csv'),
  9: require('../../patient_val/patient_9_val.csv'),
  10: require('../../patient_val/patient_10_val.csv'),
  11: require('../../patient_val/patient_11_val.csv'),
  12: require('../../patient_val/patient_12_val.csv'),
  13: require('../../patient_val/patient_1_val_24h.csv'),
};

export const PATIENT_VAL_FILE_NAMES: Record<number, string> = {
  1: 'patient_1_val.csv',
  2: 'patient_2_val.csv',
  3: 'patient_3_val.csv',
  4: 'patient_4_val.csv',
  5: 'patient_5_val.csv',
  6: 'patient_6_val.csv',
  7: 'patient_7_val.csv',
  8: 'patient_8_val.csv',
  9: 'patient_9_val.csv',
  10: 'patient_10_val.csv',
  11: 'patient_11_val.csv',
  12: 'patient_12_val.csv',
  13: 'patient_1_val_24h.csv',
};

export const DEFAULT_CSV_LINE =
  '2021-11-07 00:00:00,136.0,0.0,0.0,0.0,93.0,0.01556,0.0,0.0,0.0,0.0';

export const SERVER_BASE_URL = 'https://seniors-conceptual-high-whale.trycloudflare.com';
