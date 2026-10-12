import * as Notifications from 'expo-notifications';
import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { View } from 'react-native';
import { MiniPlayer } from '../components/MiniPlayer';
import { TrackMenuHost } from '../components/TrackMenu';
import { WaveOverlay } from '../components/WaveOverlay';
import { auth } from '../auth/instance';
import { player } from '../player/instance';
import { useSettings } from '../settings/instance';
import { theme } from '../theme';
import { checkRadar, syncRadarTask } from '../background';

/** Нажатие на уведомление открывает экран из data.url (радар) */
function useNotificationRedirect() {
  useEffect(() => {
    const open = (response: Notifications.NotificationResponse | null) => {
      const url = response?.notification.request.content.data?.url;
      if (url === '/radar') router.push('/radar');
    };
    open(Notifications.getLastNotificationResponse());
    const subscription = Notifications.addNotificationResponseReceivedListener(open);
    return () => subscription.remove();
  }, []);
}

export default function RootLayout() {
  const { radarEnabled } = useSettings();
  useNotificationRedirect();

  useEffect(() => {
    // Сначала вход, потом сохранённая очередь: без входа адреса потоков не получить.
    // Радар: если срок наступил, пока приложение было закрыто, а система задачу не запустила, собираем при открытии
    auth
      .init()
      .then(async () => {
        if (auth.getState().status === 'in') await player.restore().catch(() => false);
        await checkRadar();
      })
      .catch(() => undefined);
  }, []);

  // Фоновая задача включается и выключается вместе с настройкой
  useEffect(() => {
    void syncRadarTask(radarEnabled);
  }, [radarEnabled]);

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
