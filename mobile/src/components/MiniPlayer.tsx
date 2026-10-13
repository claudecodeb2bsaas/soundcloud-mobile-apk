import { router, usePathname } from 'expo-router';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { currentItem } from '../player/queue';
import { artwork } from '../player/format';
import { player, usePlayerState } from '../player/instance';
import { theme } from '../theme';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/kit';
import { ProgressBar } from './ProgressBar';
import { DislikeButton, LikeButton } from './TrackReactions';

const HIDDEN_ON = ['/player', '/queue', '/login'];

export function MiniPlayer() {
  const state = usePlayerState();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const item = currentItem(state.queue);
  if (!item || HIDDEN_ON.includes(pathname)) return null;

  const cover = artwork(item.track.artwork_url);
  const busy = state.status === 'loading';
  const playing = state.status === 'playing';

  return (
    <View style={[styles.root, { paddingBottom: insets.bottom }]}>
      <ProgressBar thin />
      <Pressable style={styles.row} onPress={() => router.push('/player')} accessibilityRole="button" accessibilityLabel="Открыть плеер">
        {cover ? <Image source={{ uri: cover }} style={styles.cover} /> : <View style={[styles.cover, styles.noCover]}><Icon name="music" size={20} color={theme.muted} /></View>}
        <View style={styles.meta}>
          <Text style={styles.title} numberOfLines={1}>
            {item.track.title}
          </Text>
          <Text style={[styles.artist, state.status === 'error' && styles.error]} numberOfLines={1}>
            {state.status === 'error' ? 'Ошибка воспроизведения' : item.track.user?.username ?? ''}
          </Text>
        </View>
        <DislikeButton track={item.track} size={20} />
        <IconButton icon="prev" size={38} iconSize={22} label="Предыдущий трек" onPress={() => player.previous()} />
        <Pressable
          style={styles.play}
          onPress={() => player.toggle()}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={playing ? 'Пауза' : 'Играть'}
          android_ripple={{ color: '#ffffff44', borderless: true, radius: 22 }}
        >
          {busy ? <ActivityIndicator color="#fff" size="small" /> : <Icon name={playing ? 'pause' : 'play'} size={24} color="#fff" />}
        </Pressable>
        <IconButton icon="next" size={38} iconSize={22} label="Следующий трек" onPress={() => player.next()} />
        <LikeButton track={item.track} size={22} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: '#121214', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 8, gap: 2 },
  cover: { width: 46, height: 46, borderRadius: 10, backgroundColor: theme.surfaceHigh, marginRight: 8 },
  noCover: { alignItems: 'center', justifyContent: 'center' },
  meta: { flex: 1, gap: 2 },
  title: { color: theme.text, fontSize: 14, fontWeight: '700' },
  artist: { color: theme.muted, fontSize: 12 },
  error: { color: theme.warn },
  play: { width: 44, height: 44, borderRadius: 22, backgroundColor: theme.accent, alignItems: 'center', justifyContent: 'center', marginHorizontal: 2 },
});
