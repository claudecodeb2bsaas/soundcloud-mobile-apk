import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { auth } from '../../auth/instance';
import { Loadable } from '../../components/Loadable';
import { TrackRow } from '../../components/TrackRow';
import { artwork, count } from '../../player/format';
import { player, usePlayerState } from '../../player/instance';
import { currentItem } from '../../player/queue';
import { theme } from '../../theme';
import { useLoad } from '../../ui/useLoad';

export default function Search() {
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'tracks' | 'users'>('tracks');
  const playing = currentItem(usePlayerState().queue)?.track.id;
  const { data, error, reload } = useLoad(
    async () => {
      if (!query) return null;
      const [tracks, users] = await Promise.all([auth.sc.searchTracks(query, 50), auth.sc.searchUsers(query)]);
      return { tracks: tracks.items, users };
    },
    [query],
  );

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <TextInput
        style={styles.input}
        value={text}
        onChangeText={setText}
        onSubmitEditing={() => setQuery(text.trim())}
        placeholder="Треки и артисты"
        placeholderTextColor={theme.muted}
        returnKeyType="search"
        autoCorrect={false}
        clearButtonMode="while-editing"
      />
      <View style={styles.tabs}>
        {(['tracks', 'users'] as const).map((id) => (
          <Pressable key={id} onPress={() => setTab(id)} style={[styles.tab, tab === id && styles.tabOn]}>
            <Text style={[styles.tabText, tab === id && styles.tabTextOn]}>{id === 'tracks' ? 'Треки' : 'Артисты'}</Text>
          </Pressable>
        ))}
      </View>
      {!query ? (
        <Text style={styles.muted}>Введи запрос и нажми «Поиск» на клавиатуре</Text>
      ) : (
        <Loadable ready={!!data} error={error} onRetry={reload}>
          {tab === 'tracks' ? (
            <FlatList
              data={data?.tracks}
              keyExtractor={(track) => String(track.id)}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={<Text style={styles.muted}>Ничего не найдено</Text>}
              renderItem={({ item, index }) => (
                <TrackRow track={item} playing={item.id === playing} onPress={() => player.playTracks(data?.tracks ?? [], index)} />
              )}
            />
          ) : (
            <FlatList
              data={data?.users}
              keyExtractor={(user) => String(user.id)}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={<Text style={styles.muted}>Ничего не найдено</Text>}
              renderItem={({ item }) => {
                const avatar = artwork(item.avatarUrl);
                return (
                  <Pressable style={styles.user} onPress={() => router.push(`/artist/${item.id}`)}>
                    {avatar ? <Image source={{ uri: avatar }} style={styles.avatar} /> : <View style={styles.avatar} />}
                    <View style={styles.meta}>
                      <Text style={styles.name} numberOfLines={1}>{item.username}</Text>
                      <Text style={styles.sub} numberOfLines={1}>{count(item.followers)} подписчиков</Text>
                    </View>
                  </Pressable>
                );
              }}
            />
          )}
        </Loadable>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  input: { backgroundColor: theme.surface, color: theme.text, borderRadius: 8, margin: 16, marginBottom: 8, paddingHorizontal: 14, paddingVertical: 10, fontSize: 16 },
  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  tab: { paddingVertical: 6, paddingHorizontal: 14, borderRadius: 16, backgroundColor: theme.surface },
  tabOn: { backgroundColor: theme.accent },
  tabText: { color: theme.muted, fontSize: 14 },
  tabTextOn: { color: '#fff', fontWeight: '600' },
  muted: { color: theme.muted, fontSize: 13, textAlign: 'center', padding: 24 },
  user: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8, gap: 12 },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: theme.surface },
  meta: { flex: 1, gap: 2 },
  name: { color: theme.text, fontSize: 15, fontWeight: '500' },
  sub: { color: theme.muted, fontSize: 13 },
});
