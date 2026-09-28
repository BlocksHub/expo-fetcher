import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { HOST, runBenchmark, runSelfTest, type BenchRow, type CaseResult } from './selfTest';

type Phase = 'idle' | 'testing' | 'benchmarking' | 'done';

export default function App() {
  const dark = useColorScheme() === 'dark';
  const colors = dark ? palette.dark : palette.light;
  const [phase, setPhase] = useState<Phase>('idle');
  const [results, setResults] = useState<CaseResult[]>([]);
  const [bench, setBench] = useState<BenchRow[]>([]);

  const run = useCallback(async () => {
    setResults([]);
    setBench([]);
    setPhase('testing');
    await runSelfTest((result) => setResults((list) => [...list, result]));
    setPhase('benchmarking');
    await runBenchmark((row) => setBench((list) => [...list, row]));
    setPhase('done');
  }, []);

  useEffect(() => {
    void run();
  }, [run]);

  const failed = results.filter((r) => !r.ok).length;
  const summary =
    phase === 'testing'
      ? `Running case ${results.length + 1}...`
      : results.length === 0
        ? 'Waiting'
        : `${results.length - failed} passed, ${failed} failed`;

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.title, { color: colors.text }]}>expo-fetcher self-test</Text>
        <Text style={[styles.meta, { color: colors.muted }]}>Server: {HOST}</Text>
        <Text
          accessibilityRole="summary"
          style={[styles.summary, { color: failed > 0 ? colors.fail : colors.text }]}>
          {summary}
        </Text>

        {results.map((result) => (
          <View key={result.name} style={[styles.row, { borderColor: colors.border }]}>
            <Text style={[styles.badge, { color: result.ok ? colors.pass : colors.fail }]}>
              {result.ok ? 'PASS' : 'FAIL'}
            </Text>
            <View style={styles.rowBody}>
              <Text style={[styles.rowTitle, { color: colors.text }]}>{result.name}</Text>
              <Text style={[styles.meta, { color: colors.muted }]}>
                {result.ms} ms{result.detail ? `, ${result.detail}` : ''}
              </Text>
            </View>
          </View>
        ))}

        {bench.length > 0 || phase === 'benchmarking' ? (
          <Text style={[styles.section, { color: colors.text }]}>
            Benchmark, median of 5 runs in ms{phase === 'benchmarking' ? ' (running)' : ''}
          </Text>
        ) : null}
        {bench.map((row) => (
          <View key={row.name} style={[styles.row, { borderColor: colors.border }]}>
            <View style={styles.rowBody}>
              <Text style={[styles.rowTitle, { color: colors.text }]}>{row.name}</Text>
              <Text style={[styles.meta, { color: colors.muted }]}>
                expo-fetcher {fmt(row.expoFetcher)} · RN fetch {fmt(row.globalFetch)} · expo/fetch{' '}
                {fmt(row.expoFetch)}
              </Text>
            </View>
          </View>
        ))}

        <Pressable
          accessibilityRole="button"
          disabled={phase === 'testing' || phase === 'benchmarking'}
          onPress={run}
          style={({ pressed }) => [
            styles.button,
            { backgroundColor: colors.text, opacity: phase === 'done' ? (pressed ? 0.7 : 1) : 0.4 },
          ]}>
          <Text style={[styles.buttonLabel, { color: colors.background }]}>Run tests again</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const fmt = (ms: number) => (ms < 0 ? 'failed' : String(ms));

const palette = {
  light: { background: '#ffffff', text: '#111111', muted: '#555555', border: '#dddddd', pass: '#1b7a2f', fail: '#b3261e' },
  dark: { background: '#111111', text: '#f2f2f2', muted: '#b0b0b0', border: '#333333', pass: '#6fcf7f', fail: '#ff8a80' },
};

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, paddingBottom: 48 },
  title: { fontSize: 22, fontWeight: '700' },
  section: { fontSize: 17, fontWeight: '600', marginTop: 24, marginBottom: 4 },
  summary: { fontSize: 16, fontWeight: '600', marginVertical: 12 },
  meta: { fontSize: 13, marginTop: 2 },
  row: { flexDirection: 'row', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  badge: { width: 48, fontWeight: '700', fontSize: 13, paddingTop: 1 },
  rowBody: { flex: 1 },
  rowTitle: { fontSize: 15 },
  button: { marginTop: 24, minHeight: 44, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  buttonLabel: { fontSize: 16, fontWeight: '600' },
});
