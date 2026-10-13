import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Pressable, StyleSheet } from 'react-native';
import { useAuth } from '../auth/instance';
import type { WaveTrack } from '../core/waveTypes';
import { theme } from '../theme';
import { Icon } from '../ui/Icon';
import { useLikes, useMarks } from '../wave/instance';
import { toggleDislike, toggleLike } from './TrackMenu';

/** Нажатие подпрыгивает один раз, когда значок включился */
function useBounce(on: boolean): Animated.Value {
  const scale = useRef(new Animated.Value(1)).current;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (on) Animated.sequence([Animated.timing(scale, { toValue: 1.3, duration: 110, useNativeDriver: true }), Animated.spring(scale, { toValue: 1, friction: 4, useNativeDriver: true })]).start();
  }, [on, scale]);
  return scale;
}

interface Props {
  track: WaveTrack;
  size?: number;
  /** Круглая подложка вокруг значка (диаметр рассчитывается от size) */
  round?: boolean;
}

function Frame({ size, round, scale, onPress, label, children }: { size: number; round?: boolean; scale: Animated.Value; onPress: () => void; label: string; children: ReactNode }) {
  const box = round ? Math.round(size * 2.2) : size + 12;
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      android_ripple={{ color: '#ffffff22', borderless: true, radius: box / 2 }}
      style={{
        width: box,
        height: box,
        borderRadius: box / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: round ? '#ffffff14' : undefined,
        borderWidth: round ? StyleSheet.hairlineWidth : 0,
        borderColor: '#ffffff22',
      }}
    >
      <Animated.View style={{ transform: [{ scale }] }}>{children}</Animated.View>
    </Pressable>
  );
}

/** Сердце: лайк на SoundCloud и в модели вкуса. Без входа в аккаунт не показывается */
export function LikeButton({ track, size = 24, round }: Props) {
  const liked = useLikes().has(track.id);
  const signedIn = useAuth().status === 'in';
  const scale = useBounce(liked);
  if (!signedIn) return null;
  return (
    <Frame size={size} round={round} scale={scale} onPress={() => void toggleLike(track)} label={liked ? 'Убрать из лайков' : 'Лайк'}>
      <Icon name={liked ? 'heart' : 'heartOutline'} size={size} color={liked ? theme.accent : round ? theme.text : theme.muted} />
    </Frame>
  );
}

/** «Не нравится»: локальная отметка, трек уходит из очереди, вкус и волна это учитывают */
export function DislikeButton({ track, size = 24, round }: Props) {
  const on = track.id in useMarks().tracks;
  const scale = useBounce(on);
  return (
    <Frame size={size} round={round} scale={scale} onPress={() => toggleDislike(track)} label={on ? 'Вернуть в подбор' : 'Не нравится'}>
      <Icon name={on ? 'dislike' : 'dislikeOutline'} size={size} color={on ? theme.warn : round ? theme.text : theme.muted} />
    </Frame>
  );
}
