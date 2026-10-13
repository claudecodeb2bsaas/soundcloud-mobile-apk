import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { LibraryMode } from '../core/libraryMix';
import { theme } from '../theme';
import { Icon } from '../ui/Icon';
import { toast } from '../ui/feedback';
import { Button, Chip } from '../ui/kit';
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
      toast(e instanceof Error && e.message ? e.message : 'Не удалось собрать музыку', 'music');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.root}>
      <Text style={styles.heading}>Моя музыка</Text>
      <View style={styles.row}>
        {MODES.map((mode) => <Chip key={mode.id} label={mode.label} on={view.mode === mode.id} onPress={() => library.setMode(mode.id)} />)}
      </View>
      <Text style={styles.muted}>{MODES.find((mode) => mode.id === view.mode)?.hint}</Text>

      <Loadable ready={!!data} error={error} onRetry={reload}>
        <View style={styles.sources}>
          {data?.map((source) => {
            const on = view.pick.includes(source.key);
            return (
              <Pressable key={source.key} onPress={() => library.toggleSource(source.key)} style={styles.source} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
                <View style={[styles.check, on && styles.checkOn]}>{on ? <Icon name="check" size={16} color="#fff" /> : null}</View>
                <Text style={styles.sourceName} numberOfLines={1}>{source.key === 'likes' ? 'Лайки' : source.title}</Text>
                {source.key !== 'likes' ? <Text style={styles.count}>{source.count}</Text> : null}
              </Pressable>
            );
          })}
        </View>
      </Loadable>

      <Button label="Слушать мою музыку" icon="play" onPress={() => void play()} busy={busy} disabled={!view.pick.length} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 12, marginTop: 28 },
  heading: { color: theme.text, fontSize: 20, fontWeight: '800' },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  muted: { color: theme.muted, fontSize: 13, lineHeight: 18 },
  sources: { backgroundColor: theme.surface, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6 },
  source: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12 },
  check: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: '#ffffff40', alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  sourceName: { color: theme.text, fontSize: 15, flex: 1 },
  count: { color: theme.muted, fontSize: 13 },
});
