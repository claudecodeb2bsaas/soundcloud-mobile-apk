import { Link } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { WaveTrack } from '../core/waveTypes';
import { auth, useAuth } from '../auth/instance';
import { artwork } from '../player/format';
import { player, usePlayerState } from '../player/instance';
import { currentItem } from '../player/queue';
import { theme } from '../theme';

function Likes() {
  const [tracks, setTracks] = useState<WaveTrack[] | null>(null);
  const [error, setError] = useState('');
  const playing = currentItem(usePlayerState().queue)?.track.id;

  const load = useCallback(async () => {
    setError('');
    setTracks(null);
    try {
      const page = await auth.sc.likedIds({ limit: 40 });
      setTracks(await auth.sc.tracksByIds(page.items));
    } catch (e) {
      const status = (e as { status?: number } | null)?.status;
      setError(status === 401 ? 'Вход устарел, войди снова' : 'Не удалось загрузить лайки. Проверь соединение.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>{error}</Text>
        <Pressable style={styles.button} onPress={() => void load()}>
          <Text style={styles.buttonText}>Повторить</Text>
        </Pressable>
      </View>
    );
  }
  if (!tracks) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }
  return (
    <FlatList
      data={tracks}
      keyExtractor={(track) => String(track.id)}
      contentContainerStyle={styles.listEnd}
      ListEmptyComponent={<Text style={[styles.muted, styles.pad]}>Лайков пока нет</Text>}
      renderItem={({ item, index }) => {
        const cover = artwork(item.artwork_url);
        return (
          <Pressable style={styles.row} onPress={() => player.playTracks(tracks, index)}>
            {cover ? <Image source={{ uri: cover }} style={styles.cover} /> : <View style={styles.cover} />}
            <View style={styles.meta}>
              <Text style={[styles.track, item.id === playing && styles.accent]} numberOfLines={1}>
                {item.title}
              </Text>
              <Text style={styles.muted} numberOfLines={1}>
                {item.user?.username ?? ''}
              </Text>
            </View>
          </Pressable>
        );
      }}
    />
  );
}

export default function Home() {
  const state = useAuth();

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>{state.status === 'in' ? state.session.user.username : 'SoundCloud Wave'}</Text>
        {state.status === 'in' ? (
          <Pressable onPress={() => void auth.signOut()} hitSlop={12}>
            <Text style={styles.link}>Выйти</Text>
          </Pressable>
        ) : null}
      </View>
      {state.status === 'loading' ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.accent} />
        </View>
      ) : state.status === 'out' ? (
        <View style={styles.center}>
          <Text style={styles.muted}>Войди в аккаунт SoundCloud, чтобы увидеть лайки и включить волну</Text>
          <Link href="/login" asChild>
            <Pressable style={styles.button}>
              <Text style={styles.buttonText}>Войти</Text>
            </Pressable>
          </Link>
        </View>
      ) : (
        <Likes />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  title: { color: theme.text, fontSize: 22, fontWeight: '700' },
  link: { color: theme.accent, fontSize: 15 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  muted: { color: theme.muted, fontSize: 13, textAlign: 'center' },
  pad: { padding: 16 },
  listEnd: { paddingBottom: 16 },
  button: { backgroundColor: theme.accent, borderRadius: 8, paddingVertical: 12, paddingHorizontal: 28 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8, gap: 12 },
  cover: { width: 52, height: 52, borderRadius: 4, backgroundColor: theme.surface },
  meta: { flex: 1, gap: 2 },
  track: { color: theme.text, fontSize: 15, fontWeight: '500' },
  accent: { color: theme.accent },
});
