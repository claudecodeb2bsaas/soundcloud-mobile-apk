import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { View } from 'react-native';
import { MiniPlayer } from '../components/MiniPlayer';
import { TrackMenuHost } from '../components/TrackMenu';
import { WaveOverlay } from '../components/WaveOverlay';
import { auth } from '../auth/instance';
import { player } from '../player/instance';
import { theme } from '../theme';

export default function RootLayout() {
  useEffect(() => {
    // Сначала вход, потом сохранённая очередь: без входа адреса потоков не получить
    auth
      .init()
      .then(() => (auth.getState().status === 'in' ? player.restore() : false))
      .catch(() => undefined);
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.bg } }}>
        <Stack.Screen name="player" options={{ presentation: 'modal' }} />
      </Stack>
      <WaveOverlay />
      <MiniPlayer />
      <TrackMenuHost />
    </View>
  );
}
