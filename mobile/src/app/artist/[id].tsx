import { router, useLocalSearchParams } from 'expo-router';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { auth } from '../../auth/instance';
import { Loadable } from '../../components/Loadable';
import { TrackRow } from '../../components/TrackRow';
import { artwork, count } from '../../player/format';
import { player, usePlayerState } from '../../player/instance';
import { currentItem } from '../../player/queue';
import { theme } from '../../theme';
import { saveArtwork } from '../../ui/saveArtwork';
import { useLoad } from '../../ui/useLoad';

export default function Artist() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = Number(params.id);
  const playing = currentItem(usePlayerState().queue)?.track.id;
  const { data, error, reload } = useLoad(async () => {
    const [user, top, latest] = await Promise.all([auth.sc.user(id), auth.sc.userToptracks(id), auth.sc.userTracks(id)]);
    if (!user) throw new Error('Артист не найден');
    return { user, top, latest };
  }, [id]);

  const avatar = artwork(data?.user.avatarUrl, 't500x500');
  const all = data ? (data.top.length ? data.top : data.latest) : [];

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back}>
        <Text style={styles.link}>Назад</Text>
      </Pressable>
      <Loadable ready={!!data} error={error} onRetry={reload}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.head}>
            {avatar ? <Image source={{ uri: avatar }} style={styles.avatar} /> : <View style={styles.avatar} />}
            <Text style={styles.name}>{data?.user.username}</Text>
            <Text style={styles.muted}>
              {count(data?.user.followers ?? 0)} подписчиков · {data?.user.trackCount ?? 0} треков
              {data?.user.city ? ` · ${data.user.city}` : ''}
            </Text>
            {all.length ? (
              <Pressable style={styles.button} onPress={() => player.playTracks(all)}>
                <Text style={styles.buttonText}>Играть</Text>
              </Pressable>
            ) : null}
            {avatar ? (
              <Pressable onPress={() => void saveArtwork(data?.user.avatarUrl)} hitSlop={8}>
                <Text style={styles.link}>Скачать аватар</Text>
              </Pressable>
            ) : null}
          </View>
          {data?.top.length ? <Text style={styles.heading}>Популярное</Text> : null}
          {data?.top.map((track, i) => (
            <TrackRow key={track.id} track={track} playing={track.id === playing} onPress={() => player.playTracks(data.top, i)} />
          ))}
          {data?.latest.length ? <Text style={styles.heading}>Новое</Text> : null}
          {data?.latest.map((track, i) => (
            <TrackRow key={track.id} track={track} playing={track.id === playing} onPress={() => player.playTracks(data.latest, i)} />
          ))}
          {data && !all.length ? <Text style={[styles.muted, styles.pad]}>Открытых треков нет</Text> : null}
        </ScrollView>
      </Loadable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  back: { paddingHorizontal: 16, paddingVertical: 12, alignSelf: 'flex-start' },
  link: { color: theme.accent, fontSize: 15 },
  content: { paddingBottom: 24 },
  head: { alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingBottom: 12 },
  avatar: { width: 120, height: 120, borderRadius: 60, backgroundColor: theme.surface },
  name: { color: theme.text, fontSize: 22, fontWeight: '700', textAlign: 'center' },
  muted: { color: theme.muted, fontSize: 13, textAlign: 'center' },
  pad: { padding: 24 },
  heading: { color: theme.text, fontSize: 18, fontWeight: '700', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4 },
  button: { backgroundColor: theme.accent, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 32, marginTop: 4 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 15 },
});
