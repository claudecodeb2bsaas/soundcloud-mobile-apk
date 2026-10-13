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
import { Icon } from '../../ui/Icon';
import { Chip } from '../../ui/kit';
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
      <Text style={styles.title}>Поиск</Text>
      <View style={styles.field}>
      <Icon name="search" size={22} color={theme.muted} />
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
      </View>
      <View style={styles.tabs}>
        {(['tracks', 'users'] as const).map((id) => (
          <Chip key={id} label={id === 'tracks' ? 'Треки' : 'Артисты'} on={tab === id} onPress={() => setTab(id)} />
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
                    {avatar ? <Image source={{ uri: avatar }} style={styles.avatar} /> : <View style={[styles.avatar, styles.noAvatar]}><Icon name="person" size={26} color={theme.muted} /></View>}
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
  title: { color: theme.text, fontSize: 28, fontWeight: '800', paddingHorizontal: 16, paddingTop: 10 },
  field: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: theme.surface, borderRadius: 26, margin: 16, marginBottom: 12, paddingHorizontal: 18 },
  input: { flex: 1, color: theme.text, paddingVertical: 12, fontSize: 16 },
  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  muted: { color: theme.muted, fontSize: 13, textAlign: 'center', padding: 24 },
  user: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8, gap: 12 },
  avatar: { width: 54, height: 54, borderRadius: 27, backgroundColor: theme.surface },
  noAvatar: { alignItems: 'center', justifyContent: 'center' },
  meta: { flex: 1, gap: 2 },
  name: { color: theme.text, fontSize: 15, fontWeight: '600' },
  sub: { color: theme.muted, fontSize: 13 },
});
