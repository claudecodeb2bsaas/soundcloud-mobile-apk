import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../auth/instance';
import { theme } from '../theme';
import { CloudLogo, Icon } from '../ui/Icon';
import { Button } from '../ui/kit';

/** Загрузка / ошибка с повтором / содержимое */
export function Loadable({ ready, error, onRetry, children }: { ready: boolean; error: string; onRetry: () => void; children: ReactNode }) {
  if (error) {
    return (
      <View style={styles.center}>
        <Icon name="close" size={32} color={theme.muted} />
        <Text style={styles.muted}>{error}</Text>
        <Button label="Повторить" icon="restore" kind="quiet" onPress={onRetry} />
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
      <View style={styles.logo}><CloudLogo size={44} color="#fff" /></View>
      <Text style={styles.heading}>Войди в SoundCloud</Text>
      <Text style={styles.muted}>Чтобы увидеть свою музыку и включить волну</Text>
      <Button label="Войти" onPress={() => router.push('/login')} />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24 },
  logo: { width: 88, height: 88, borderRadius: 44, backgroundColor: theme.accent, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  heading: { color: theme.text, fontSize: 22, fontWeight: '800' },
  muted: { color: theme.muted, fontSize: 14, textAlign: 'center', lineHeight: 20 },
});
