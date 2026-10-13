import { useId, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import type { WaveMood } from '../core/waveMood';
import { artwork } from '../player/format';
import { player, usePlayerState } from '../player/instance';
import { currentItem } from '../player/queue';
import { texts } from '../settings/texts';
import { MOOD_COLORS, theme } from '../theme';
import { Icon, type IconName } from '../ui/Icon';
import { Button, IconButton } from '../ui/kit';
import { Sheet } from '../ui/Sheet';
import { WaveBlob } from '../ui/WaveBlob';
import { wave, useWave } from '../wave/instance';
import { DislikeButton, LikeButton } from './TrackReactions';

const T = texts;

// «Поток» это волна без настроения; у каждого настроения свои цвета шара
export const PRESETS: Array<{ id: WaveMood | ''; label: string }> = [
  { id: '', label: 'Поток' },
  { id: 'happy', label: T.moodHappy },
  { id: 'sad', label: T.moodSad },
  { id: 'aggressive', label: T.moodAggressive },
  { id: 'calm', label: T.moodCalm },
  { id: 'energetic', label: T.moodEnergetic },
];

const MODES: Array<{ id: 'similar' | 'fresh'; label: string; icon: IconName; hint: string }> = [
  { id: 'similar', label: 'Похожее', icon: 'heart', hint: 'Музыка, похожая на твою историю и лайки' },
  { id: 'fresh', label: 'Новое', icon: 'sparkle', hint: 'Ещё не слышанное и не лайкнутое, больше новых артистов' },
];

const MESSAGES = {
  empty: 'Подобрать нечего: послушай или лайкни что-нибудь, либо смени жанр',
  error: 'Не удалось подобрать треки. Проверь соединение и попробуй ещё раз.',
} as const;

/** Круглый цветной образец настроения, как кружки «Под настроение» в Яндекс Музыке */
export function Swatch({ mood, size = 56, on }: { mood: WaveMood | ''; size?: number; on?: boolean }) {
  const id = useId().replace(/\W/g, '');
  const [a, b, c] = MOOD_COLORS[mood];
  return (
    <View style={{ width: size + 8, height: size + 8, borderRadius: (size + 8) / 2, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: on ? '#fff' : 'transparent' }}>
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Defs>
          <RadialGradient id={`${id}a`} cx="35" cy="30" r="85" gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor={c} />
            <Stop offset="0.45" stopColor={b} />
            <Stop offset="1" stopColor={a} />
          </RadialGradient>
        </Defs>
        <Circle cx="50" cy="50" r="50" fill={`url(#${id}a)`} />
      </Svg>
    </View>
  );
}

function Label({ text }: { text: string }) {
  return <Text style={styles.label}>{text}</Text>;
}

/** Шторка «Настроить волну»: режим, жанр и настроение */
export function WaveSettings({ onClose }: { onClose: () => void }) {
  const state = useWave();
  const [genre, setGenre] = useState(state.genre);
  const hint = MODES.find((mode) => mode.id === state.mode)?.hint;
  const apply = () => {
    if (genre.trim() !== state.genre) wave.configure({ genre: genre.trim() });
  };

  return (
    <Sheet onClose={() => { apply(); onClose(); }}>
      {(close) => (
        <>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>Настроить волну</Text>
            <IconButton icon="close" size={38} bg={theme.surfaceHigh} label="Закрыть" onPress={() => close()} />
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Label text="По характеру" />
            <View style={styles.modes}>
              {MODES.map((mode) => {
                const on = state.mode === mode.id;
                return (
                  <Pressable key={mode.id} style={[styles.mode, on && styles.modeOn]} onPress={() => wave.configure({ mode: mode.id })} accessibilityRole="button" accessibilityState={{ selected: on }}>
                    <Icon name={mode.icon} size={26} color={on ? '#fff' : theme.accent} />
                    <Text style={[styles.modeText, on && styles.modeTextOn]}>{mode.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.muted}>{hint}</Text>

            <Label text="Жанр" />
            <TextInput
              style={styles.input}
              value={genre}
              onChangeText={setGenre}
              onSubmitEditing={() => close()}
              placeholder="Любой. Например: techno, фонк"
              placeholderTextColor={theme.muted}
              returnKeyType="done"
              autoCorrect={false}
            />
            <Text style={styles.muted}>Несколько жанров через запятую. Идущая волна начнётся заново.</Text>

            <Label text="По настроению" />
            <View style={styles.swatches}>
              {PRESETS.map((preset) => (
                <Pressable key={preset.id || 'any'} style={styles.swatch} onPress={() => wave.configure({ preset: preset.id })} accessibilityRole="button" accessibilityLabel={preset.label}>
                  <Swatch mood={preset.id} on={state.preset === preset.id} />
                  <Text style={[styles.swatchText, state.preset === preset.id && styles.swatchTextOn]}>{preset.label}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.muted}>Только для обычной волны: у волны от трека, артиста и «Моей музыки» своё настроение.</Text>
          </ScrollView>
          <View style={styles.done}>
            <Button label="Готово" onPress={() => close()} />
          </View>
        </>
      )}
    </Sheet>
  );
}

function OrbButton({ icon, label, onPress, size = 56 }: { icon: IconName; label: string; onPress: () => void; size?: number }) {
  return (
    <IconButton icon={icon} size={size} iconSize={Math.round(size * 0.46)} bg="#ffffff1f" label={label} onPress={onPress} style={styles.orb} />
  );
}

/** Шар «Моя волна»: нажатие включает волну или ставит на паузу, долгое нажатие останавливает; под шаром кнопка «Настроить» */
export function WaveHero({ size = 320, ring }: { size?: number; ring?: boolean }) {
  const state = useWave();
  const playerState = usePlayerState();
  const [open, setOpen] = useState(false);
  const running = state.status === 'running';
  const loading = state.status === 'loading';
  const playing = running && playerState.status === 'playing';
  const mood = state.preset;
  const label = PRESETS.find((preset) => preset.id === mood)?.label ?? PRESETS[0].label;
  const skip = ring && running;

  return (
    <View style={styles.hero}>
      <View style={{ width: size, height: size }}>
        <Pressable
          onPress={() => (running ? player.toggle() : void wave.start())}
          onLongPress={() => running && wave.stop()}
          style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
          accessibilityRole="button"
          accessibilityLabel={running ? (playing ? 'Пауза' : 'Продолжить волну') : 'Включить волну'}
        >
          <View style={StyleSheet.absoluteFill}>
            <WaveBlob colors={MOOD_COLORS[mood]} size={size} active={playing} />
          </View>
          <View style={styles.titleRow}>
            {loading ? <ActivityIndicator color="#fff" /> : <Icon name={playing ? 'pause' : 'play'} size={30} color="#fff" />}
            <Text style={styles.title}>Моя волна</Text>
          </View>
        </Pressable>
        {skip ? (
          <>
            <View style={[styles.ringBtn, { left: 4, top: size / 2 - 28 }]}>
              <OrbButton icon="prev" label="Предыдущий трек" onPress={() => player.previous()} />
            </View>
            <View style={[styles.ringBtn, { right: 4, top: size / 2 - 28 }]}>
              <OrbButton icon="next" label="Следующий трек" onPress={() => player.next()} />
            </View>
          </>
        ) : null}
      </View>

      <View style={styles.pills}>
        <Pressable style={styles.pill} onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel="Настроить волну">
          <Icon name="tune" size={18} color="#fff" />
          <Text style={styles.pillText} numberOfLines={1}>{state.genre ? state.genre : 'Настроить'}</Text>
        </Pressable>
        {mood ? (
          <View style={styles.pill}>
            <Swatch mood={mood} size={14} />
            <Text style={styles.pillText}>{label}</Text>
          </View>
        ) : null}
      </View>
      {state.status === 'empty' || state.status === 'error' ? <Text style={styles.warn}>{MESSAGES[state.status]}</Text> : null}
      {open ? <WaveSettings onClose={() => setOpen(false)} /> : null}
    </View>
  );
}

/** Карточка играющего трека волны и круглые кнопки: не нравится, назад, пауза, вперёд, лайк */
export function WaveControls({ ring }: { ring?: boolean }) {
  const state = useWave();
  const playerState = usePlayerState();
  const item = state.status === 'running' ? currentItem(playerState.queue) : undefined;
  if (!item) return null;
  const cover = artwork(item.track.artwork_url);
  const busy = playerState.status === 'loading';
  const playing = playerState.status === 'playing';

  return (
    <View style={styles.controls}>
      <View style={styles.now}>
        {cover ? <Image source={{ uri: cover }} style={styles.cover} /> : <View style={[styles.cover, styles.noCover]}><Icon name="music" size={22} color={theme.muted} /></View>}
        <View style={styles.nowText}>
          <Text style={styles.nowTitle} numberOfLines={1}>{item.track.title}</Text>
          <Text style={styles.nowArtist} numberOfLines={1}>{item.track.user?.username ?? ''}</Text>
          {item.reason ? <Text style={styles.reason} numberOfLines={1}>{item.reason}</Text> : null}
        </View>
        <DislikeButton track={item.track} size={20} round />
        <LikeButton track={item.track} size={20} round />
      </View>
      {ring ? null : (
        <View style={styles.buttons}>
          <OrbButton icon="prev" label="Предыдущий трек" onPress={() => player.previous()} />
          <Pressable
            style={styles.play}
            onPress={() => player.toggle()}
            accessibilityRole="button"
            accessibilityLabel={playing ? 'Пауза' : 'Играть'}
            android_ripple={{ color: '#ffffff44', borderless: true, radius: 38 }}
          >
            {busy ? <ActivityIndicator color="#fff" /> : <Icon name={playing ? 'pause' : 'play'} size={36} color="#fff" />}
          </Pressable>
          <OrbButton icon="next" label="Следующий трек" onPress={() => player.next()} />
        </View>
      )}
      <Pressable onPress={() => wave.stop()} hitSlop={10} style={styles.stop} accessibilityRole="button">
        <Text style={styles.stopText}>Остановить волну</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { color: '#fff', fontSize: 32, fontWeight: '800', letterSpacing: -0.5, textShadowColor: '#00000066', textShadowRadius: 12, textShadowOffset: { width: 0, height: 2 } },
  ringBtn: { position: 'absolute' },
  orb: { borderWidth: StyleSheet.hairlineWidth, borderColor: '#ffffff2e' },
  pills: { flexDirection: 'row', gap: 10, marginTop: -6, alignItems: 'center' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#ffffff1f', borderRadius: 22, paddingVertical: 11, paddingHorizontal: 18, maxWidth: 220 },
  pillText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  warn: { color: theme.warn, fontSize: 14, textAlign: 'center', paddingHorizontal: 32, marginTop: 14 },
  controls: { marginHorizontal: 16, marginTop: 22, backgroundColor: theme.surface, borderRadius: 28, padding: 16, gap: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border },
  now: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  cover: { width: 64, height: 64, borderRadius: 16, backgroundColor: theme.surfaceHigh },
  noCover: { alignItems: 'center', justifyContent: 'center' },
  nowText: { flex: 1, gap: 2 },
  nowTitle: { color: theme.text, fontSize: 17, fontWeight: '800' },
  nowArtist: { color: theme.muted, fontSize: 14 },
  reason: { color: theme.accentBright, fontSize: 12, marginTop: 2 },
  buttons: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 22 },
  play: { width: 76, height: 76, borderRadius: 38, backgroundColor: theme.accent, alignItems: 'center', justifyContent: 'center', elevation: 6 },
  stop: { alignSelf: 'center' },
  stopText: { color: theme.muted, fontSize: 13, fontWeight: '600' },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 4 },
  sheetTitle: { color: theme.text, fontSize: 20, fontWeight: '800' },
  label: { color: theme.muted, fontSize: 13, fontWeight: '600', marginTop: 18, marginBottom: 10 },
  modes: { flexDirection: 'row', gap: 10 },
  mode: { flex: 1, alignItems: 'center', gap: 8, paddingVertical: 16, borderRadius: 20, backgroundColor: theme.surfaceHigh },
  modeOn: { backgroundColor: theme.accent },
  modeText: { color: theme.text, fontSize: 15, fontWeight: '700' },
  modeTextOn: { color: '#fff' },
  muted: { color: theme.muted, fontSize: 13, lineHeight: 18, marginTop: 8 },
  input: { backgroundColor: theme.surfaceHigh, color: theme.text, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 12, fontSize: 16 },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  swatch: { width: '31%', alignItems: 'center', gap: 6, paddingVertical: 6 },
  swatchText: { color: theme.muted, fontSize: 13, fontWeight: '600' },
  swatchTextOn: { color: theme.text },
  done: { paddingTop: 14 },
});
