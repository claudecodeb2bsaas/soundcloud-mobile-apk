import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { theme } from '../theme';
import { Icon, type IconName } from './Icon';

/** Круглая кнопка с иконкой: прозрачная, на подложке или залитая акцентом */
export function IconButton({
  icon, onPress, size = 44, iconSize, color = theme.text, bg, label, style, disabled,
}: {
  icon: IconName; onPress: () => void; size?: number; iconSize?: number; color?: string; bg?: string; label: string; style?: StyleProp<ViewStyle>; disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      android_ripple={{ color: '#ffffff22', borderless: true, radius: size / 2 }}
      style={[{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: bg }, disabled && { opacity: 0.4 }, style]}
    >
      <Icon name={icon} size={iconSize ?? Math.round(size * 0.5)} color={color} />
    </Pressable>
  );
}

/** Шапка вторичных экранов: круглая «назад», заголовок и место справа */
export function ScreenHeader({ title, right, onBack }: { title: string; right?: ReactNode; onBack?: () => void }) {
  return (
    <View style={styles.header}>
      <IconButton icon="chevronLeft" label="Назад" bg={theme.surface} onPress={onBack ?? (() => (router.canGoBack() ? router.back() : router.replace('/')))} />
      <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
      <View style={styles.headerRight}>{right}</View>
    </View>
  );
}

export function Chip({ label, on, onPress, icon }: { label: string; on?: boolean; onPress: () => void; icon?: IconName }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, on && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: !!on }}>
      {icon ? <Icon name={icon} size={16} color={on ? '#fff' : theme.muted} /> : null}
      <Text style={[styles.chipText, on && styles.chipTextOn]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

/** Основная кнопка: залитая акцентом или тихая на поверхности */
export function Button({ label, onPress, icon, kind = 'primary', disabled, busy }: { label: string; onPress: () => void; icon?: IconName; kind?: 'primary' | 'quiet' | 'danger'; disabled?: boolean; busy?: boolean }) {
  const quiet = kind !== 'primary';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      android_ripple={{ color: '#ffffff22' }}
      style={[styles.button, quiet && styles.buttonQuiet, (disabled || busy) && { opacity: 0.5 }]}
    >
      {icon ? <Icon name={icon} size={20} color={kind === 'danger' ? theme.danger : quiet ? theme.text : '#fff'} /> : null}
      <Text style={[styles.buttonText, quiet && styles.buttonTextQuiet, kind === 'danger' && { color: theme.danger }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  headerTitle: { flex: 1, color: theme.text, fontSize: 22, fontWeight: '800' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 9, paddingHorizontal: 16, borderRadius: 20, backgroundColor: theme.surface },
  chipOn: { backgroundColor: theme.accent },
  chipText: { color: theme.muted, fontSize: 14, fontWeight: '500' },
  chipTextOn: { color: '#fff', fontWeight: '700' },
  button: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: theme.accent, borderRadius: 26, paddingVertical: 14, paddingHorizontal: 24 },
  buttonQuiet: { backgroundColor: theme.surface },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  buttonTextQuiet: { color: theme.text },
});
