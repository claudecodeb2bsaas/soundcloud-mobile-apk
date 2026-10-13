import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Query } from '../../api/client';
import { auth } from '../../auth/instance';
import { Loadable, RequireAuth } from '../../components/Loadable';
import { TrackRow } from '../../components/TrackRow';
import type { WaveTrack } from '../../core/waveTypes';
import { player, usePlayerState } from '../../player/instance';
import { currentItem } from '../../player/queue';
import { theme } from '../../theme';
import { Icon } from '../../ui/Icon';
import { Chip, IconButton } from '../../ui/kit';
import { loadErrorText, useLoad } from '../../ui/useLoad';
import { library } from '../../wave/instance';

const CHUNK = 50;

function TrackList({ tracks, footer, onEnd }: { tracks: WaveTrack[]; footer?: boolean; onEnd?: () => void }) {
  const playing = currentItem(usePlayerState().queue)?.track.id;
  return (
    <FlatList
      data={tracks}
      keyExtractor={(track) => String(track.id)}
      onEndReached={onEnd}
      onEndReachedThreshold={0.6}
      ListEmptyComponent={<Text style={styles.muted}>Здесь пока пусто</Text>}
      ListFooterComponent={footer ? <ActivityIndicator color={theme.accent} style={styles.footer} /> : null}
      renderItem={({ item, index }) => <TrackRow track={item} playing={item.id === playing} onPress={() => player.playTracks(tracks, index)} />}
    />
  );
}

/** Лайки: сначала id (страницами по 200), полные треки подгружаются по 50 при прокрутке */
function Likes() {
  const ids = useRef<number[]>([]);
  const next = useRef<Query | null | undefined>(undefined);
  const busy = useRef(false);
  const shown = useRef(0);
  const [tracks, setTracks] = useState<WaveTrack[] | null>(null);
  const [more, setMore] = useState(true);
  const [error, setError] = useState('');

  const loadMore = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      if (next.current !== null && (next.current === undefined || ids.current.length - shown.current < CHUNK)) {
        const page = await auth.sc.likedIds(next.current ?? { limit: 200 });
        ids.current = [...ids.current, ...page.items];
        next.current = page.next;
      }
      const chunk = ids.current.slice(shown.current, shown.current + CHUNK);
      if (!chunk.length) {
        setTracks((old) => old ?? []);
        setMore(false);
        return;
      }
      shown.current += chunk.length;
      const loaded = await auth.sc.tracksByIds(chunk);
      setTracks((old) => [...(old ?? []), ...loaded]);
      setMore(shown.current < ids.current.length || next.current !== null);
    } catch (e) {
      setError(loadErrorText(e));
    } finally {
      busy.current = false;
    }
  }, []);

  const reload = useCallback(() => {
    ids.current = [];
    next.current = undefined;
    shown.current = 0;
    setTracks(null);
    setError('');
    setMore(true);
    void loadMore();
  }, [loadMore]);
  useEffect(reload, [reload]);

  return (
    <Loadable ready={!!tracks} error={error} onRetry={reload}>
      <TrackList tracks={tracks ?? []} footer={more} onEnd={() => void loadMore()} />
    </Loadable>
  );
}

function History() {
  const { data, error, reload } = useLoad(() => auth.sc.history(100), []);
  return (
    <Loadable ready={!!data} error={error} onRetry={reload}>
      <TrackList tracks={data ?? []} />
    </Loadable>
  );
}

/** Свои и сохранённые плейлисты (тот же список, что в «Моей музыке») */
function Playlists() {
  const { data, error, reload } = useLoad(async () => (await library.sources()).filter((source) => source.key.startsWith('playlist:')), []);
  return (
    <Loadable ready={!!data} error={error} onRetry={reload}>
      <FlatList
        data={data ?? []}
        keyExtractor={(source) => source.key}
        ListEmptyComponent={<Text style={styles.muted}>Плейлистов пока нет</Text>}
        renderItem={({ item }) => (
          <Pressable style={styles.list} onPress={() => router.push(`/playlist/${item.key.slice('playlist:'.length)}`)}>
            <View style={styles.listIcon}><Icon name="library" size={22} color={theme.accent} /></View>
            <View style={styles.listText}>
              <Text style={styles.listTitle} numberOfLines={1}>{item.title}</Text>
              <Text style={styles.listCount}>{item.count} треков</Text>
            </View>
            <Icon name="chevronRight" size={22} color={theme.muted} />
          </Pressable>
        )}
      />
    </Loadable>
  );
}

export default function Library() {
  const [tab, setTab] = useState<'likes' | 'history' | 'playlists'>('likes');
  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Библиотека</Text>
        <IconButton icon="chart" label="Активность" bg={theme.surface} onPress={() => router.push('/activity')} />
      </View>
      <View style={styles.tabs}>
        {(['likes', 'playlists', 'history'] as const).map((id) => (
          <Chip key={id} label={id === 'likes' ? 'Лайки' : id === 'playlists' ? 'Плейлисты' : 'История'} on={tab === id} onPress={() => setTab(id)} />
        ))}
      </View>
      <RequireAuth>{tab === 'likes' ? <Likes /> : tab === 'playlists' ? <Playlists /> : <History />}</RequireAuth>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 8 },
  title: { color: theme.text, fontSize: 28, fontWeight: '800' },
  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 10 },
  muted: { color: theme.muted, fontSize: 13, textAlign: 'center', padding: 24 },
  footer: { padding: 16 },
  list: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 10 },
  listIcon: { width: 48, height: 48, borderRadius: 14, backgroundColor: theme.accentSoft, alignItems: 'center', justifyContent: 'center' },
  listText: { flex: 1, gap: 2 },
  listTitle: { color: theme.text, fontSize: 15, fontWeight: '600' },
  listCount: { color: theme.muted, fontSize: 13 },
});
