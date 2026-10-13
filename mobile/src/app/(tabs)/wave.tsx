import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RequireAuth } from '../../components/Loadable';
import { MyMusic } from '../../components/MyMusic';
import { PRESETS, Swatch, WaveControls, WaveHero } from '../../components/WaveHero';
import { theme } from '../../theme';
import { Chip } from '../../ui/kit';
import { Icon } from '../../ui/Icon';
import { wave, useWave } from '../../wave/instance';

function WaveScreen() {
  const state = useWave();

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <WaveHero size={330} ring />
      <WaveControls ring />

      <Text style={styles.label}>По настроению</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.moods}>
        {PRESETS.map((preset) => (
          <Pressable key={preset.id || 'any'} style={styles.mood} onPress={() => wave.configure({ preset: preset.id })} accessibilityRole="button" accessibilityLabel={preset.label}>
            <Swatch mood={preset.id} on={state.preset === preset.id} />
            <Text style={[styles.moodText, state.preset === preset.id && styles.moodTextOn]}>{preset.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <Text style={styles.label}>По характеру</Text>
      <View style={styles.chips}>
        <Chip label="Похожее" icon="heart" on={state.mode === 'similar'} onPress={() => wave.configure({ mode: 'similar' })} />
        <Chip label="Новое" icon="sparkle" on={state.mode === 'fresh'} onPress={() => wave.configure({ mode: 'fresh' })} />
      </View>

      <Pressable style={styles.link} onPress={() => router.push('/taste')} accessibilityRole="button" android_ripple={{ color: '#ffffff14' }}>
        <View style={styles.linkIcon}><Icon name="trending" size={22} color={theme.accent} /></View>
        <View style={styles.linkText}>
          <Text style={styles.linkTitle}>Мой вкус</Text>
          <Text style={styles.linkSub}>Что волна ставит чаще, убрать из вкуса</Text>
        </View>
        <Icon name="chevronRight" size={22} color={theme.muted} />
      </Pressable>

      <View style={styles.music}>
        <MyMusic />
      </View>
    </ScrollView>
  );
}

export default function WaveTab() {
  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <RequireAuth>
        <WaveScreen />
      </RequireAuth>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  content: { paddingBottom: 32 },
  label: { color: theme.muted, fontSize: 13, fontWeight: '600', marginTop: 26, marginBottom: 12, paddingHorizontal: 20 },
  moods: { paddingHorizontal: 12, gap: 4 },
  mood: { alignItems: 'center', gap: 6, width: 82 },
  moodText: { color: theme.muted, fontSize: 13, fontWeight: '600' },
  moodTextOn: { color: theme.text },
  chips: { flexDirection: 'row', gap: 8, paddingHorizontal: 16 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 14, marginHorizontal: 16, marginTop: 22, padding: 14, borderRadius: 20, backgroundColor: theme.surface, overflow: 'hidden' },
  linkIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: theme.accentSoft, alignItems: 'center', justifyContent: 'center' },
  linkText: { flex: 1, gap: 2 },
  linkTitle: { color: theme.text, fontSize: 16, fontWeight: '700' },
  linkSub: { color: theme.muted, fontSize: 13 },
  music: { paddingHorizontal: 16 },
});
