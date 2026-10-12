import { Link } from 'expo-router';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../auth/instance';
import { theme } from '../theme';

/** Загрузка / ошибка с повтором / содержимое */
export function Loadable({ ready, error, onRetry, children }: { ready: boolean; error: string; onRetry: () => void; children: ReactNode }) {
  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>{error}</Text>
        <Pressable style={styles.button} onPress={onRetry}>
          <Text style={styles.buttonText}>Повторить</Text>
        </Pressable>
      </View>
    );
  }
  if (!ready) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }
  return <>{children}</>;
}

/** Экраны с личными данными: без входа предлагают войти */
export function RequireAuth({ children }: { children: ReactNode }) {
  const state = useAuth();
  if (state.status === 'in') return <>{children}</>;
  if (state.status === 'loading') {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }
  return (
    <View style={styles.center}>
      <Text style={styles.muted}>Войди в аккаунт SoundCloud, чтобы увидеть свою музыку</Text>
      <Link href="/login" asChild>
        <Pressable style={styles.button}>
          <Text style={styles.buttonText}>Войти</Text>
        </Pressable>
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  muted: { color: theme.muted, fontSize: 13, textAlign: 'center' },
  button: { backgroundColor: theme.accent, borderRadius: 8, paddingVertical: 12, paddingHorizontal: 28 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 15 },
});
