import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Easing, KeyboardAvoidingView, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '../theme';

/** Нижняя шторка: плавно выезжает, затемняет фон, закрывается нажатием мимо и кнопкой «назад». Рисуется, пока родитель её держит */
export function Sheet({ onClose, children }: { onClose: () => void; children: (close: (after?: () => void) => void) => ReactNode }) {
  const insets = useSafeAreaInsets();
  const progress = useRef(new Animated.Value(0)).current;
  const closing = useRef(false);

  useEffect(() => {
    Animated.timing(progress, { toValue: 1, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [progress]);

  const close = (after?: () => void): void => {
    if (closing.current) return;
    closing.current = true;
    Animated.timing(progress, { toValue: 0, duration: 160, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(() => {
      onClose();
      after?.();
    });
  };

  return (
    <Modal transparent visible animationType="none" onRequestClose={() => close()} statusBarTranslucent navigationBarTranslucent>
      <KeyboardAvoidingView style={styles.fill} behavior="padding">
        <Animated.View style={[styles.backdrop, { opacity: progress }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => close()} accessibilityLabel="Закрыть" />
        </Animated.View>
        <View style={styles.anchor} pointerEvents="box-none">
          <Animated.View
            style={[styles.sheet, { paddingBottom: insets.bottom + 12, transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [480, 0] }) }] }]}
          >
            <View style={styles.handle} />
            {children(close)}
          </Animated.View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: '#000000b8' },
  anchor: { flex: 1, justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#141416', borderTopLeftRadius: 32, borderTopRightRadius: 32, paddingTop: 10, paddingHorizontal: 16, maxHeight: '88%', borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border },
  handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: '#ffffff2e', marginBottom: 14 },
});
