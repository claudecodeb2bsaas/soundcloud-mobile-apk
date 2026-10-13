import { useLocalSearchParams } from 'expo-router';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { auth } from '../../auth/instance';
import { Loadable } from '../../components/Loadable';
import { TrackRow } from '../../components/TrackRow';
import { player, usePlayerState } from '../../player/instance';
import { currentItem } from '../../player/queue';
import { theme } from '../../theme';
import { Button, ScreenHeader } from '../../ui/kit';
import { saveArtwork } from '../../ui/saveArtwork';
import { useLoad } from '../../ui/useLoad';

/** Плейлист или альбом: свой, сохранённый или из чартов. До 500 треков по порядку сайта */
export default function Playlist() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = Number(params.id);
  const playing = currentItem(usePlayerState().queue)?.track.id;
  const { data, error, reload } = useLoad(async () => {
    const loaded = await auth.sc.playlistTracks(id);
    if (!loaded) throw new Error('Плейлист не найден');
    return loaded;
  }, [id]);

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScreenHeader title="" />
      <Loadable ready={!!data} error={error} onRetry={reload}>
        <FlatList
          data={data?.tracks ?? []}
          keyExtractor={(track) => String(track.id)}
          ListHeaderComponent={
            data ? (
              <View style={styles.head}>
                <Text style={styles.name}>{data.info.title}</Text>
                <Text style={styles.muted}>{[data.info.owner, `${data.info.count} треков`].filter(Boolean).join(' · ')}</Text>
                {data.tracks.length ? (
                  <Button label="Играть" icon="play" onPress={() => player.playTracks(data.tracks)} />
                ) : null}
                {data.info.artwork ? (
                  <Pressable onPress={() => void saveArtwork(data.info.artwork)} hitSlop={8}>
                    <Text style={styles.link}>Скачать обложку</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null
          }
          ListEmptyComponent={<Text style={[styles.muted, styles.pad]}>Открытых треков нет</Text>}
          renderItem={({ item, index }) => <TrackRow track={item} playing={item.id === playing} onPress={() => data && player.playTracks(data.tracks, index)} />}
        />
      </Loadable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  link: { color: theme.accent, fontSize: 14, fontWeight: '600' },
  head: { alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 14 },
  name: { color: theme.text, fontSize: 26, fontWeight: '800', textAlign: 'center' },
  muted: { color: theme.muted, fontSize: 13, textAlign: 'center' },
  pad: { padding: 24 },
});
