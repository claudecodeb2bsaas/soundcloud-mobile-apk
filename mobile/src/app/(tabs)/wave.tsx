import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { RequireAuth } from '../../components/Loadable';
import { MyMusic } from '../../components/MyMusic';
import type { WaveMood } from '../../core/waveMood';
import { usePlayerState } from '../../player/instance';
import { currentItem } from '../../player/queue';
import { texts } from '../../settings/texts';
import { theme } from '../../theme';
import { wave, useWave } from '../../wave/instance';

const MODES = [
  { id: 'similar', label: 'Похожее', hint: 'Музыка, похожая на твою историю и лайки' },
  { id: 'fresh', label: 'Новое', hint: 'Ещё не слышанное и не лайкнутое, больше новых артистов' },
] as const;

const T = texts;
// «Поток» — волна без настроения; у каждого настроения свои два цвета шара
const PRESETS: Array<{ id: WaveMood | ''; label: string; colors: [string, string] }> = [
  { id: '', label: 'Поток', colors: ['#ff5500', '#7b2ff7'] },
  { id: 'happy', label: T.moodHappy, colors: ['#ffd400', '#3ddc84'] },
  { id: 'sad', label: T.moodSad, colors: ['#3a6df0', '#6a3df0'] },
  { id: 'aggressive', label: T.moodAggressive, colors: ['#ff2a2a', '#7a0020'] },
  { id: 'calm', label: T.moodCalm, colors: ['#18c9c0', '#2b7fff'] },
  { id: 'energetic', label: T.moodEnergetic, colors: ['#ff8a00', '#ff2d8f'] },
];

const MESSAGES = {
  empty: 'Подобрать нечего: послушай или лайкни что-нибудь, либо смени жанр',
  error: 'Не удалось подобрать треки. Проверь соединение и попробуй ещё раз.',
} as const;

const SIZE = 300;

/** Шар волны: слои с мягким свечением, дышит всегда, пульсирует быстрее, пока играет; нажатие включает и выключает волну */
function Orb({ colors, playing, loading, running, onPress }: { colors: [string, string]; playing: boolean; loading: boolean; running: boolean; onPress: () => void }) {
  const pulse = useRef(new Animated.Value(0)).current;
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: playing ? 700 : 2400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: playing ? 700 : 2400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, playing]);

  useEffect(() => {
    const loop = Animated.loop(Animated.timing(spin, { toValue: 1, duration: running ? 9000 : 24000, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [spin, running]);

  const swing = playing ? 0.14 : 0.05;
  const scale = (amount: number) => pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1 + amount] });
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const [a, b] = colors;

  return (
    <Pressable onPress={onPress} style={styles.orbBox} accessibilityRole="button" accessibilityLabel={running ? 'Остановить волну' : 'Включить волну'}>
      <Animated.View style={[styles.layer, { width: SIZE, height: SIZE, borderRadius: SIZE / 2, backgroundColor: a + '22', transform: [{ scale: scale(swing * 1.6) }] }]} />
      <Animated.View style={[styles.layer, { width: 250, height: 250, borderRadius: 125, backgroundColor: b + '44', transform: [{ scale: scale(swing * 1.2) }] }]} />
      <Animated.View style={[styles.layer, styles.core, { backgroundColor: a, transform: [{ scale: scale(swing * 0.6) }] }]}>
        <Animated.View style={[styles.swirl, { transform: [{ rotate }] }]}>
          <View style={[styles.blob, { width: 150, height: 150, borderRadius: 75, left: 70, top: 60, backgroundColor: b }]} />
          <View style={[styles.blob, { width: 90, height: 90, borderRadius: 45, left: 10, top: 14, backgroundColor: '#ffffff55' }]} />
        </Animated.View>
        <View style={styles.center}>
          {loading ? <ActivityIndicator color="#fff" size="large" /> : <Text style={styles.glyph}>{running ? '❚❚' : '▶'}</Text>}
        </View>
      </Animated.View>
    </Pressable>
  );
}

function Chip({ label, on, onPress }: { label: string; on?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, on && styles.chipOn]}>
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

