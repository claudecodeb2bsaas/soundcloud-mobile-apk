import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Loadable, RequireAuth } from '../components/Loadable';
import type { RadarItem } from '../core/radar';
import { fillText } from '../core/waveTexts';
import { texts } from '../settings/texts';
import { theme } from '../theme';
import { useLoad } from '../ui/useLoad';
import { radar, wave } from '../wave/instance';
import { radarReason, type RadarView } from '../wave/radar';

const T = texts;
const day = (at: number): string => {
  const date = new Date(at);
  return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}`;
};

function Row({ item, onPress }: { item: RadarItem; onPress: () => void }) {
  const more = item.group && item.group.length > 1 ? ` · ${fillText(T.radarGroupAll, { n: String(item.group.length) })}` : '';
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <View style={styles.meta}>
        <Text style={[styles.title, item.heard && styles.heard]} numberOfLines={1}>{item.title}</Text>
        <Text style={styles.muted} numberOfLines={1}>{item.artist} · {day(item.at)}{item.heard ? ` · ${T.radarHeard}` : ''}</Text>
        <Text style={styles.reason} numberOfLines={1}>{radarReason(item.reason, T)}{more}</Text>
      </View>
    </Pressable>
  );
}

function Edition({ view, onRebuild }: { view: RadarView; onRebuild: () => void }) {
  const { items, uploads } = view.edition;
  const play = (fromId?: number) => void radar.seed(view, fromId).then((seed) => (seed.own.length ? wave.start(seed) : undefined)).catch(() => undefined);
  const posts = uploads.filter((item) => !item.fan);
  const fans = uploads.filter((item) => item.fan);
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.muted}>{fillText(T.radarCoverage, { checked: String(view.checked), total: String(view.total) })}</Text>
      <Pressable onPress={onRebuild} hitSlop={8}>
        <Text style={[styles.link, styles.rebuild]}>{T.radarRebuild}</Text>
      </Pressable>
      {items.length ? (
        <Pressable style={styles.button} onPress={() => play()}>
          <Text style={styles.buttonText}>{T.mixPlay}</Text>
        </Pressable>
      ) : <Text style={[styles.muted, styles.pad]}>За неделю новых релизов не нашлось</Text>}
      {items.map((item) => <Row key={item.id} item={item} onPress={() => play(item.id)} />)}
      {posts.length ? <Text style={styles.heading}>{T.radarUploads}</Text> : null}
      {posts.length ? <Text style={styles.hint}>{T.radarUploadsHint}</Text> : null}
      {posts.map((item) => <Row key={item.id} item={item} onPress={() => play(item.id)} />)}
      {fans.length ? <Text style={styles.heading}>{T.radarFans}</Text> : null}
      {fans.length ? <Text style={styles.hint}>{T.radarFansHint}</Text> : null}
      {fans.map((item) => <Row key={item.id} item={item} onPress={() => play(item.id)} />)}
    </ScrollView>
  );
}

function Radar() {
  const [force, setForce] = useState(0);
  const { data, error, reload } = useLoad(() => radar.load(force > 0), [force]);
  return (
    <Loadable ready={!!data} error={error} onRetry={reload}>
      {data ? <Edition view={data} onRebuild={() => setForce(force + 1)} /> : null}
    </Loadable>
  );
}

export default function RadarScreen() {
  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.bar}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.link}>Назад</Text>
        </Pressable>
      </View>
      <Text style={styles.screenTitle}>{T.radar}</Text>
      <RequireAuth>
        <Radar />
      </RequireAuth>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  bar: { paddingHorizontal: 16, paddingVertical: 12, alignSelf: 'flex-start' },
  link: { color: theme.accent, fontSize: 15 },
  rebuild: { paddingHorizontal: 16, paddingTop: 4 },
  screenTitle: { color: theme.text, fontSize: 22, fontWeight: '700', paddingHorizontal: 16, paddingBottom: 8 },
  content: { paddingBottom: 24 },
  pad: { padding: 24 },
  muted: { color: theme.muted, fontSize: 13, paddingHorizontal: 16 },
  hint: { color: theme.muted, fontSize: 12, paddingHorizontal: 16, paddingBottom: 4 },
  heading: { color: theme.text, fontSize: 18, fontWeight: '700', paddingHorizontal: 16, paddingTop: 20, paddingBottom: 4 },
  button: { backgroundColor: theme.accent, borderRadius: 8, paddingVertical: 10, alignSelf: 'center', paddingHorizontal: 32, marginVertical: 12 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  row: { paddingHorizontal: 16, paddingVertical: 8 },
  meta: { gap: 2 },
  title: { color: theme.text, fontSize: 15, fontWeight: '500' },
  heard: { color: theme.muted },
  reason: { color: theme.accent, fontSize: 12 },
});
