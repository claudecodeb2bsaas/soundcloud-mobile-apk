import { router } from 'expo-router';
import { FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { artwork } from '../player/format';
import { player, usePlayerState } from '../player/instance';
import { theme } from '../theme';
import { Icon } from '../ui/Icon';
import { IconButton, ScreenHeader } from '../ui/kit';

export default function Queue() {
  const state = usePlayerState();
  const { items, index } = state.queue;

  return (
    <SafeAreaView style={styles.root}>
      <ScreenHeader
        title={`Очередь · ${items.length}`}
        right={items.length ? <IconButton icon="trash" size={40} bg={theme.surface} label="Очистить очередь" onPress={() => { player.clear(); router.back(); }} /> : undefined}
      />
      <FlatList
        data={items}
        keyExtractor={(item) => item.key}
        ListEmptyComponent={<Text style={styles.empty}>Очередь пуста</Text>}
        renderItem={({ item, index: at }) => {
          const current = at === index;
          const ahead = at > index;
          const cover = artwork(item.track.artwork_url);
          return (
            <View style={[styles.row, current && styles.current]}>
              <Pressable style={styles.main} onPress={() => player.jumpTo(at)} android_ripple={{ color: '#ffffff10' }}>
                {cover ? <Image source={{ uri: cover }} style={styles.cover} /> : <View style={[styles.cover, styles.noCover]}><Icon name="music" size={20} color={theme.muted} /></View>}
                <View style={styles.meta}>
                  <Text style={[styles.track, current && styles.accent]} numberOfLines={1}>{item.track.title}</Text>
                  <Text style={styles.artist} numberOfLines={1}>{item.track.user?.username ?? ''}</Text>
                </View>
                {current ? <Icon name="wave" size={20} color={theme.accent} /> : null}
              </Pressable>
              {ahead ? (
                <View style={styles.actions}>
                  <IconButton icon="chevronDown" size={34} iconSize={20} color={theme.muted} label="Выше" disabled={at === index + 1} onPress={() => player.move(at, at - 1)} style={styles.flip} />
                  <IconButton icon="chevronDown" size={34} iconSize={20} color={theme.muted} label="Ниже" disabled={at === items.length - 1} onPress={() => player.move(at, at + 1)} />
                  <IconButton icon="close" size={34} iconSize={18} color={theme.muted} label="Убрать из очереди" onPress={() => player.removeAt(at)} />
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
  empty: { color: theme.muted, textAlign: 'center', padding: 32, fontSize: 15 },
  row: { flexDirection: 'row', alignItems: 'center', paddingRight: 8, marginHorizontal: 8, borderRadius: 18 },
  current: { backgroundColor: theme.accentSoft },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, paddingLeft: 8, paddingRight: 4, borderRadius: 18 },
  cover: { width: 48, height: 48, borderRadius: 12, backgroundColor: theme.surface },
  noCover: { alignItems: 'center', justifyContent: 'center' },
  meta: { flex: 1, gap: 2 },
  track: { color: theme.text, fontSize: 15, fontWeight: '600' },
  artist: { color: theme.muted, fontSize: 12 },
  accent: { color: theme.accent },
  actions: { flexDirection: 'row', alignItems: 'center' },
  flip: { transform: [{ rotate: '180deg' }] },
});
