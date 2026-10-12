import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { DESKTOP_USER_AGENT } from '../api/clientId';
import { LOGIN_SCRIPT } from '../auth/loginScript';
import { auth } from '../auth/instance';
import { cleanToken, parseLoginMessage } from '../auth/session';
import { theme } from '../theme';

const SIGN_IN_URL = 'https://soundcloud.com/signin';

function isSoundCloud(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === 'https:' && (hostname === 'soundcloud.com' || hostname.endsWith('.soundcloud.com'));
  } catch {
    return false;
  }
}

export default function Login() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [manual, setManual] = useState(false);
  const [text, setText] = useState('');
  const handled = useRef(false);

  async function finish(token: string, clientId: string | null) {
    if (handled.current) return;
    handled.current = true;
    setBusy(true);
    setError('');
    try {
      await auth.signInWithToken(token, clientId);
      router.replace('/');
    } catch (e) {
      handled.current = false;
      setBusy(false);
      setError(e instanceof Error ? e.message : 'Не удалось войти');
    }
  }

  function onMessage(event: WebViewMessageEvent) {
    // Токен принимаем только от страниц самого SoundCloud
    if (!isSoundCloud(event.nativeEvent.url)) return;
    const message = parseLoginMessage(event.nativeEvent.data);
    if (message) void finish(message.token, message.clientId);
  }

  function submitManual() {
    const token = cleanToken(text);
    if (!token) {
      setError('Токен выглядит неверно');
      return;
    }
    void finish(token, null);
  }

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.bar}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.link}>Назад</Text>
        </Pressable>
        <Text style={styles.title}>Вход в SoundCloud</Text>
        <Pressable onPress={() => setManual((value) => !value)} hitSlop={12}>
          <Text style={styles.link}>{manual ? 'Страница' : 'Токен'}</Text>
        </Pressable>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {manual ? (
        <View style={styles.manual}>
          <Text style={styles.hint}>
            Вставь OAuth-токен аккаунта. Он нужен, если вход через страницу не сработал, например при входе через Google.
          </Text>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder="2-123456-7890-AbCdEf…"
            placeholderTextColor={theme.muted}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />
          <Pressable style={styles.button} onPress={submitManual} disabled={busy}>
            <Text style={styles.buttonText}>Войти по токену</Text>
          </Pressable>
        </View>
      ) : (
        <WebView
          style={styles.web}
          source={{ uri: SIGN_IN_URL }}
          userAgent={DESKTOP_USER_AGENT}
          incognito
          injectedJavaScriptBeforeContentLoaded={LOGIN_SCRIPT}
          onMessage={onMessage}
          originWhitelist={['https://*']}
          onShouldStartLoadWithRequest={(request) => request.url.startsWith('https://')}
          setSupportMultipleWindows={false}
        />
      )}
      {busy ? (
        <View style={styles.busy}>
          <ActivityIndicator color={theme.accent} size="large" />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10 },
  title: { color: theme.text, fontSize: 16, fontWeight: '600' },
  link: { color: theme.accent, fontSize: 15 },
  error: { color: '#ff6b6b', paddingHorizontal: 16, paddingBottom: 8 },
  web: { flex: 1, backgroundColor: theme.bg },
  manual: { padding: 16, gap: 12 },
  hint: { color: theme.muted, fontSize: 13, lineHeight: 18 },
  input: { backgroundColor: theme.surface, color: theme.text, borderRadius: 8, padding: 12, fontSize: 15 },
  button: { backgroundColor: theme.accent, borderRadius: 8, padding: 14, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  busy: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000a', alignItems: 'center', justifyContent: 'center' },
});
