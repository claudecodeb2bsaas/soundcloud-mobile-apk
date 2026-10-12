import * as Notifications from 'expo-notifications';
import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { View } from 'react-native';
import { MiniPlayer } from '../components/MiniPlayer';
import { toggleDislike, toggleLike, TrackMenuHost } from '../components/TrackMenu';
import { WaveOverlay } from '../components/WaveOverlay';
import { auth } from '../auth/instance';
import { onMediaControl, player } from '../player/instance';
import { currentItem } from '../player/queue';
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

/** Кнопки шторки Android: назад, вперёд, лайк и дизлайк текущего трека */
function useMediaControls() {
  useEffect(
    () =>
      onMediaControl((action) => {
        if (action === 'previous') return player.previous();
        if (action === 'next') return player.next();
        const track = currentItem(player.getState().queue)?.track;
        if (track) return action === 'like' ? void toggleLike(track) : toggleDislike(track);
      }),
    [],
  );
}
export default function RootLayout() {
  const { radarEnabled } = useSettings();
  useNotificationRedirect();
  useMediaControls();

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
