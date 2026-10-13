import { router } from 'expo-router';
import { useSyncExternalStore } from 'react';
import { Image, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { auth, useAuth } from '../auth/instance';
import { fillText } from '../core/waveTexts';
import { texts } from '../settings/texts';
import type { WaveTrack } from '../core/waveTypes';
import { artistIdOf, artwork } from '../player/format';
import { player } from '../player/instance';
import { currentItem } from '../player/queue';
import { theme } from '../theme';
import { saveArtwork } from '../ui/saveArtwork';
import { Icon, type IconName } from '../ui/Icon';
import { toast } from '../ui/feedback';
import { Sheet } from '../ui/Sheet';
import { likes, marks, noteLiked, picks, usePicks, useLikes, useMarks, wave } from '../wave/instance';

// Меню трека: одно на приложение, открывается из любого списка через openTrackMenu

let target: WaveTrack | null = null;
const listeners = new Set<() => void>();
const set = (track: WaveTrack | null): void => {
  target = track;
  for (const listener of [...listeners]) listener();
};

export const openTrackMenu = (track: WaveTrack): void => set(track);

/** Похожие треки по версии сайта: играем выбранный и после него найденное */
async function playSimilar(track: WaveTrack): Promise<void> {
  try {
    const related = await auth.sc.relatedTracks(track.id);
    player.playTracks([track, ...related.filter((t) => t.id !== track.id)]);
  } catch {
    toast('Не удалось найти похожие треки', 'sparkle');
  }
}

export async function toggleLike(track: WaveTrack): Promise<void> {
  try {
    if (await likes.toggle(track.id)) noteLiked(track);
  } catch (error) {
    const status = (error as { status?: number } | null)?.status;
    toast(
      status === 401 ? 'Вход устарел: войди в аккаунт заново (Настройки → Аккаунты)'
        : status === 403 ? 'SoundCloud отклонил лайк (403). Попробуй ещё раз чуть позже'
          : 'Не удалось изменить лайк. Проверь соединение',
      'heartOutline',
    );
  }
}

/** «Не нравится» и скрытый артист убирают подходящее из очереди: играющее пропускается, остальное удаляется */
function purgeQueue(): void {
  const data = marks.getSnapshot();
  const bad = (track: WaveTrack): boolean => track.id in data.tracks || (artistIdOf(track) ?? 0) in data.artists;
  const { queue } = player.getState();
  for (let i = queue.items.length - 1; i > queue.index; i--) if (bad(queue.items[i].track)) player.removeAt(i);
  const now = currentItem(player.getState().queue);
  if (now && bad(now.track)) player.next();
}

/** Дизлайк: у SoundCloud такого API нет, отметка локальная; вкус и волна учитывают её сразу, трек уходит из очереди. Повтор снимает отметку */
export function toggleDislike(track: WaveTrack): void {
  if (!marks.toggleTrack(track)) return;
  wave.feedback(track, -1);
  purgeQueue();
}

interface Action { label: string; icon: IconName; action: () => void; off?: boolean; on?: boolean; danger?: boolean }

function Tile({ item, onPress }: { item: Action; onPress: () => void }) {
  return (
    <Pressable style={styles.tile} onPress={onPress} accessibilityRole="button" android_ripple={{ color: '#ffffff1f' }}>
      <View style={[styles.tileIcon, item.on && styles.tileIconOn]}>
        <Icon name={item.icon} size={24} color={item.on ? '#fff' : theme.text} />
      </View>
      <Text style={styles.tileText} numberOfLines={2}>{item.label}</Text>
    </Pressable>
  );
}

function Row({ item, onPress }: { item: Action; onPress: () => void }) {
  const color = item.danger ? theme.danger : theme.text;
  return (
    <Pressable style={styles.row} onPress={onPress} accessibilityRole="button" android_ripple={{ color: '#ffffff14' }}>
      <Icon name={item.icon} size={22} color={item.danger ? theme.danger : theme.muted} />
      <Text style={[styles.rowText, { color }]} numberOfLines={1}>{item.label}</Text>
    </Pressable>
  );
}

export function TrackMenuHost() {
  const track = useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => target, () => target);
  const signedIn = useAuth().status === 'in';
  const liked = useLikes();
  const data = useMarks();
  const picked = usePicks();
  if (!track) return null;

  const artist = artistIdOf(track);
  const artistName = track.user?.username ?? '';
  const isLiked = liked.has(track.id);
  const disliked = track.id in data.tracks;
  const hidden = artist !== null && artist in data.artists;
  const cover = artwork(track.artwork_url);

  const quick: Action[] = [
    { label: isLiked ? 'В лайках' : 'В лайки', icon: isLiked ? 'heart' : 'heartOutline', action: () => void toggleLike(track), off: !signedIn, on: isLiked },
    { label: 'Волна от трека', icon: 'wave', action: () => void wave.start({ kind: 'track', track }), off: !signedIn },
    { label: 'Играть следом', icon: 'playNext', action: () => { player.insertNext(track); toast('Сыграет следующим', 'playNext'); } },
    { label: 'Поделиться', icon: 'share', action: () => void Share.share({ message: track.permalink_url ?? '' }), off: !track.permalink_url },
  ];
  const list: Action[] = [
    { label: 'Волна от артиста', icon: 'bolt', action: () => void wave.start({ kind: 'artist', id: artist ?? 0, name: artistName }), off: !signedIn || artist === null },
    { label: 'Играть похожее', icon: 'sparkle', action: () => void playSimilar(track) },
    {
      label: picked.some((item) => item.id === track.id) ? texts.menuUnpick : texts.menuPick,
      icon: picked.some((item) => item.id === track.id) ? 'check' : 'add',
      action: () => { if (picks.toggle(track) === 'full') toast(fillText(texts.toastPickFull, { count: String(picked.length) }), 'add'); },
      off: !signedIn,
    },
    { label: 'В конец очереди', icon: 'queue', action: () => { player.insertLast(track); toast('Добавлено в конец очереди', 'queue'); } },
    { label: 'К артисту', icon: 'person', action: () => router.push(`/artist/${artist}`), off: artist === null },
    { label: 'Скачать обложку', icon: 'download', action: () => void saveArtwork(track.artwork_url), off: !track.artwork_url },
    { label: 'Скачать аватар артиста', icon: 'download', action: () => void saveArtwork(track.user?.avatar_url), off: !track.user?.avatar_url },
  ];
  const mute: Action[] = [
    { label: disliked ? 'Вернуть в подбор' : 'Не нравится', icon: disliked ? 'dislike' : 'dislikeOutline', action: () => toggleDislike(track), danger: true },
    {
      label: hidden ? 'Показывать артиста' : 'Скрыть артиста',
      icon: 'hide',
      action: () => { if (artist !== null) { marks.toggleArtist(artist, artistName); purgeQueue(); } },
      off: artist === null,
      danger: true,
    },
  ];

  return (
    <Sheet onClose={() => set(null)}>
      {(close) => {
        const run = (action: () => void) => () => close(action);
        return (
          <>
            <View style={styles.head}>
              {cover ? <Image source={{ uri: cover }} style={styles.cover} /> : <View style={[styles.cover, styles.noCover]}><Icon name="music" size={26} color={theme.muted} /></View>}
              <View style={styles.headText}>
                <Text style={styles.title} numberOfLines={2}>{track.title}</Text>
                <Text style={styles.artist} numberOfLines={1}>{artistName}</Text>
              </View>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} bounces={false}>
              <View style={styles.tiles}>
                {quick.filter((a) => !a.off).map((a) => <Tile key={a.label} item={a} onPress={run(a.action)} />)}
              </View>
              <View style={styles.group}>
                {list.filter((a) => !a.off).map((a) => <Row key={a.label} item={a} onPress={run(a.action)} />)}
              </View>
              <View style={styles.group}>
                {mute.filter((a) => !a.off).map((a) => <Row key={a.label} item={a} onPress={run(a.action)} />)}
              </View>
            </ScrollView>
          </>
        );
      }}
    </Sheet>
  );
}
const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 4, paddingBottom: 18 },
  cover: { width: 64, height: 64, borderRadius: 18, backgroundColor: theme.surfaceHigh },
  noCover: { alignItems: 'center', justifyContent: 'center' },
  headText: { flex: 1, gap: 3 },
  title: { color: theme.text, fontSize: 18, fontWeight: '800' },
  artist: { color: theme.muted, fontSize: 14 },
  tiles: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  tile: { flex: 1, alignItems: 'center', gap: 8, paddingVertical: 14, paddingHorizontal: 4, borderRadius: 22, backgroundColor: theme.surfaceHigh, overflow: 'hidden' },
  tileIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ffffff12' },
  tileIconOn: { backgroundColor: theme.accent },
  tileText: { color: theme.text, fontSize: 12, fontWeight: '600', textAlign: 'center', minHeight: 30 },
  group: { backgroundColor: theme.surfaceHigh, borderRadius: 24, marginBottom: 12, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 16, paddingHorizontal: 18 },
  rowText: { flex: 1, fontSize: 16, fontWeight: '600' },
});
