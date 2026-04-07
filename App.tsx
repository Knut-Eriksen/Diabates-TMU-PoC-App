import React, { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  SafeAreaView,
  ScrollView,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { styles, logLineStyle } from './src/styles/AppStyles';
import { PATIENT_VAL_FILE_NAMES } from './src/config/patientAssets';
import { useAppFunctions } from './src/functions/appFunctions';

export default function App() {
  const [activeTab, setActiveTab] = useState<'controls' | 'log'>('controls');

  const {
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
    scrollRef,
    handleRunTimeline,
    handleAddReading,
    handleReset,
    handleSavePredictionsCsv,
    handleStartBenchmark,
    finish,
    benchmarkRunning,
    benchmarkReadingsDone,
    benchmarkTotalReadings,
    benchmarkElapsedS,
  } = useAppFunctions();

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.title}>Glucose Predictor</Text>

        <View style={styles.tabRow}>
          <TouchableOpacity
            style={[styles.tabBtn, activeTab === 'controls' && styles.tabBtnActive]}
            onPress={() => setActiveTab('controls')}
          >
            <Text
              style={[
                styles.tabBtnText,
                activeTab === 'controls' && styles.tabBtnTextActive,
              ]}
            >
              Controls
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabBtn, activeTab === 'log' && styles.tabBtnActive]}
            onPress={() => setActiveTab('log')}
          >
            <Text style={[styles.tabBtnText, activeTab === 'log' && styles.tabBtnTextActive]}>
              Log
            </Text>
          </TouchableOpacity>
        </View>

        {activeTab === 'controls' ? (
          <>
            {/* Model status pill */}
            <View style={[styles.pill, modelLoaded ? styles.pillOk : styles.pillWarn]}>
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

            {/* Server / device toggle */}
            <View style={styles.toggleRow}>
              <View style={styles.toggleTextWrap}>
                <Text style={styles.toggleLabel}>Run On Server</Text>
                <Text style={styles.toggleSubLabel}>
                  {useServer
                    ? 'Timeline and Add + Predict will use the backend.'
                    : 'Timeline and Add + Predict will use the on-device model.'}
                </Text>
              </View>
              <Switch
                value={useServer}
                onValueChange={setUseServer}
                trackColor={{ false: '#c7c7c7', true: '#9fa8da' }}
                thumbColor={useServer ? '#1a237e' : '#f4f4f4'}
              />
            </View>

            {/* Timeline input source toggle */}
            <View style={styles.toggleRow}>
              <View style={styles.toggleTextWrap}>
                <Text style={styles.toggleLabel}>Timeline Source</Text>
                <Text style={styles.toggleSubLabel}>
                  {useTimelineApi
                    ? 'Run timeline/benchmark using glucose API rows.'
                    : `Run timeline/benchmark using ${selectedValFileName}.`}
                </Text>
              </View>
              <Switch
                value={useTimelineApi}
                onValueChange={setUseTimelineApi}
                trackColor={{ false: '#c7c7c7', true: '#9fa8da' }}
                thumbColor={useTimelineApi ? '#1a237e' : '#f4f4f4'}
              />
            </View>

            {/* Patient val file picker modal */}
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
                  {Array.from({ length: 13 }, (_, i) => i + 1).map(id => {
                    const name = PATIENT_VAL_FILE_NAMES[id] ?? `patient_${id}_val.csv`;
                    const isSelected = id === selectedPatientId;
                    return (
                      <TouchableOpacity
                        key={id}
                        style={[styles.modalItem, isSelected && styles.modalItemSelected]}
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
                style={[styles.btn, styles.btnPrimary, !modelLoaded && styles.btnDisabled]}
                onPress={handleRunTimeline}
                disabled={!modelLoaded}
              >
                <Text style={styles.btnText}>Run {selectedValFileName} Timeline</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.btn, styles.btnSecondary, !modelLoaded && styles.btnDisabled]}
                onPress={handleAddReading}
                disabled={!modelLoaded}
              >
                <Text style={[styles.btnText, { color: '#333' }]}>Add + Predict</Text>
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
                <Text style={[styles.btnText, { color: '#333' }]}>Save Predictions CSV</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.btn, benchmarkRunning ? styles.btnPrimary : styles.btnSecondary]}
                onPress={benchmarkRunning ? finish : handleStartBenchmark}
              >
                <Text style={[styles.btnText, benchmarkRunning ? {} : { color: '#333' }]}>
                  {benchmarkRunning
                    ? `Stop Benchmark (${benchmarkReadingsDone}/${benchmarkTotalReadings} · ${Math.floor(benchmarkElapsedS / 60)}m)`
                    : '8h Benchmark'}
                </Text>
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <>
            <Text style={styles.logLabel}>Log</Text>
            <ScrollView
              ref={scrollRef}
              style={styles.logBox}
              contentContainerStyle={{ paddingBottom: 28 }}
            >
              {log.map((entry, i) => (
                <Text key={i} style={[styles.logLine, logLineStyle(entry.kind)]}>
                  {entry.text}
                </Text>
              ))}
              {log.length === 0 && <Text style={styles.logEmpty}>Nothing yet.</Text>}
            </ScrollView>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}
