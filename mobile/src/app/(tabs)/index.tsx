import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { auth, useAuth } from '../../auth/instance';
import { Loadable, RequireAuth } from '../../components/Loadable';
import { Shelf } from '../../components/Shelf';
import { WaveControls, WaveHero } from '../../components/WaveHero';
import { buildActivity, hoursText } from '../../core/activity';
import { texts } from '../../settings/texts';
import { currentItem } from '../../player/queue';
import { usePlayerState } from '../../player/instance';
import { theme } from '../../theme';
import { CloudLogo, Icon, type IconName } from '../../ui/Icon';
import { IconButton } from '../../ui/kit';
import { useLoad } from '../../ui/useLoad';
import { DAY, history } from '../../wave/data';
import { picks, usePicks, wave } from '../../wave/instance';

/** Набор из меню трека: показывается, пока в нём что-то есть */
function PicksBar() {
  const list = usePicks();
  if (!list.length) return null;
  return (
    <View style={styles.picks}>
      <Icon name="add" size={22} color={theme.accent} />
      <Text style={styles.picksText}>{texts.pickStart}: {list.length}</Text>
      <Pressable style={styles.picksGo} onPress={() => { const seed = picks.take(); if (seed) void wave.start(seed); }}>
        <Text style={styles.picksGoText}>Включить</Text>
      </Pressable>
      <IconButton icon="close" size={34} label={texts.pickClear} color={theme.muted} onPress={() => picks.clear()} />
    </View>
  );
}

interface TileProps { icon: IconName; title: string; sub: string; tint: string; onPress: () => void }

function Tile({ icon, title, sub, tint, onPress }: TileProps) {
  return (
    <Pressable style={styles.tile} onPress={onPress} accessibilityRole="button" android_ripple={{ color: '#ffffff14' }}>
      <View style={[styles.tileIcon, { backgroundColor: tint + '2e' }]}>
        <Icon name={icon} size={22} color={tint} />
      </View>
      <Text style={styles.tileTitle} numberOfLines={1}>{title}</Text>
      <Text style={styles.tileSub} numberOfLines={1}>{sub}</Text>
    </Pressable>
  );
}

/** Плитка «Активность»: часы за неделю из журнала прослушиваний */
function ActivityTile() {
  const user = auth.getState().session?.user.id ?? 0;
  const { data } = useLoad(async () => {
    const now = Date.now();
    const from = now - 7 * DAY;
    return buildActivity(await history.tastePlays(user, from), from, now);
  }, [user]);
  return <Tile icon="chart" title="Активность" sub={data ? `${hoursText(data.totalMs)} за неделю` : 'Часы и жанры'} tint="#18c9c0" onPress={() => router.push('/activity')} />;
}

function Feed() {
  const playing = currentItem(usePlayerState().queue)?.track.id;
  const { data, error, reload } = useLoad(async () => {
    const [recent, likes] = await Promise.all([
      auth.sc.history(20),
      auth.sc.likedIds({ limit: 20 }).then((page) => auth.sc.tracksByIds(page.items)),
    ]);
    return { history: recent, likes };
  }, []);

  return (
    <Loadable ready={!!data} error={error} onRetry={reload}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <WaveHero size={300} />
        <WaveControls />
        <PicksBar />

        <View style={styles.tiles}>
          <Tile icon="heart" title="Мне нравится" sub="Лайки и плейлисты" tint="#ff5500" onPress={() => router.navigate('/library')} />
          <ActivityTile />
          <Tile icon="radar" title="Радар" sub="Новое у подписок" tint="#ff2d8f" onPress={() => router.push('/radar')} />
          <Tile icon="trending" title="Чарты" sub="US и UK по жанрам" tint="#ffb454" onPress={() => router.push('/charts')} />
        </View>

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
        <View style={styles.brand}>
          <View style={styles.logo}><CloudLogo size={22} color="#fff" /></View>
          <Text style={styles.title} numberOfLines={1}>{state.status === 'in' ? state.session.user.username : 'SoundCloud Wave'}</Text>
        </View>
        <IconButton icon="settings" label="Настройки" bg={theme.surface} onPress={() => router.push('/settings')} />
      </View>
      <RequireAuth>
        <Feed />
      </RequireAuth>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 8 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  logo: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.accent, alignItems: 'center', justifyContent: 'center' },
  title: { color: theme.text, fontSize: 20, fontWeight: '800', flexShrink: 1 },
  content: { paddingBottom: 24 },
  muted: { color: theme.muted, fontSize: 13, textAlign: 'center', padding: 24 },
  picks: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 16, marginTop: 16, paddingVertical: 8, paddingLeft: 16, paddingRight: 8, borderRadius: 22, backgroundColor: theme.surface },
  picksText: { flex: 1, color: theme.text, fontSize: 14, fontWeight: '600' },
  picksGo: { backgroundColor: theme.accent, borderRadius: 18, paddingVertical: 8, paddingHorizontal: 16 },
  picksGoText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 16, marginTop: 24, marginBottom: 26 },
  tile: { width: '48.5%', backgroundColor: theme.surface, borderRadius: 22, padding: 16, gap: 4, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border },
  tileIcon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  tileTitle: { color: theme.text, fontSize: 16, fontWeight: '800' },
  tileSub: { color: theme.muted, fontSize: 13 },
});
