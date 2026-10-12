import { ScrollView, StyleSheet, Text, View, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { auth, useAuth } from '../../auth/instance';
import { Loadable, RequireAuth } from '../../components/Loadable';
import { MixShelf } from '../../components/MixShelf';
import { Shelf } from '../../components/Shelf';
import { WAVE_TEXTS } from '../../core/waveTexts';
import { currentItem } from '../../player/queue';
import { usePlayerState } from '../../player/instance';
import { theme } from '../../theme';
import { useLoad } from '../../ui/useLoad';
import { picks, usePicks, useWave, wave } from '../../wave/instance';

/** Набор из меню трека: показывается, пока в нём что-то есть */
function PicksBar() {
  const list = usePicks();
  if (!list.length) return null;
  return (
    <View style={styles.picks}>
      <Text style={styles.picksText}>{WAVE_TEXTS.ru.pickStart}: {list.length}</Text>
      <Pressable style={styles.picksGo} onPress={() => { const seed = picks.take(); if (seed) void wave.start(seed); }}>
        <Text style={styles.waveText}>Включить</Text>
      </Pressable>
      <Pressable onPress={() => picks.clear()} hitSlop={12}>
        <Text style={styles.link}>{WAVE_TEXTS.ru.pickClear}</Text>
      </Pressable>
    </View>
  );
}

function Feed() {
  const playing = currentItem(usePlayerState().queue)?.track.id;
  const waveState = useWave();
  const { data, error, reload } = useLoad(async () => {
    const [history, likes] = await Promise.all([
      auth.sc.history(20),
      auth.sc.likedIds({ limit: 20 }).then((page) => auth.sc.tracksByIds(page.items)),
    ]);
    return { history, likes };
  }, []);

  return (
    <Loadable ready={!!data} error={error} onRetry={reload}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable style={styles.wave} onPress={() => void wave.start()} disabled={waveState.status === 'loading'}>
          <Text style={styles.waveText}>{waveState.status === 'loading' ? 'Подбираю…' : '≋  Включить мою волну'}</Text>
        </Pressable>
        {waveState.status === 'empty' || waveState.status === 'error' ? (
          <Text style={[styles.muted, styles.waveNote]}>
            {waveState.status === 'empty' ? 'Подобрать нечего: послушай или лайкни что-нибудь' : 'Не удалось подобрать треки. Проверь соединение.'}
          </Text>
        ) : null}
        <Shelf title="Недавно слушал" tracks={data?.history ?? []} playing={playing} />
        <Shelf title="Лайки" tracks={data?.likes ?? []} playing={playing} />
        {data && !data.history.length && !data.likes.length ? <Text style={styles.muted}>Пока пусто: послушай или лайкни что-нибудь</Text> : null}
      </ScrollView>
    </Loadable>
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
      <RequireAuth>
        <Feed />
      </RequireAuth>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  title: { color: theme.text, fontSize: 22, fontWeight: '700' },
  link: { color: theme.accent, fontSize: 15 },
  content: { paddingTop: 8, paddingBottom: 16 },
  muted: { color: theme.muted, fontSize: 13, textAlign: 'center', padding: 24 },
  wave: { backgroundColor: theme.accent, borderRadius: 24, paddingVertical: 14, alignItems: 'center', marginHorizontal: 16, marginBottom: 20 },
  waveNote: { padding: 0, marginTop: -8, marginBottom: 16 },
  picks: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, marginBottom: 16 },
  picksText: { flex: 1, color: theme.text, fontSize: 14 },
  picksGo: { backgroundColor: theme.accent, borderRadius: 16, paddingVertical: 8, paddingHorizontal: 16 },
  waveText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