/** Шторка настроек: режим, жанр и настроение; главный экран остаётся без текстов и полей */
function Settings({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const state = useWave();
  const insets = useSafeAreaInsets();
  const [genre, setGenre] = useState(state.genre);
  const hint = MODES.find((mode) => mode.id === state.mode)?.hint;
  const close = () => {
    if (genre.trim() !== state.genre) wave.configure({ genre: genre.trim() });
    onClose();
  };

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={close} statusBarTranslucent navigationBarTranslucent>
      <KeyboardAvoidingView style={styles.fill} behavior="padding">
        <Pressable style={styles.backdrop} onPress={close} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.handle} />
          <Text style={styles.sheetTitle}>Настроить волну</Text>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={styles.label}>Режим</Text>
            <View style={styles.wrap}>
              {MODES.map((mode) => (
                <Chip key={mode.id} label={mode.label} on={state.mode === mode.id} onPress={() => wave.configure({ mode: mode.id })} />
              ))}
            </View>
            <Text style={styles.muted}>{hint}</Text>

            <Text style={styles.label}>Жанр</Text>
            <TextInput
              style={styles.input}
              value={genre}
              onChangeText={setGenre}
              onSubmitEditing={close}
              placeholder="Любой. Например: techno, фонк"
              placeholderTextColor={theme.muted}
              returnKeyType="done"
              autoCorrect={false}
            />
            <Text style={styles.muted}>Несколько жанров через запятую. Идущая волна начнётся заново.</Text>

            <Text style={styles.label}>Настроение</Text>
            <View style={styles.wrap}>
              {PRESETS.map((preset) => (
                <Chip key={preset.id || 'any'} label={preset.label} on={state.preset === preset.id} onPress={() => wave.configure({ preset: preset.id })} />
              ))}
            </View>
            <Text style={styles.muted}>Только для обычной волны: у волны от трека, артиста и «Моей музыки» своё настроение.</Text>
          </ScrollView>
          <Pressable style={styles.done} onPress={close}>
            <Text style={styles.doneText}>Готово</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function WaveScreen() {
  const state = useWave();
  const player = usePlayerState();
  const [open, setOpen] = useState(false);
  const running = state.status === 'running';
  const loading = state.status === 'loading';
  const playing = running && player.status === 'playing';
  const current = PRESETS.find((preset) => preset.id === state.preset) ?? PRESETS[0];
  const track = running ? currentItem(player.queue)?.track : undefined;
  const sub = track
    ? [track.user?.username, track.title].filter(Boolean).join(' — ')
    : state.seedLabel
      ? `Волна от «${state.seedLabel}»`
      : running
        ? 'Волна играет'
        : 'Нажми на шар, чтобы включить волну';

  return (
    <>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Orb colors={current.colors} playing={playing} loading={loading} running={running} onPress={() => (running ? wave.stop() : void wave.start())} />
        <Text style={styles.mode}>{current.label}</Text>
        <Text style={styles.sub} numberOfLines={2}>{sub}</Text>
        {state.status === 'empty' || state.status === 'error' ? <Text style={styles.warn}>{MESSAGES[state.status]}</Text> : null}

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} style={styles.chipsRow}>
          <Chip label={state.genre ? `⚙ ${state.genre}` : '⚙ Настроить'} onPress={() => setOpen(true)} />
          {PRESETS.map((preset) => (
            <Chip key={preset.id || 'any'} label={preset.label} on={state.preset === preset.id} onPress={() => wave.configure({ preset: preset.id })} />
          ))}
        </ScrollView>

        <Pressable onPress={() => router.push('/taste')}>
          <Text style={styles.link}>Мой вкус: что волна ставит чаще, убрать из вкуса</Text>
        </Pressable>

        <MyMusic />
      </ScrollView>
      {open ? <Settings visible onClose={() => setOpen(false)} /> : null}
    </>
  );
}

export default function WaveTab() {
  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <RequireAuth>
        <WaveScreen />
      </RequireAuth>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  fill: { flex: 1 },
  content: { paddingBottom: 24, gap: 10 },
  orbBox: { height: SIZE + 40, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  layer: { position: 'absolute' },
  core: { width: 180, height: 180, borderRadius: 90, overflow: 'hidden' },
  swirl: { position: 'absolute', width: 180, height: 180 },
  blob: { position: 'absolute' },
  center: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  glyph: { color: '#fff', fontSize: 34 },
  mode: { color: theme.text, fontSize: 34, fontWeight: '800', textAlign: 'center' },
  sub: { color: theme.muted, fontSize: 14, textAlign: 'center', paddingHorizontal: 32 },
  warn: { color: '#ffb454', fontSize: 14, textAlign: 'center', paddingHorizontal: 24 },
  chipsRow: { flexGrow: 0, marginTop: 12 },
  chips: { paddingHorizontal: 16, gap: 8 },
  chip: { paddingVertical: 9, paddingHorizontal: 18, borderRadius: 20, backgroundColor: theme.surface },
  chipOn: { backgroundColor: theme.accent },
  chipText: { color: theme.muted, fontSize: 15 },
  chipTextOn: { color: '#fff', fontWeight: '600' },
  link: { color: theme.accent, fontSize: 14, marginTop: 8, paddingHorizontal: 16, textAlign: 'center' },
  backdrop: { flex: 1, backgroundColor: '#00000099' },
  sheet: { backgroundColor: theme.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 10, paddingHorizontal: 20, maxHeight: '85%' },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: '#ffffff33', marginBottom: 12 },
  sheetTitle: { color: theme.text, fontSize: 18, fontWeight: '700', marginBottom: 4 },
  label: { color: theme.text, fontSize: 15, fontWeight: '600', marginTop: 14, marginBottom: 8 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  muted: { color: theme.muted, fontSize: 13, marginTop: 6 },
  input: { backgroundColor: theme.bg, color: theme.text, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 16 },
  done: { backgroundColor: theme.accent, borderRadius: 24, paddingVertical: 14, alignItems: 'center', marginTop: 16 },
  doneText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
