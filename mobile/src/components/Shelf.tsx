import { FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { WaveTrack } from '../core/waveTypes';
import { artwork } from '../player/format';
import { player } from '../player/instance';
import { theme } from '../theme';
import { Icon } from '../ui/Icon';
import { openTrackMenu } from './TrackMenu';

/** Горизонтальная полка карточек; нажатие запускает очередь с этого трека */
export function Shelf({ title, tracks, playing }: { title: string; tracks: WaveTrack[]; playing?: number }) {
  if (!tracks.length) return null;
  return (
    <View style={styles.root}>
      <Text style={styles.heading}>{title}</Text>
      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={tracks}
        keyExtractor={(track) => String(track.id)}
        contentContainerStyle={styles.list}
        renderItem={({ item, index }) => {
          const cover = artwork(item.artwork_url, 't500x500');
          const now = item.id === playing;
          return (
            <Pressable style={styles.card} onPress={() => player.playTracks(tracks, index)} onLongPress={() => openTrackMenu(item)}>
              {cover ? <Image source={{ uri: cover }} style={styles.cover} /> : <View style={[styles.cover, styles.noCover]}><Icon name="music" size={36} color={theme.muted} /></View>}
              {now ? <View style={styles.badge}><Icon name="wave" size={16} color="#fff" /></View> : null}
              <Text style={[styles.title, now && styles.accent]} numberOfLines={1}>{item.title}</Text>
              <Text style={styles.muted} numberOfLines={1}>{item.user?.username ?? ''}</Text>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { marginBottom: 26 },
  heading: { color: theme.text, fontSize: 20, fontWeight: '800', paddingHorizontal: 16, marginBottom: 12 },
  list: { paddingHorizontal: 16, gap: 14 },
  card: { width: 148, gap: 2 },
  cover: { width: 148, height: 148, borderRadius: 18, backgroundColor: theme.surface, marginBottom: 8 },
  noCover: { alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: 8, right: 8, width: 28, height: 28, borderRadius: 14, backgroundColor: theme.accent, alignItems: 'center', justifyContent: 'center' },
  title: { color: theme.text, fontSize: 14, fontWeight: '600' },
  muted: { color: theme.muted, fontSize: 12 },
  accent: { color: theme.accent },
});
