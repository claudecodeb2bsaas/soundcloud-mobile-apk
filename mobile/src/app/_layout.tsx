import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { auth } from '../auth/instance';
import { theme } from '../theme';

export default function RootLayout() {
  useEffect(() => {
    auth.init().catch(() => undefined);
  }, []);

  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.bg } }} />
    </>
  );
}
