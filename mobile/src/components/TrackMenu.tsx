import { router } from 'expo-router';
import { useSyncExternalStore } from 'react';
import { Alert, Modal, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { auth } from '../auth/instance';
import type { WaveTrack } from '../core/waveTypes';
import { artistIdOf } from '../player/format';
import { player } from '../player/instance';
import { theme } from '../theme';

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

export function TrackMenuHost() {
  const track = useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => target, () => target);
  const insets = useSafeAreaInsets();
  if (!track) return null;

  const artist = artistIdOf(track);
  const run = (action: () => void) => () => { set(null); action(); };
  const actions: Array<{ label: string; action: () => void; off?: boolean }> = [
    { label: 'Играть следом', action: () => player.insertNext(track) },
    { label: 'В конец очереди', action: () => player.insertLast(track) },
    { label: 'Играть похожее', action: () => void playSimilar(track) },
    { label: 'К артисту', action: () => router.push(`/artist/${artist}`), off: artist === null },
    { label: 'Поделиться', action: () => void Share.share({ message: track.permalink_url ?? '' }), off: !track.permalink_url },
  ];

  return (
    <Modal transparent visible animationType="fade" onRequestClose={() => set(null)} statusBarTranslucent navigationBarTranslucent>
      <Pressable style={styles.backdrop} onPress={() => set(null)} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 8 }]}>
        <Text style={styles.title} numberOfLines={1}>{track.title}</Text>
        <Text style={styles.artist} numberOfLines={1}>{track.user?.username ?? ''}</Text>
        {actions.filter((a) => !a.off).map((a) => (
          <Pressable key={a.label} style={styles.item} onPress={run(a.action)}>
            <Text style={styles.itemText}>{a.label}</Text>
          </Pressable>
        ))}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#00000099' },
  sheet: { backgroundColor: theme.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingTop: 16 },
  title: { color: theme.text, fontSize: 16, fontWeight: '600', paddingHorizontal: 20 },
  artist: { color: theme.muted, fontSize: 13, paddingHorizontal: 20, paddingBottom: 8 },
  item: { paddingVertical: 14, paddingHorizontal: 20 },
  itemText: { color: theme.text, fontSize: 16 },
});
