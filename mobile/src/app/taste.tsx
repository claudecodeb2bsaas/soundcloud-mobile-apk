import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { auth } from '../auth/instance';
import { Loadable, RequireAuth } from '../components/Loadable';
import { theme } from '../theme';
import { ScreenHeader } from '../ui/kit';
import { useLoad } from '../ui/useLoad';
import { taste } from '../wave/instance';

const cap = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** «Мой вкус»: кого и что волна ставит чаще, с кнопкой «Убрать из вкуса» (как страница истории desktop) */
function Taste() {
  const user = auth.getState().session?.user.id ?? 0;
  const { data, error, reload } = useLoad(() => taste.view(user), [user]);
  const change = (kind: 'artist' | 'tag', key: number | string, removed: boolean) => {
    if (taste.setRemoved(user, kind, key, removed)) reload();
  };
  const removed = data ? [
    ...data.removed.artists.map((entry) => ({ kind: 'artist' as const, key: entry.id, name: entry.name })),
    ...data.removed.tags.map((entry) => ({ kind: 'tag' as const, key: entry.key, name: cap(entry.label) })),
  ] : [];

  return (
    <Loadable ready={!!data} error={error} onRetry={reload}>
      <ScrollView contentContainerStyle={styles.content}>
        {removed.length ? (
          <View style={styles.removed}>
            <Text style={styles.muted}>Убрано из вкуса, нажми, чтобы вернуть:</Text>
            <View style={styles.chips}>
              {removed.map((entry) => (
                <Pressable key={entry.kind + entry.key} style={styles.chip} onPress={() => change(entry.kind, entry.key, false)}>
                  <Text style={styles.chipText}>{entry.name} ↺</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}
        <Text style={styles.heading}>Артисты, которых волна ставит чаще</Text>
        {data?.artists.length ? data.artists.map((entry, i) => (
          <View key={entry.id} style={styles.row}>
            <Text style={styles.rank}>{i + 1}</Text>
            <Text style={styles.name} numberOfLines={1}>{entry.name}</Text>
            <Pressable onPress={() => change('artist', entry.id, true)} hitSlop={8}>
              <Text style={styles.drop}>Убрать из вкуса</Text>
            </Pressable>
          </View>
        )) : <Text style={[styles.muted, styles.pad]}>Волне пока не на что опереться</Text>}
        <Text style={styles.heading}>Теги, на которые опирается волна</Text>
        {data?.tags.length ? data.tags.map((entry, i) => (
          <View key={entry.key} style={styles.row}>
            <Text style={styles.rank}>{i + 1}</Text>
            <Text style={styles.name} numberOfLines={1}>{cap(entry.label)}</Text>
            <Pressable onPress={() => change('tag', entry.key, true)} hitSlop={8}>
              <Text style={styles.drop}>Убрать из вкуса</Text>
            </Pressable>
          </View>
        )) : <Text style={[styles.muted, styles.pad]}>Пока ничего</Text>}
      </ScrollView>
    </Loadable>
  );
}

export default function TasteScreen() {
  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScreenHeader title="Мой вкус" />
      <RequireAuth>
        <Taste />
      </RequireAuth>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  content: { paddingBottom: 24 },
  heading: { color: theme.text, fontSize: 20, fontWeight: '800', paddingHorizontal: 16, paddingTop: 22, paddingBottom: 6 },
  muted: { color: theme.muted, fontSize: 13 },
  pad: { paddingHorizontal: 16, paddingVertical: 8 },
  removed: { paddingHorizontal: 16, paddingTop: 4, gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { backgroundColor: theme.surface, borderRadius: 18, paddingVertical: 8, paddingHorizontal: 14 },
  chipText: { color: theme.text, fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, marginTop: 6, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 16, backgroundColor: theme.surface },
  rank: { color: theme.muted, width: 24, fontSize: 13 },
  name: { flex: 1, color: theme.text, fontSize: 15 },
  drop: { color: theme.accent, fontSize: 13, fontWeight: '700' },
});
