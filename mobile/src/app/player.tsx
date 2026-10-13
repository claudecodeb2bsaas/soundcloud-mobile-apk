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
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/kit';

const REPEAT_LABEL = { off: 'Повтор выкл', all: 'Повтор всех', one: 'Повтор трека' } as const;

export default function Player() {
  const state = usePlayerState();
  const { position } = useProgress();
  const item = currentItem(state.queue);
  const cover = artwork(item?.track.artwork_url, 't500x500');
  const busy = state.status === 'loading';
  const playing = state.status === 'playing';
  const repeat = state.queue.repeat;

  return (
    <View style={styles.root}>
      {cover ? <Image source={{ uri: cover }} style={styles.backdrop} blurRadius={50} /> : null}
      <View style={styles.shade} />
      <SafeAreaView style={styles.safe}>
        <View style={styles.bar}>
          <IconButton icon="chevronDown" size={44} iconSize={28} label="Закрыть плеер" onPress={() => router.back()} />
          <View style={styles.barTitle}>
            <Text style={styles.barLabel}>СЕЙЧАС ИГРАЕТ</Text>
            {item?.reason ? <Text style={styles.barReason} numberOfLines={1}>{item.reason}</Text> : null}
          </View>
          <Pressable style={styles.queue} onPress={() => router.push('/queue')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Очередь">
            <Icon name="queue" size={22} color={theme.text} />
            <Text style={styles.queueCount}>{state.queue.items.length}</Text>
          </Pressable>
        </View>

        {!item ? (
          <View style={styles.empty}>
            <Icon name="music" size={48} color={theme.muted} />
            <Text style={styles.muted}>Ничего не играет</Text>
          </View>
        ) : (
          <View style={styles.body}>
            <View style={styles.coverBox}>
              {cover ? <Image source={{ uri: cover }} style={styles.cover} /> : <View style={[styles.cover, styles.noCover]}><Icon name="music" size={64} color={theme.muted} /></View>}
            </View>

            <View style={styles.info}>
              <Text style={styles.title} numberOfLines={2}>{item.track.title}</Text>
              <Text style={styles.artist} numberOfLines={1}>{item.track.user?.username ?? ''}</Text>
              {state.preview ? <Text style={styles.warn}>Отрывок 30 секунд: полный трек только по подписке</Text> : null}
              {state.status === 'error' ? <Text style={styles.warn}>{errorText(state.error)}</Text> : null}
            </View>

            <ProgressBar times onSeek={(seconds) => player.seek(seconds)} />

            <View style={styles.react}>
              <DislikeButton track={item.track} size={26} round />
              <LikeButton track={item.track} size={26} round />
            </View>

            <View style={styles.controls}>
              <IconButton icon="prev" size={64} iconSize={32} bg="#ffffff1a" label="Предыдущий трек" onPress={() => player.previous()} />
              <Pressable
                style={styles.play}
                onPress={() => player.toggle()}
                accessibilityRole="button"
                accessibilityLabel={playing ? 'Пауза' : 'Играть'}
                android_ripple={{ color: '#ffffff44', borderless: true, radius: 42 }}
              >
                {busy ? <ActivityIndicator color="#fff" size="large" /> : <Icon name={playing ? 'pause' : 'play'} size={40} color="#fff" />}
              </Pressable>
              <IconButton icon="next" size={64} iconSize={32} bg="#ffffff1a" label="Следующий трек" onPress={() => player.next()} />
            </View>

            <View style={styles.extras}>
              <IconButton
                icon={repeat === 'one' ? 'repeatOne' : 'repeat'}
                size={44}
                iconSize={24}
                color={repeat === 'off' ? theme.muted : theme.accent}
                label={REPEAT_LABEL[repeat]}
                onPress={() => player.cycleRepeat()}
              />
              <Pressable style={styles.seek} onPress={() => player.seek(position - 15)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Назад на 15 секунд">
                <Icon name="rewind" size={20} color={theme.muted} />
                <Text style={styles.seekText}>15</Text>
              </Pressable>
              <Pressable style={styles.seek} onPress={() => player.seek(position + 15)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Вперёд на 15 секунд">
                <Text style={styles.seekText}>15</Text>
                <Icon name="forward" size={20} color={theme.muted} />
              </Pressable>
              <IconButton icon="more" size={44} iconSize={26} color={theme.text} label="Меню трека" onPress={() => openTrackMenu(item.track)} />
            </View>
          </View>
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  backdrop: { ...StyleSheet.absoluteFill, opacity: 0.55 },
  shade: { ...StyleSheet.absoluteFill, backgroundColor: '#0b0b0dd0' },
  safe: { flex: 1 },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 8 },
  barTitle: { flex: 1, alignItems: 'center', gap: 2 },
  barLabel: { color: theme.muted, fontSize: 12, fontWeight: '600' },
  barReason: { color: theme.accentBright, fontSize: 12, fontWeight: '600' },
  queue: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 44, paddingHorizontal: 14, borderRadius: 22, backgroundColor: '#ffffff14' },
  queueCount: { color: theme.text, fontSize: 14, fontWeight: '700' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  body: { flex: 1, paddingHorizontal: 24, justifyContent: 'space-around', paddingBottom: 20 },
  coverBox: { alignItems: 'center', elevation: 18 },
  cover: { width: '100%', aspectRatio: 1, maxHeight: 340, borderRadius: 28, backgroundColor: theme.surface },
  noCover: { alignItems: 'center', justifyContent: 'center' },
  info: { gap: 4 },
  title: { color: theme.text, fontSize: 26, fontWeight: '800', letterSpacing: -0.4 },
  artist: { color: theme.muted, fontSize: 17, fontWeight: '500' },
  muted: { color: theme.muted, fontSize: 15 },
  warn: { color: theme.warn, fontSize: 13, marginTop: 4 },
  react: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 28 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 28 },
  play: { width: 84, height: 84, borderRadius: 42, backgroundColor: theme.accent, alignItems: 'center', justifyContent: 'center', elevation: 8 },
  extras: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  seek: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 44, paddingHorizontal: 12 },
  seekText: { color: theme.muted, fontSize: 14, fontWeight: '700' },
});
