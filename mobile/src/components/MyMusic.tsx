import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import type { LibraryMode } from '../core/libraryMix';
import { theme } from '../theme';
import { useLoad } from '../ui/useLoad';
import { library, useLibrary, wave } from '../wave/instance';
import { Loadable } from './Loadable';

const MODES: Array<{ id: LibraryMode; label: string; hint: string }> = [
  { id: 'order', label: 'По порядку', hint: 'Как собрано: источники по порядку выбора, внутри порядок сайта' },
  { id: 'shuffle', label: 'Перемешать', hint: 'Случайно, без одного артиста подряд; слышанное за 3 дня в конце' },
  { id: 'smart', label: 'Умное', hint: 'Своё вперемешку с похожим: три своих, один новый' },
];

/** «Моя музыка»: свои лайки и плейлисты целиком, три режима порядка */
export function MyMusic() {
  const view = useLibrary();
  const [busy, setBusy] = useState(false);
  const { data, error, reload } = useLoad(() => library.sources(), []);

  async function play() {
    setBusy(true);
    try {
      await wave.start(await library.seed({ likes: 'Лайки' }));
    } catch (e) {
      Alert.alert('Не удалось собрать музыку', e instanceof Error ? e.message : '');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.root}>
      <Text style={styles.heading}>Моя музыка</Text>
      <View style={styles.row}>
        {MODES.map((mode) => (
          <Pressable key={mode.id} onPress={() => library.setMode(mode.id)} style={[styles.chip, view.mode === mode.id && styles.chipOn]}>
            <Text style={[styles.chipText, view.mode === mode.id && styles.chipTextOn]}>{mode.label}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.muted}>{MODES.find((mode) => mode.id === view.mode)?.hint}</Text>

      <Loadable ready={!!data} error={error} onRetry={reload}>
        <View style={styles.sources}>
          {data?.map((source) => {
            const on = view.pick.includes(source.key);
            return (
              <Pressable key={source.key} onPress={() => library.toggleSource(source.key)} style={styles.source}>
                <Text style={[styles.check, on && styles.checkOn]}>{on ? '☑' : '☐'}</Text>
                <Text style={styles.sourceName} numberOfLines={1}>{source.key === 'likes' ? 'Лайки' : source.title}</Text>
                {source.key !== 'likes' ? <Text style={styles.muted}>{source.count}</Text> : null}
              </Pressable>
            );
          })}
        </View>
      </Loadable>

      <Pressable style={[styles.main, !view.pick.length && styles.off]} onPress={() => void play()} disabled={busy || !view.pick.length}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.mainText}>Слушать мою музыку</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 10, marginTop: 28 },
  heading: { color: theme.text, fontSize: 18, fontWeight: '700' },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 18, backgroundColor: theme.surface },
  chipOn: { backgroundColor: theme.accent },
  chipText: { color: theme.muted, fontSize: 14 },
  chipTextOn: { color: '#fff', fontWeight: '600' },
  muted: { color: theme.muted, fontSize: 13 },
  sources: { gap: 2 },
  source: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  check: { color: theme.muted, fontSize: 20 },
  checkOn: { color: theme.accent },
  sourceName: { color: theme.text, fontSize: 15, flex: 1 },
  main: { backgroundColor: theme.accent, borderRadius: 28, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  off: { opacity: 0.4 },
  mainText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
