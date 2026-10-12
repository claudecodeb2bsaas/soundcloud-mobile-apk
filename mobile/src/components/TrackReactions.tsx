import { Pressable, Text } from 'react-native';
import { useAuth } from '../auth/instance';
import type { WaveTrack } from '../core/waveTypes';
import { theme } from '../theme';
import { useLikes, useMarks } from '../wave/instance';
import { toggleDislike, toggleLike } from './TrackMenu';

/** Сердечко: лайк на SoundCloud и в модели вкуса. Без входа в аккаунт не показывается */
export function LikeButton({ track, size = 22 }: { track: WaveTrack; size?: number }) {
  const liked = useLikes().has(track.id);
  const signedIn = useAuth().status === 'in';
  if (!signedIn) return null;
  return (
    <Pressable onPress={() => void toggleLike(track)} hitSlop={8} accessibilityLabel={liked ? 'Убрать из лайков' : 'Лайк'}>
      <Text style={{ fontSize: size, color: liked ? theme.accent : theme.muted, textAlign: 'center', minWidth: size + 8 }}>{liked ? '♥' : '♡'}</Text>
    </Pressable>
  );
}

/** Разбитое сердце: «не нравится» (локальная отметка: трек уходит из очереди, вкус и волна это учитывают) */
export function DislikeButton({ track, size = 22 }: { track: WaveTrack; size?: number }) {
  const on = track.id in useMarks().tracks;
  return (
    <Pressable onPress={() => toggleDislike(track)} hitSlop={8} accessibilityLabel={on ? 'Вернуть в подбор' : 'Не нравится'}>
      <Text style={{ fontSize: size, opacity: on ? 1 : 0.55, textAlign: 'center', minWidth: size + 8 }}>💔</Text>
    </Pressable>
  );
}
