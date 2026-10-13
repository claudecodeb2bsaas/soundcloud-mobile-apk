import { useRef, useState } from 'react';
import { GestureResponderEvent, StyleSheet, Text, View } from 'react-native';
import { clock } from '../player/format';
import { useProgress } from '../player/instance';
import { theme } from '../theme';

interface Props {
  /** Перетаскивание и нажатие по полосе перематывают; без него полоса только показывает ход */
  onSeek?: (seconds: number) => void;
  thin?: boolean;
  /** Текущая секунда и длительность под полосой (при перетаскивании показывается место, куда перемотаем) */
  times?: boolean;
}

export function ProgressBar({ onSeek, thin, times }: Props) {
  const { position, duration } = useProgress();
  const [width, setWidth] = useState(0);
  // Пока палец на полосе, показываем его место, а не ход плеера; перемотка один раз при отпускании
  const [drag, setDrag] = useState<number | null>(null);
  const last = useRef(0);
  const ratio = drag ?? (duration > 0 ? Math.min(1, position / duration) : 0);
  const seekable = !!onSeek && duration > 0;

  const at = (event: GestureResponderEvent): number => (width > 0 ? Math.max(0, Math.min(1, event.nativeEvent.locationX / width)) : 0);
  const move = (event: GestureResponderEvent): void => {
    last.current = at(event);
    setDrag(last.current);
  };

  return (
    <View>
      <View
        style={thin ? styles.touchThin : styles.touch}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => seekable}
        onResponderTerminationRequest={() => false}
        onResponderGrant={move}
        onResponderMove={move}
        onResponderRelease={(event) => {
          onSeek?.(at(event) * duration);
          setDrag(null);
        }}
        onResponderTerminate={() => setDrag(null)}
      >
        <View style={thin ? styles.trackThin : styles.track} pointerEvents="none">
          <View style={[styles.fill, { width: `${ratio * 100}%` }]} />
        </View>
        {seekable && !thin ? <View pointerEvents="none" style={[styles.thumb, drag !== null && styles.thumbDrag, { left: `${ratio * 100}%` }]} /> : null}
      </View>
      {times ? (
        <View style={styles.times}>
          <Text style={styles.time}>{clock(drag === null ? position : drag * duration)}</Text>
          <Text style={styles.time}>{clock(duration)}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  touch: { height: 28, justifyContent: 'center' },
  touchThin: { height: 2 },
  track: { height: 5, borderRadius: 3, backgroundColor: '#ffffff26', overflow: 'hidden' },
  trackThin: { height: 2, backgroundColor: '#ffffff1f', overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: theme.accent },
  thumb: { position: 'absolute', width: 14, height: 14, borderRadius: 7, marginLeft: -7, backgroundColor: '#fff', elevation: 3 },
  thumbDrag: { width: 20, height: 20, borderRadius: 10, marginLeft: -10 },
  times: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  time: { color: theme.muted, fontSize: 13, fontWeight: '500' },
});
