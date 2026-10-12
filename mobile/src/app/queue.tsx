import { router } from 'expo-router';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { player, usePlayerState } from '../player/instance';
import { theme } from '../theme';

export default function Queue() {
  const state = usePlayerState();
  const { items, index } = state.queue;

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.bar}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.link}>Назад</Text>
        </Pressable>
        <Text style={styles.title}>Очередь · {items.length}</Text>
        <Pressable onPress={() => { player.clear(); router.back(); }} hitSlop={12}>
          <Text style={styles.link}>Очистить</Text>
        </Pressable>
      </View>
      <FlatList
        data={items}
        keyExtractor={(item) => item.key}
        ListEmptyComponent={<Text style={styles.empty}>Очередь пуста</Text>}
        renderItem={({ item, index: at }) => {
          const current = at === index;
          const ahead = at > index;
          return (
            <View style={styles.row}>
              <Text style={[styles.number, current && styles.accent]}>{at + 1}</Text>
              <Pressable style={styles.meta} onPress={() => player.jumpTo(at)}>
                <Text style={[styles.track, current && styles.accent]} numberOfLines={1}>
                  {item.track.title}
                </Text>
                <Text style={styles.artist} numberOfLines={1}>
                  {item.track.user?.username ?? ''}
                </Text>
              </Pressable>
              {ahead ? (
                <View style={styles.actions}>
                  <Pressable onPress={() => player.move(at, at - 1)} disabled={at === index + 1} hitSlop={6} accessibilityLabel="Выше">
                    <Text style={[styles.action, at === index + 1 && styles.off]}>▲</Text>
                  </Pressable>
                  <Pressable onPress={() => player.move(at, at + 1)} disabled={at === items.length - 1} hitSlop={6} accessibilityLabel="Ниже">
                    <Text style={[styles.action, at === items.length - 1 && styles.off]}>▼</Text>
                  </Pressable>
                  <Pressable onPress={() => player.removeAt(at)} hitSlop={6} accessibilityLabel="Убрать из очереди">
                    <Text style={styles.action}>✕</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  title: { color: theme.text, fontSize: 16, fontWeight: '600' },
  link: { color: theme.accent, fontSize: 15 },
  empty: { color: theme.muted, textAlign: 'center', padding: 24 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8, gap: 10 },
  number: { color: theme.muted, width: 28, textAlign: 'center', fontSize: 12 },
  meta: { flex: 1, gap: 2 },
  track: { color: theme.text, fontSize: 15, fontWeight: '500' },
  artist: { color: theme.muted, fontSize: 12 },
  accent: { color: theme.accent },
  actions: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  action: { color: theme.muted, fontSize: 16, width: 22, textAlign: 'center' },
  off: { opacity: 0.25 },
});
