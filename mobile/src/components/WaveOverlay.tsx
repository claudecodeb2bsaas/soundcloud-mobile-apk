import { useEffect } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { texts } from '../settings/texts';
import { theme } from '../theme';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/kit';
import { Sheet } from '../ui/Sheet';
import { useWave, wave } from '../wave/instance';

const T = texts;
const NOTICE_MS = 8000;

/** Подсказки волны: «Меньше такого в этой волне» с отменой (П7) и развилка «Куда дальше?» после трёх быстрых пропусков (П8) */
export function WaveOverlay() {
  const { fork, notice } = useWave();

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => wave.dismissNotice(), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  return (
    <>
      {notice ? (
        <View style={styles.notice}>
          <Icon name="wave" size={20} color={theme.accent} />
          <Text style={styles.noticeText} numberOfLines={2}>{notice.text}</Text>
          <Pressable onPress={() => wave.undoNotice()} hitSlop={10} accessibilityRole="button">
            <Text style={styles.undo}>{T.undo}</Text>
          </Pressable>
        </View>
      ) : null}
      {fork ? (
        <Sheet onClose={() => wave.closeFork()}>
          {(close) => (
            <>
              <View style={styles.head}>
                <Text style={styles.title}>{T.forkTitle}</Text>
                <IconButton icon="close" size={38} bg={theme.surfaceHigh} label={T.forkClose} onPress={() => close()} />
              </View>
              <ScrollView showsVerticalScrollIndicator={false}>
                {fork.options.map((option) => (
                  <Pressable key={option.id} style={styles.row} onPress={() => wave.pickFork(option.id)} android_ripple={{ color: '#ffffff14' }}>
                    {option.artwork ? <Image source={{ uri: option.artwork }} style={styles.cover} /> : <View style={[styles.cover, styles.noCover]}><Icon name="music" size={22} color={theme.muted} /></View>}
                    <View style={styles.meta}>
                      <Text style={styles.name} numberOfLines={1}>{option.title}</Text>
                      <Text style={styles.muted} numberOfLines={1}>{option.artist}</Text>
                      <Text style={styles.label} numberOfLines={1}>{option.label}</Text>
                    </View>
                    <Icon name="chevronRight" size={22} color={theme.muted} />
                  </Pressable>
                ))}
              </ScrollView>
            </>
          )}
        </Sheet>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  notice: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: theme.surfaceHigh, paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
  noticeText: { flex: 1, color: theme.text, fontSize: 13, lineHeight: 18 },
  undo: { color: theme.accent, fontSize: 14, fontWeight: '800' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 8 },
  title: { color: theme.text, fontSize: 20, fontWeight: '800' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 10, borderRadius: 16 },
  cover: { width: 56, height: 56, borderRadius: 14, backgroundColor: theme.surfaceHigh },
  noCover: { alignItems: 'center', justifyContent: 'center' },
  meta: { flex: 1, gap: 2 },
  name: { color: theme.text, fontSize: 15, fontWeight: '700' },
  muted: { color: theme.muted, fontSize: 13 },
  label: { color: theme.accentBright, fontSize: 12, fontWeight: '600' },
});
