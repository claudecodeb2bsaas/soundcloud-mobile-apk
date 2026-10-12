import { Tabs } from 'expo-router';
import { Text, type ColorValue } from 'react-native';
import { currentItem } from '../../player/queue';
import { usePlayerState } from '../../player/instance';
import { theme } from '../../theme';

const icon = (glyph: string) => ({ color }: { color: ColorValue }) => <Text style={{ color, fontSize: 20 }}>{glyph}</Text>;

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
        tabBarStyle: {
          backgroundColor: theme.surface,
          borderTopColor: '#ffffff1f',
          ...(miniPlayer ? { height: 52, paddingBottom: 4 } : null),
        },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Главная', tabBarIcon: icon('⌂') }} />
      <Tabs.Screen name="search" options={{ title: 'Поиск', tabBarIcon: icon('⌕') }} />
      <Tabs.Screen name="library" options={{ title: 'Библиотека', tabBarIcon: icon('♫') }} />
    </Tabs>
  );
}
