import { router } from 'expo-router';
import { ActivityIndicator, FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { texts } from '../settings/texts';
import { artwork } from '../player/format';
import { theme } from '../theme';
import { useLoad } from '../ui/useLoad';
import { cardSub, type ShelfCard } from '../wave/shelf';
import { shelf } from '../wave/instance';

const T = texts;

type Tile = { key: string; title: string; sub: string; art: string[]; href: string; tone: string };

const TONES = { personal: '#4b2c7a', genre: '#0f6b6b', release: '#a33a00', plain: '#333333' } as const;
const toneOf = (card: ShelfCard): string => (card.kind === 'group' ? TONES.genre : TONES.personal);

/** Полка «Подборки»: плейлист момента, находки, «Лайкнули твои артисты», «Давно не слушал», жанры, а также радар и чарты */
export function MixShelf() {
  const { data, error, reload } = useLoad(() => shelf.load(), []);
  const tiles: Tile[] = [
    { key: 'radar', title: T.radar, sub: 'Новое у подписок', art: [], href: '/radar', tone: TONES.release },
    { key: 'charts', title: 'Чарты', sub: 'US и UK по жанрам', art: [], href: '/charts', tone: TONES.plain },
    ...(data ?? []).map((card): Tile => ({ key: card.key, title: card.title, sub: cardSub(card, T), art: card.art, href: `/mix/${encodeURIComponent(card.key)}`, tone: toneOf(card) })),
  ];

  return (
    <View style={styles.root}>
      <Text style={styles.heading}>{T.shelf}</Text>
      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={tiles}
        keyExtractor={(tile) => tile.key}
        contentContainerStyle={styles.list}
        ListFooterComponent={
          !data && !error ? <ActivityIndicator color={theme.accent} style={styles.wait} /> : error ? (
            <Pressable onPress={reload} style={styles.wait}>
              <Text style={styles.muted}>{T.shelfFailed}. Повторить</Text>
            </Pressable>
          ) : data && !data.length ? <Text style={[styles.muted, styles.wait]}>{T.shelfEmpty}</Text> : null
        }
        renderItem={({ item }) => (
          <Pressable style={styles.card} onPress={() => router.push(item.href as never)}>
            <View style={[styles.art, { backgroundColor: item.tone }]}>
              {item.art.length >= 4 ? (
                <View style={styles.quad}>
                  {item.art.slice(0, 4).map((url) => <Image key={url} source={{ uri: artwork(url) ?? url }} style={styles.cell} />)}
                </View>
              ) : item.art[0] ? <Image source={{ uri: artwork(item.art[0], 't500x500') ?? item.art[0] }} style={styles.single} /> : null}
              <View style={[styles.tint, { backgroundColor: item.tone }]} />
              <Text style={styles.face} numberOfLines={3}>{item.title}</Text>
            </View>
            <Text style={styles.title} numberOfLines={1}>{item.title}</Text>
            <Text style={styles.muted} numberOfLines={1}>{item.sub}</Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const SIZE = 140;
const styles = StyleSheet.create({
  root: { marginBottom: 20 },
  heading: { color: theme.text, fontSize: 20, fontWeight: '800', paddingHorizontal: 16, marginBottom: 12 },
  list: { paddingHorizontal: 16, gap: 14 },
  wait: { width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' },
  card: { width: SIZE, gap: 2 },
  art: { width: SIZE, height: SIZE, borderRadius: 18, overflow: 'hidden', marginBottom: 8, justifyContent: 'flex-end' },
  quad: { ...StyleSheet.absoluteFill, flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: SIZE / 2, height: SIZE / 2 },
  single: { ...StyleSheet.absoluteFill },
  // Коллаж обесцвечен тоном группы, как на desktop: название читается поверх любой обложки
  tint: { ...StyleSheet.absoluteFill, opacity: 0.72 },
  face: { color: '#fff', fontSize: 16, fontWeight: '800', padding: 10 },
  title: { color: theme.text, fontSize: 14, fontWeight: '600' },
  muted: { color: theme.muted, fontSize: 12 },
});
