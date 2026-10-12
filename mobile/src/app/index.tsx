import { StyleSheet, Text, View } from 'react-native';
import { theme } from '../theme';

// Заглушка этапа 0. Дальше здесь появится вход, главная и «Моя волна».
export default function Home() {
  return (
    <View style={styles.root}>
      <Text style={styles.title}>SoundCloud Wave</Text>
      <Text style={styles.sub}>Мобильный клиент в разработке</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { color: theme.text, fontSize: 28, fontWeight: '700' },
  sub: { color: theme.muted, fontSize: 14, marginTop: 8 },
});
