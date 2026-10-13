import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '../theme';
import { ScreenHeader } from '../ui/kit';
import { marks, useMarks } from '../wave/instance';

function List({ title, empty, kind, items }: { title: string; empty: string; kind: 'track' | 'artist'; items: Record<number, string> }) {
  const entries = Object.entries(items);
  return (
    <View>
      <Text style={styles.heading}>{title}</Text>
      {entries.length ? entries.map(([id, label]) => (
        <View key={id} style={styles.row}>
          <Text style={styles.name} numberOfLines={2}>{label || id}</Text>
          <Pressable onPress={() => marks.remove(kind, Number(id))} hitSlop={8}>
            <Text style={styles.drop}>Вернуть</Text>
          </Pressable>
        </View>
      )) : <Text style={styles.muted}>{empty}</Text>}
    </View>
  );
}

/** Список отметок: что человек запретил волне («Не нравится», «Скрыть артиста»), с возвратом */
export default function MarksScreen() {
  const data = useMarks();
  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScreenHeader title="Отметки" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.muted}>Эти треки и артисты не попадают в волну, радар и подборки.</Text>
        <List title="Не нравится" empty="Пока пусто" kind="track" items={data.tracks} />
        <List title="Скрытые артисты" empty="Пока пусто" kind="artist" items={data.artists} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  content: { paddingHorizontal: 16, paddingBottom: 32, gap: 6 },
  heading: { color: theme.text, fontSize: 20, fontWeight: '800', paddingTop: 18, paddingBottom: 4 },
  muted: { color: theme.muted, fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14, marginTop: 6, borderRadius: 16, backgroundColor: theme.surface },
  name: { flex: 1, color: theme.text, fontSize: 15 },
  drop: { color: theme.accent, fontSize: 14, fontWeight: '700' },
});
