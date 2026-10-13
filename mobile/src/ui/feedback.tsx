import { useEffect, useRef, useSyncExternalStore } from 'react';
import { Animated, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '../theme';
import { Icon, type IconName } from './Icon';

// Всплывающие подсказки и подтверждения вместо системных Alert: тот же вид на любой версии Android.
// Вызываются из любого места (toast, confirm), показывает их один хост в корневом экране.

interface ToastState { id: number; text: string; icon?: IconName }
interface DialogState { title: string; message?: string; confirm: string; danger?: boolean; cancel?: string; done(ok: boolean): void }

let toastState: ToastState | null = null;
let dialogState: DialogState | null = null;
let toastId = 0;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
const emit = (): void => { for (const listener of [...listeners]) listener(); };
const subscribe = (listener: () => void): (() => void) => (listeners.add(listener), () => listeners.delete(listener));

export function toast(text: string, icon?: IconName): void {
  clearTimeout(toastTimer);
  toastState = { id: ++toastId, text, icon };
  emit();
  toastTimer = setTimeout(() => { toastState = null; emit(); }, 3200);
}

/** Окно подтверждения; без кнопки отмены (cancel: '') работает как простое сообщение */
export function confirm(options: { title: string; message?: string; confirm?: string; cancel?: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    dialogState?.done(false);
    dialogState = {
      title: options.title, message: options.message, confirm: options.confirm ?? 'Ок', cancel: options.cancel ?? 'Отмена', danger: options.danger,
      done: (ok) => { dialogState = null; emit(); resolve(ok); },
    };
    emit();
  });
}

function Toast() {
  const current = useSyncExternalStore(subscribe, () => toastState, () => toastState);
  const insets = useSafeAreaInsets();
  const shown = useRef(new Animated.Value(0)).current;
  const last = useRef<ToastState | null>(null);
  if (current) last.current = current;

  useEffect(() => {
    Animated.timing(shown, { toValue: current ? 1 : 0, duration: 180, useNativeDriver: true }).start();
  }, [current, shown]);

  const item = current ?? last.current;
  if (!item) return null;
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.toast, { bottom: insets.bottom + 128, opacity: shown, transform: [{ translateY: shown.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] }]}
    >
      {item.icon ? <Icon name={item.icon} size={20} color={theme.accent} /> : null}
      <Text style={styles.toastText} numberOfLines={3}>{item.text}</Text>
    </Animated.View>
  );
}

function Dialog() {
  const dialog = useSyncExternalStore(subscribe, () => dialogState, () => dialogState);
  if (!dialog) return null;
  return (
    <Modal transparent visible animationType="fade" onRequestClose={() => dialog.done(false)} statusBarTranslucent navigationBarTranslucent>
      <View style={styles.dim}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => dialog.done(false)} />
        <View style={styles.card}>
          <Text style={styles.title}>{dialog.title}</Text>
          {dialog.message ? <Text style={styles.message}>{dialog.message}</Text> : null}
          <View style={styles.actions}>
            {dialog.cancel ? (
              <Pressable style={styles.action} onPress={() => dialog.done(false)} android_ripple={{ color: '#ffffff1f' }}>
                <Text style={styles.cancel}>{dialog.cancel}</Text>
              </Pressable>
            ) : null}
            <Pressable style={[styles.action, styles.primary, dialog.danger && styles.danger]} onPress={() => dialog.done(true)} android_ripple={{ color: '#ffffff33' }}>
              <Text style={styles.primaryText}>{dialog.confirm}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** Один хост на приложение: подсказка и окно подтверждения */
export function FeedbackHost() {
  return (
    <>
      <Toast />
      <Dialog />
    </>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute', left: 16, right: 16, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: theme.surfaceHigh, borderRadius: 16, paddingVertical: 12, paddingHorizontal: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border,
    elevation: 8,
  },
  toastText: { flex: 1, color: theme.text, fontSize: 14, lineHeight: 19 },
  dim: { flex: 1, backgroundColor: '#000000b3', alignItems: 'center', justifyContent: 'center', padding: 28 },
  card: { width: '100%', maxWidth: 380, backgroundColor: theme.surface, borderRadius: 28, padding: 24, gap: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border },
  title: { color: theme.text, fontSize: 20, fontWeight: '800' },
  message: { color: theme.muted, fontSize: 15, lineHeight: 21 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 14 },
  action: { minHeight: 44, borderRadius: 22, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  cancel: { color: theme.muted, fontSize: 15, fontWeight: '600' },
  primary: { backgroundColor: theme.accent },
  danger: { backgroundColor: theme.danger },
  primaryText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
