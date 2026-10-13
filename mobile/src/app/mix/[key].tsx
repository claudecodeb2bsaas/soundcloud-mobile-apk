import { useLocalSearchParams } from 'expo-router';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Loadable, RequireAuth } from '../../components/Loadable';
import { TrackRow } from '../../components/TrackRow';
import { texts } from '../../settings/texts';
import { usePlayerState } from '../../player/instance';
import { currentItem } from '../../player/queue';
import { theme } from '../../theme';
import { Button, ScreenHeader } from '../../ui/kit';
import { useLoad } from '../../ui/useLoad';
import { shelf, wave } from '../../wave/instance';
import { cardSub } from '../../wave/shelf';

const T = texts;

function Mix({ cardKey }: { cardKey: string }) {
  const playing = currentItem(usePlayerState().queue)?.track.id;
  const { data, error, reload } = useLoad(async () => {
    await shelf.load();
    const card = shelf.card(cardKey);
    if (!card) throw new Error('Подборка не найдена');
    return { card, tracks: await shelf.tracks(card) };
  }, [cardKey]);

  return (
    <Loadable ready={!!data} error={error} onRetry={reload}>
      <FlatList
        data={data?.tracks ?? []}
        keyExtractor={(track) => String(track.id)}
        ListHeaderComponent={
          data ? (
            <View style={styles.head}>
              <Text style={styles.name}>{data.card.title}</Text>
              <Text style={styles.muted}>{data.card.sub ? `${data.card.sub} · ` : ''}{cardSub({ ...data.card, sub: '' }, T)}</Text>
              <Button label="Слушать" icon="play" onPress={() => void wave.start(shelf.seed(data.card, data.tracks))} />
            </View>
          ) : null
        }
        ListEmptyComponent={<Text style={[styles.muted, styles.pad]}>{T.mixEmpty}</Text>}
        renderItem={({ item }) => (
          <TrackRow track={item} playing={item.id === playing} onPress={() => data && void wave.start(shelf.seed(data.card, data.tracks, item.id))} />
        )}
      />
    </Loadable>
  );
}

export default function MixScreen() {
  const params = useLocalSearchParams<{ key: string }>();
  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScreenHeader title="" />
      <RequireAuth>
        <Mix cardKey={String(params.key)} />
      </RequireAuth>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  head: { alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 14 },
  name: { color: theme.text, fontSize: 26, fontWeight: '800', textAlign: 'center' },
  muted: { color: theme.muted, fontSize: 13, textAlign: 'center' },
  pad: { padding: 24 },
});
