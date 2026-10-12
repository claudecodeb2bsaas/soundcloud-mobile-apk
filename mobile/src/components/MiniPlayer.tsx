import { router, usePathname } from 'expo-router';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { currentItem } from '../player/queue';
import { artwork } from '../player/format';
import { player, usePlayerState } from '../player/instance';
import { theme } from '../theme';
import { ProgressBar } from './ProgressBar';

const HIDDEN_ON = ['/player', '/queue', '/login'];

export function MiniPlayer() {
  const state = usePlayerState();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const item = currentItem(state.queue);
  if (!item || HIDDEN_ON.includes(pathname)) return null;

  const cover = artwork(item.track.artwork_url);
  const busy = state.status === 'loading';

  return (
    <View style={[styles.root, { paddingBottom: insets.bottom }]}>
      <ProgressBar thin />
      <Pressable style={styles.row} onPress={() => router.push('/player')}>
        {cover ? <Image source={{ uri: cover }} style={styles.cover} /> : <View style={styles.cover} />}
        <View style={styles.meta}>
          <Text style={styles.title} numberOfLines={1}>
            {item.track.title}
          </Text>
          <Text style={styles.artist} numberOfLines={1}>
            {state.status === 'error' ? 'Ошибка воспроизведения' : item.track.user?.username ?? ''}
          </Text>
        </View>
        <Pressable style={styles.button} onPress={() => player.toggle()} hitSlop={8}>
          {busy ? <ActivityIndicator color={theme.text} /> : <Text style={styles.glyph}>{state.status === 'playing' ? '❚❚' : '▶'}</Text>}
        </Pressable>
        <Pressable style={styles.button} onPress={() => player.next()} hitSlop={8}>
          <Text style={styles.glyph}>▶▶</Text>
        </Pressable>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: theme.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#ffffff1f' },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, gap: 12 },
  cover: { width: 44, height: 44, borderRadius: 4, backgroundColor: '#2a2a2a' },
  meta: { flex: 1, gap: 2 },
  title: { color: theme.text, fontSize: 14, fontWeight: '600' },
  artist: { color: theme.muted, fontSize: 12 },
  button: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  glyph: { color: theme.text, fontSize: 16 },
});
