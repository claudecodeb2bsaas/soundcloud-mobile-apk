import { Tabs } from 'expo-router';
import type { ColorValue } from 'react-native';
import { currentItem } from '../../player/queue';
import { usePlayerState } from '../../player/instance';
import { theme } from '../../theme';
import { Icon, type IconName } from '../../ui/Icon';

const icon = (name: IconName) => ({ color }: { color: ColorValue }) => <Icon name={name} size={24} color={String(color)} />;

export default function TabsLayout() {
  // Мини-плеер стоит под вкладками и сам занимает нижний отступ системы; без него отступ нужен вкладкам
  const miniPlayer = !!currentItem(usePlayerState().queue);
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: theme.bg },
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: theme.muted,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        tabBarStyle: {
          backgroundColor: theme.bg,
          borderTopColor: theme.border,
          borderTopWidth: 1,
          elevation: 0,
          ...(miniPlayer ? { height: 56, paddingBottom: 4 } : null),
        },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Главная', tabBarIcon: icon('home') }} />
      <Tabs.Screen name="wave" options={{ title: 'Волна', tabBarIcon: icon('wave') }} />
      <Tabs.Screen name="search" options={{ title: 'Поиск', tabBarIcon: icon('search') }} />
      <Tabs.Screen name="library" options={{ title: 'Библиотека', tabBarIcon: icon('library') }} />
    </Tabs>
  );
}
