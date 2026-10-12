import { useEffect } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { texts } from '../settings/texts';
import { theme } from '../theme';
import { useWave, wave } from '../wave/instance';

const T = texts;
const NOTICE_MS = 8000;

/** Подсказки волны: «Меньше такого в этой волне» с отменой (П7) и развилка «Куда дальше?» после трёх быстрых пропусков (П8) */
export function WaveOverlay() {
  const { fork, notice } = useWave();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => wave.dismissNotice(), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  return (
    <>
      {notice ? (
        <View style={styles.notice}>
          <Text style={styles.noticeText} numberOfLines={2}>{notice.text}</Text>
          <Pressable onPress={() => wave.undoNotice()} hitSlop={10}>
            <Text style={styles.undo}>{T.undo}</Text>
          </Pressable>
        </View>
      ) : null}
      {fork ? (
        <Modal transparent visible animationType="fade" onRequestClose={() => wave.closeFork()} statusBarTranslucent navigationBarTranslucent>
          <Pressable style={styles.backdrop} onPress={() => wave.closeFork()} />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 8 }]}>
            <View style={styles.head}>
              <Text style={styles.title}>{T.forkTitle}</Text>
              <Pressable onPress={() => wave.closeFork()} hitSlop={12}>
                <Text style={styles.undo}>{T.forkClose}</Text>
              </Pressable>
            </View>
            <ScrollView>
              {fork.options.map((option) => (
                <Pressable key={option.id} style={styles.row} onPress={() => wave.pickFork(option.id)}>
                  {option.artwork ? <Image source={{ uri: option.artwork }} style={styles.cover} /> : <View style={styles.cover} />}
                  <View style={styles.meta}>
                    <Text style={styles.name} numberOfLines={1}>{option.title}</Text>
                    <Text style={styles.muted} numberOfLines={1}>{option.artist}</Text>
                    <Text style={styles.label} numberOfLines={1}>{option.label}</Text>
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Modal>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  notice: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#2a2a2a', paddingHorizontal: 16, paddingVertical: 10 },
  noticeText: { flex: 1, color: theme.text, fontSize: 13 },
  undo: { color: theme.accent, fontSize: 14, fontWeight: '600' },
  backdrop: { flex: 1, backgroundColor: '#00000099' },
  sheet: { backgroundColor: theme.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingTop: 16, maxHeight: '85%' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 8 },
  title: { color: theme.text, fontSize: 18, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 8 },
  cover: { width: 52, height: 52, borderRadius: 4, backgroundColor: '#2a2a2a' },
  meta: { flex: 1, gap: 2 },
  name: { color: theme.text, fontSize: 15, fontWeight: '500' },
  muted: { color: theme.muted, fontSize: 13 },
  label: { color: theme.accent, fontSize: 12 },
});
