import { router } from 'expo-router';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ProgressBar } from '../components/ProgressBar';
import { openTrackMenu } from '../components/TrackMenu';
import { DislikeButton, LikeButton } from '../components/TrackReactions';
import { artwork, errorText } from '../player/format';
import { player, usePlayerState, useProgress } from '../player/instance';
import { currentItem } from '../player/queue';
import { theme } from '../theme';

const REPEAT_LABEL = { off: 'Повтор выкл', all: 'Повтор всех', one: 'Повтор трека' } as const;

export default function Player() {
  const state = usePlayerState();
  const { position } = useProgress();
  const item = currentItem(state.queue);
  const cover = artwork(item?.track.artwork_url, 't500x500');
  const busy = state.status === 'loading';

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.bar}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.link}>Закрыть</Text>
        </Pressable>
        <Pressable onPress={() => router.push('/queue')} hitSlop={12}>
          <Text style={styles.link}>Очередь · {state.queue.items.length}</Text>
        </Pressable>
      </View>

      {!item ? (
        <View style={styles.empty}>
          <Text style={styles.muted}>Ничего не играет</Text>
        </View>
      ) : (
        <View style={styles.body}>
          {cover ? <Image source={{ uri: cover }} style={styles.cover} /> : <View style={styles.cover} />}
          <View style={styles.info}>
            <Text style={styles.title} numberOfLines={2}>
              {item.track.title}
            </Text>
            <Text style={styles.artist} numberOfLines={1}>
              {item.track.user?.username ?? ''}
            </Text>
            {item.reason ? <Text style={styles.muted}>{item.reason}</Text> : null}
            {state.preview ? <Text style={styles.warn}>Отрывок 30 секунд: полный трек только по подписке</Text> : null}
            {state.status === 'error' ? <Text style={styles.warn}>{errorText(state.error)}</Text> : null}
          </View>

          <ProgressBar times onSeek={(seconds) => player.seek(seconds)} />

          <View style={styles.controls}>
            <DislikeButton track={item.track} size={32} />
            <Pressable onPress={() => player.previous()} hitSlop={10} accessibilityLabel="Предыдущий трек">
              <Text style={styles.skip}>◀◀</Text>
            </Pressable>
            <Pressable style={styles.play} onPress={() => player.toggle()} accessibilityLabel={state.status === 'playing' ? 'Пауза' : 'Играть'}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.playGlyph}>{state.status === 'playing' ? '❚❚' : '▶'}</Text>}
            </Pressable>
            <Pressable onPress={() => player.next()} hitSlop={10} accessibilityLabel="Следующий трек">
              <Text style={styles.skip}>▶▶</Text>
            </Pressable>
            <LikeButton track={item.track} size={32} />
          </View>

          <View style={styles.controls}>
            <Pressable onPress={() => player.cycleRepeat()} hitSlop={10} accessibilityLabel={REPEAT_LABEL[state.queue.repeat]}>
              <Text style={[styles.small, state.queue.repeat !== 'off' && styles.on]}>
                {state.queue.repeat === 'one' ? '↻1' : '↻'}
              </Text>
            </Pressable>
            <Pressable onPress={() => player.seek(position - 15)} hitSlop={10} accessibilityLabel="Назад на 15 секунд">
              <Text style={styles.small}>-15</Text>
            </Pressable>
            <Pressable onPress={() => player.seek(position + 15)} hitSlop={10} accessibilityLabel="Вперёд на 15 секунд">
              <Text style={styles.small}>+15</Text>
            </Pressable>
            <Pressable onPress={() => openTrackMenu(item.track)} hitSlop={10} accessibilityLabel="Меню трека">
              <Text style={styles.small}>⋯</Text>
            </Pressable>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  bar: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  link: { color: theme.accent, fontSize: 15 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, paddingHorizontal: 24, justifyContent: 'space-around', paddingBottom: 24 },
  cover: { width: '100%', aspectRatio: 1, maxHeight: 340, alignSelf: 'center', borderRadius: 8, backgroundColor: theme.surface },
  info: { gap: 4 },
  actions: { flexDirection: 'row', gap: 24, marginTop: 8 },
  heart: { color: theme.muted, fontSize: 26 },
  title: { color: theme.text, fontSize: 22, fontWeight: '700' },
  artist: { color: theme.muted, fontSize: 16 },
  muted: { color: theme.muted, fontSize: 13 },
  warn: { color: '#ffb454', fontSize: 13, marginTop: 4 },
  times: { flexDirection: 'row', justifyContent: 'space-between' },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  small: { color: theme.muted, fontSize: 18, width: 44, textAlign: 'center' },
  on: { color: theme.accent },
  skip: { color: theme.text, fontSize: 22 },
  play: { width: 68, height: 68, borderRadius: 34, backgroundColor: theme.accent, alignItems: 'center', justifyContent: 'center' },
  playGlyph: { color: '#fff', fontSize: 24 },
});
