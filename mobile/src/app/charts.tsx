import { router } from 'expo-router';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { auth } from '../auth/instance';
import { Loadable } from '../components/Loadable';
import { artwork } from '../player/format';
import { theme } from '../theme';
import { useLoad } from '../ui/useLoad';

/** Чарты сайта: подборки по странам, в каждой плейлисты по жанрам. Состав открывается как обычный плейлист */
export default function Charts() {
  const { data, error, reload } = useLoad(() => auth.sc.charts(), []);
  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back}>
        <Text style={styles.link}>Назад</Text>
      </Pressable>
      <Text style={styles.title}>Чарты</Text>
      <Loadable ready={!!data} error={error} onRetry={reload}>
        <ScrollView contentContainerStyle={styles.content}>
          {data?.map((section) => (
            <View key={section.title}>
              <Text style={styles.heading}>{section.title}</Text>
              {section.lists.map((list) => {
                const cover = artwork(list.artwork);
                return (
                  <Pressable key={list.id} style={styles.row} onPress={() => router.push(`/playlist/${list.id}`)}>
                    {cover ? <Image source={{ uri: cover }} style={styles.cover} /> : <View style={styles.cover} />}
                    <View style={styles.meta}>
                      <Text style={styles.name} numberOfLines={1}>{list.title}</Text>
                      <Text style={styles.muted}>{list.count} треков</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ))}
          {data && !data.length ? <Text style={[styles.muted, styles.pad]}>Чарты сейчас недоступны</Text> : null}
        </ScrollView>
      </Loadable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  back: { paddingHorizontal: 16, paddingVertical: 12, alignSelf: 'flex-start' },
  link: { color: theme.accent, fontSize: 15 },
  title: { color: theme.text, fontSize: 22, fontWeight: '700', paddingHorizontal: 16, paddingBottom: 8 },
  content: { paddingBottom: 24 },
  heading: { color: theme.text, fontSize: 18, fontWeight: '700', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8, gap: 12 },
  cover: { width: 52, height: 52, borderRadius: 4, backgroundColor: theme.surface },
  meta: { flex: 1, gap: 2 },
  name: { color: theme.text, fontSize: 15, fontWeight: '500' },
  muted: { color: theme.muted, fontSize: 13 },
  pad: { padding: 24, textAlign: 'center' },
});
