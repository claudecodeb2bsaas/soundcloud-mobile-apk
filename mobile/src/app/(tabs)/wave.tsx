import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RequireAuth } from '../../components/Loadable';
import { theme } from '../../theme';
import { wave, useWave } from '../../wave/instance';

const MODES = [
  { id: 'similar', label: 'Похожее', hint: 'Музыка, похожая на твою историю и лайки' },
  { id: 'fresh', label: 'Новое', hint: 'Ещё не слышанное и не лайкнутое, больше новых артистов' },
] as const;

const MESSAGES = {
  empty: 'Подобрать нечего: послушай или лайкни что-нибудь, либо смени жанр',
  error: 'Не удалось подобрать треки. Проверь соединение и попробуй ещё раз.',
} as const;

function WaveScreen() {
  const state = useWave();
  const [genre, setGenre] = useState(state.genre);
  const running = state.status === 'running';
  const loading = state.status === 'loading';
  const hint = MODES.find((mode) => mode.id === state.mode)?.hint;

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.label}>Режим</Text>
      <View style={styles.row}>
        {MODES.map((mode) => (
          <Pressable key={mode.id} onPress={() => wave.configure({ mode: mode.id })} style={[styles.chip, state.mode === mode.id && styles.chipOn]}>
            <Text style={[styles.chipText, state.mode === mode.id && styles.chipTextOn]}>{mode.label}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.muted}>{hint}</Text>

      <Text style={styles.label}>Жанр</Text>
      <TextInput
        style={styles.input}
        value={genre}
        onChangeText={setGenre}
        onSubmitEditing={() => wave.configure({ genre: genre.trim() })}
        placeholder="Любой. Например: techno, фонк"
        placeholderTextColor={theme.muted}
        returnKeyType="done"
        autoCorrect={false}
      />
      <Text style={styles.muted}>Несколько жанров через запятую. Применяется по кнопке на клавиатуре, идущая волна начнётся заново.</Text>

      <Pressable style={[styles.main, running && styles.mainOff]} onPress={() => (running ? wave.stop() : void wave.start())} disabled={loading}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.mainText}>{running ? 'Остановить волну' : 'Включить волну'}</Text>}
      </Pressable>

      {running ? (
        <Text style={styles.status}>
          {state.seedLabel ? `Волна от «${state.seedLabel}»` : 'Волна играет'}. Причина каждого трека видна в плеере.
        </Text>
      ) : null}
      {state.status === 'empty' || state.status === 'error' ? <Text style={styles.warn}>{MESSAGES[state.status]}</Text> : null}
    </ScrollView>
  );
}

export default function WaveTab() {
  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <Text style={styles.title}>Моя волна</Text>
      <RequireAuth>
        <WaveScreen />
      </RequireAuth>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  title: { color: theme.text, fontSize: 22, fontWeight: '700', paddingHorizontal: 16, paddingVertical: 12 },
  content: { padding: 16, gap: 10 },
  label: { color: theme.text, fontSize: 15, fontWeight: '600', marginTop: 8 },
  row: { flexDirection: 'row', gap: 8 },
  chip: { paddingVertical: 8, paddingHorizontal: 18, borderRadius: 18, backgroundColor: theme.surface },
  chipOn: { backgroundColor: theme.accent },
  chipText: { color: theme.muted, fontSize: 15 },
  chipTextOn: { color: '#fff', fontWeight: '600' },
  input: { backgroundColor: theme.surface, color: theme.text, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10, fontSize: 16 },
  muted: { color: theme.muted, fontSize: 13 },
  main: { backgroundColor: theme.accent, borderRadius: 28, paddingVertical: 16, alignItems: 'center', marginTop: 24 },
  mainOff: { backgroundColor: theme.surface },
  mainText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  status: { color: theme.text, fontSize: 14, textAlign: 'center' },
  warn: { color: '#ffb454', fontSize: 14, textAlign: 'center' },
});
