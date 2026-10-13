import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { WaveTrack } from '../core/waveTypes';
import { artwork, clock } from '../player/format';
import { theme } from '../theme';
import { Icon } from '../ui/Icon';
import { openTrackMenu } from './TrackMenu';

export function TrackRow({ track, playing, onPress }: { track: WaveTrack; playing: boolean; onPress: () => void }) {
  const cover = artwork(track.artwork_url);
  const seconds = ((track.full_duration ?? track.duration) || 0) / 1000;
  return (
    <Pressable style={styles.row} onPress={onPress} onLongPress={() => openTrackMenu(track)} android_ripple={{ color: '#ffffff10' }}>
      {cover ? <Image source={{ uri: cover }} style={styles.cover} /> : <View style={[styles.cover, styles.noCover]}><Icon name="music" size={22} color={theme.muted} /></View>}
      <View style={styles.meta}>
        <Text style={[styles.title, playing && styles.accent]} numberOfLines={1}>{track.title}</Text>
        <Text style={styles.muted} numberOfLines={1}>
          {track.user?.username ?? ''}{seconds ? ` · ${clock(seconds)}` : ''}
        </Text>
      </View>
      <Pressable onPress={() => openTrackMenu(track)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Меню трека" style={styles.more}>
        <Icon name="more" size={22} color={theme.muted} />
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingLeft: 16, paddingVertical: 8, gap: 14 },
  cover: { width: 54, height: 54, borderRadius: 12, backgroundColor: theme.surface },
  noCover: { alignItems: 'center', justifyContent: 'center' },
  meta: { flex: 1, gap: 2 },
  title: { color: theme.text, fontSize: 15, fontWeight: '600' },
  muted: { color: theme.muted, fontSize: 13 },
  accent: { color: theme.accent },
  more: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center' },
});
