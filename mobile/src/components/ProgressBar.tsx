import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useProgress } from '../player/instance';
import { theme } from '../theme';

interface Props {
  /** Нажатие по полосе перематывает; без него полоса только показывает ход */
  onSeek?: (seconds: number) => void;
  thin?: boolean;
}

export function ProgressBar({ onSeek, thin }: Props) {
  const { position, duration } = useProgress();
  const [width, setWidth] = useState(0);
  const ratio = duration > 0 ? Math.min(1, position / duration) : 0;

  return (
    <Pressable
      style={thin ? styles.touchThin : styles.touch}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      onPress={(event) => {
        if (onSeek && width > 0 && duration > 0) onSeek((event.nativeEvent.locationX / width) * duration);
      }}
      disabled={!onSeek}
    >
      <View style={thin ? styles.trackThin : styles.track}>
        <View style={[styles.fill, { width: `${ratio * 100}%` }]} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  touch: { height: 28, justifyContent: 'center' },
  touchThin: { height: 2 },
  track: { height: 4, borderRadius: 2, backgroundColor: '#ffffff26', overflow: 'hidden' },
  trackThin: { height: 2, backgroundColor: '#ffffff26', overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: theme.accent },
});
