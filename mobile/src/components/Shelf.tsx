import { FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { WaveTrack } from '../core/waveTypes';
import { artwork } from '../player/format';
import { player } from '../player/instance';
import { theme } from '../theme';
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
          return (
            <Pressable style={styles.card} onPress={() => player.playTracks(tracks, index)} onLongPress={() => openTrackMenu(item)}>
              {cover ? <Image source={{ uri: cover }} style={styles.cover} /> : <View style={styles.cover} />}
              <Text style={[styles.title, item.id === playing && styles.accent]} numberOfLines={1}>{item.title}</Text>
              <Text style={styles.muted} numberOfLines={1}>{item.user?.username ?? ''}</Text>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { marginBottom: 20 },
  heading: { color: theme.text, fontSize: 18, fontWeight: '700', paddingHorizontal: 16, marginBottom: 10 },
  list: { paddingHorizontal: 16, gap: 12 },
  card: { width: 140, gap: 2 },
  cover: { width: 140, height: 140, borderRadius: 6, backgroundColor: theme.surface, marginBottom: 6 },
  title: { color: theme.text, fontSize: 14, fontWeight: '500' },
  muted: { color: theme.muted, fontSize: 12 },
  accent: { color: theme.accent },
});
