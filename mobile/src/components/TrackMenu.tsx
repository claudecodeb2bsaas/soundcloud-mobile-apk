import { router } from 'expo-router';
import { useSyncExternalStore } from 'react';
import { Alert, Modal, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { auth, useAuth } from '../auth/instance';
import { fillText } from '../core/waveTexts';
import { texts } from '../settings/texts';
import type { WaveTrack } from '../core/waveTypes';
import { artistIdOf } from '../player/format';
import { player } from '../player/instance';
import { currentItem } from '../player/queue';
import { theme } from '../theme';
import { saveArtwork } from '../ui/saveArtwork';
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
    Alert.alert('Не удалось найти похожие треки');
  }
}

export async function toggleLike(track: WaveTrack): Promise<void> {
  try {
    if (await likes.toggle(track.id)) noteLiked(track);
  } catch (error) {
    const status = (error as { status?: number } | null)?.status;
    Alert.alert(status === 401 || status === 403 ? 'Вход устарел, войди снова' : 'Не удалось изменить лайк');
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

export function TrackMenuHost() {
  const track = useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => target, () => target);
  const insets = useSafeAreaInsets();
  const signedIn = useAuth().status === 'in';
  const liked = useLikes();
  const data = useMarks();
  const picked = usePicks();
  if (!track) return null;

  const artist = artistIdOf(track);
  const artistName = track.user?.username ?? '';
  const disliked = track.id in data.tracks;
  const hidden = artist !== null && artist in data.artists;
  const run = (action: () => void) => () => { set(null); action(); };
  const actions: Array<{ label: string; action: () => void; off?: boolean }> = [
    { label: liked.has(track.id) ? 'Убрать из лайков' : 'В лайки', action: () => void toggleLike(track), off: !signedIn },
    { label: 'Волна от трека', action: () => void wave.start({ kind: 'track', track }), off: !signedIn },
    { label: 'Волна от артиста', action: () => void wave.start({ kind: 'artist', id: artist ?? 0, name: artistName }), off: !signedIn || artist === null },
    {
      label: picked.some((item) => item.id === track.id) ? texts.menuUnpick : texts.menuPick,
      action: () => { if (picks.toggle(track) === 'full') Alert.alert(fillText(texts.toastPickFull, { count: String(picked.length) })); },
      off: !signedIn,
    },
    { label: 'Играть следом', action: () => player.insertNext(track) },
    { label: 'В конец очереди', action: () => player.insertLast(track) },
    { label: 'Играть похожее', action: () => void playSimilar(track) },
    { label: 'К артисту', action: () => router.push(`/artist/${artist}`), off: artist === null },
    { label: 'Поделиться', action: () => void Share.share({ message: track.permalink_url ?? '' }), off: !track.permalink_url },
    { label: 'Скачать обложку', action: () => void saveArtwork(track.artwork_url), off: !track.artwork_url },
    { label: 'Скачать аватар артиста', action: () => void saveArtwork(track.user?.avatar_url), off: !track.user?.avatar_url },
    { label: disliked ? 'Вернуть в подбор' : 'Не нравится', action: () => { marks.toggleTrack(track); purgeQueue(); } },
    {
      label: hidden ? 'Показывать артиста' : 'Скрыть артиста',
      action: () => { if (artist !== null) { marks.toggleArtist(artist, artistName); purgeQueue(); } },
      off: artist === null,
    },
  ];

  return (
    <Modal transparent visible animationType="fade" onRequestClose={() => set(null)} statusBarTranslucent navigationBarTranslucent>
      <Pressable style={styles.backdrop} onPress={() => set(null)} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 8 }]}>
        <Text style={styles.title} numberOfLines={1}>{track.title}</Text>
        <Text style={styles.artist} numberOfLines={1}>{artistName}</Text>
        <ScrollView>
          {actions.filter((a) => !a.off).map((a) => (
            <Pressable key={a.label} style={styles.item} onPress={run(a.action)}>
              <Text style={styles.itemText}>{a.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#00000099' },
  sheet: { backgroundColor: theme.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingTop: 16, maxHeight: '85%' },
  title: { color: theme.text, fontSize: 16, fontWeight: '600', paddingHorizontal: 20 },
  artist: { color: theme.muted, fontSize: 13, paddingHorizontal: 20, paddingBottom: 8 },
  item: { paddingVertical: 13, paddingHorizontal: 20 },
  itemText: { color: theme.text, fontSize: 16 },
});
