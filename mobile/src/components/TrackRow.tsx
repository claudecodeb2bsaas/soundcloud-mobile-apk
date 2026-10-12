import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { WaveTrack } from '../core/waveTypes';
import { artwork, clock } from '../player/format';
import { theme } from '../theme';
import { openTrackMenu } from './TrackMenu';

export function TrackRow({ track, playing, onPress }: { track: WaveTrack; playing: boolean; onPress: () => void }) {
  const cover = artwork(track.artwork_url);
  const seconds = ((track.full_duration ?? track.duration) || 0) / 1000;
  return (
    <Pressable style={styles.row} onPress={onPress} onLongPress={() => openTrackMenu(track)}>
      {cover ? <Image source={{ uri: cover }} style={styles.cover} /> : <View style={styles.cover} />}
      <View style={styles.meta}>
        <Text style={[styles.title, playing && styles.accent]} numberOfLines={1}>{track.title}</Text>
        <Text style={styles.muted} numberOfLines={1}>
          {track.user?.username ?? ''}{seconds ? ` · ${clock(seconds)}` : ''}
        </Text>
      </View>
      <Pressable onPress={() => openTrackMenu(track)} hitSlop={8} accessibilityLabel="Меню трека" style={styles.more}>
        <Text style={styles.moreGlyph}>⋯</Text>
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingLeft: 16, paddingVertical: 8, gap: 12 },
  cover: { width: 52, height: 52, borderRadius: 4, backgroundColor: theme.surface },
  meta: { flex: 1, gap: 2 },
  title: { color: theme.text, fontSize: 15, fontWeight: '500' },
  muted: { color: theme.muted, fontSize: 13 },
  accent: { color: theme.accent },
  more: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  moreGlyph: { color: theme.muted, fontSize: 22 },
});
