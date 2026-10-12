import { router } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { Alert, Pressable, ScrollView, Share, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { diagnostics, diagnosticsText, exportBackup, importBackup } from '../addons/instance';
import { askNotifications, rearmRadar } from '../background';
import { auth, useAuth } from '../auth/instance';
import type { Session } from '../auth/session';
import { settings, useSettings } from '../settings/instance';
import { isRadarTime, isWebhookUrl } from '../settings/settings';
import { theme } from '../theme';
import { useMarks } from '../wave/instance';

const DAYS = [
  { id: 1, label: 'Пн' }, { id: 2, label: 'Вт' }, { id: 3, label: 'Ср' }, { id: 4, label: 'Чт' },
  { id: 5, label: 'Пт' }, { id: 6, label: 'Сб' }, { id: 0, label: 'Вс' },
] as const;

const BACKUP_ERRORS = {
  'not-backup': 'Это не копия SoundCloud Wave',
  'newer-format': 'Копия сделана более новой версией приложения',
  damaged: 'Копия повреждена',
  'too-big': 'Текст слишком большой для копии',
} as const;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.heading}>{title}</Text>
      {children}
    </View>
  );
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, on && styles.chipOn]}>
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }) {
  return (
    <View style={styles.toggle}>
      <Text style={styles.label}>{label}</Text>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: theme.accent }} />
    </View>
  );
}

function Button({ label, onPress, danger }: { label: string; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable onPress={onPress} style={styles.button}>
      <Text style={[styles.buttonText, danger && styles.danger]}>{label}</Text>
    </Pressable>
  );
}

function Accounts() {
  const state = useAuth();
  const [list, setList] = useState<Session[]>([]);
  const [error, setError] = useState('');
  const current = state.session?.user.id;
  useEffect(() => {
    void auth.accounts().then(setList, () => setList([]));
  }, [current]);

  const switchTo = (account: Session) => {
    setError('');
    auth.switchTo(account.user.id).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Не удалось переключиться'));
  };
  const signOut = () =>
    Alert.alert('Выйти из аккаунта?', 'Остальные сохранённые аккаунты останутся.', [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Выйти', style: 'destructive', onPress: () => void auth.signOut() },
    ]);

  return (
    <Section title="Аккаунты">
      {list.map((account) => (
        <Pressable key={account.user.id} style={styles.row} onPress={() => (account.user.id === current ? undefined : switchTo(account))}>
          <Text style={styles.label} numberOfLines={1}>{account.user.username || account.user.id}</Text>
          <Text style={styles.muted}>{account.user.id === current ? 'Текущий' : 'Переключить'}</Text>
        </Pressable>
      ))}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button label="Добавить аккаунт" onPress={() => router.push('/login')} />
      {state.status === 'in' ? <Button label="Выйти из текущего" onPress={signOut} danger /> : null}
    </Section>
  );
}

function Radar() {
  const { radarEnabled, radarDay, radarTime } = useSettings();
  const [time, setTime] = useState(radarTime);
  const [note, setNote] = useState('');
  const toggle = async (on: boolean) => {
    setNote('');
    settings.set({ radarEnabled: on });
    if (!on) return;
    rearmRadar();
    if (!(await askNotifications())) setNote('Без разрешения на уведомления радар соберётся, но сообщить о нём не сможет. Разреши их в настройках телефона.');
  };
  const pickDay = (day: number) => {
    settings.set({ radarDay: day });
    rearmRadar();
  };
  const applyTime = () => {
    if (isRadarTime(time)) {
      settings.set({ radarTime: time });
      rearmRadar();
    } else setTime(radarTime);
  };
  return (
    <Section title="Радар релизов">
      <Toggle label="Присылать уведомление о новом выпуске" value={radarEnabled} onChange={(on) => void toggle(on)} />
      <View style={styles.chips}>
        {DAYS.map((day) => <Chip key={day.id} label={day.label} on={radarDay === day.id} onPress={() => pickDay(day.id)} />)}
      </View>
      <TextInput
        style={styles.input}
        value={time}
        onChangeText={setTime}
        onBlur={applyTime}
        onSubmitEditing={applyTime}
        placeholder="09:00"
        placeholderTextColor={theme.muted}
        keyboardType="numbers-and-punctuation"
        maxLength={5}
      />
      <Text style={styles.muted}>
        Выпуск собирается в фоне по подпискам и любимым аккаунтам в выбранный день после этого часа (время телефона). Система сама решает, когда
        запустить фоновую задачу, поэтому уведомление может прийти позже. Если телефон был выключен, выпуск соберётся при открытии приложения.
      </Text>
      {note ? <Text style={styles.error}>{note}</Text> : null}
    </Section>
  );
}

function Webhook() {
  const { webhookEnabled, webhookUrl, webhookPercent } = useSettings();
  const [url, setUrl] = useState(webhookUrl);
  const [percent, setPercent] = useState(String(webhookPercent));
  const [error, setError] = useState('');
  const applyUrl = () => {
    if (!url || isWebhookUrl(url)) {
      setError('');
      settings.set({ webhookUrl: url });
    } else setError('Нужен адрес вида https://… или http://…');
  };
  const applyPercent = () => {
    const value = Number(percent);
    settings.set({ webhookPercent: Number.isFinite(value) ? value : webhookPercent });
    setPercent(String(settings.getSnapshot().webhookPercent));
  };
  return (
    <Section title="Вебхук">
      <Toggle label="Отправлять прослушанное на адрес" value={webhookEnabled} onChange={(on) => settings.set({ webhookEnabled: on })} />
      <TextInput
        style={styles.input}
        value={url}
        onChangeText={setUrl}
        onBlur={applyUrl}
        onSubmitEditing={applyUrl}
        placeholder="https://example.com/hook"
        placeholderTextColor={theme.muted}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.inline}>
        <Text style={styles.label}>Доля трека, %</Text>
        <TextInput
          style={[styles.input, styles.small]}
          value={percent}
          onChangeText={setPercent}
          onBlur={applyPercent}
          onSubmitEditing={applyPercent}
          keyboardType="number-pad"
          maxLength={3}
        />
      </View>
      <Text style={styles.muted}>
        POST с JSON: время, артист, трек, длина, ссылка и обложка. Уходит при смене трека, если прослушана эта доля. В инкогнито не отправляется.
      </Text>
    </Section>
  );
}

function Backup() {
  const [text, setText] = useState('');
  const [result, setResult] = useState('');
  const send = (message: string) => void Share.share({ message }).catch(() => undefined);
  const restore = () => {
    Alert.alert('Восстановить из копии?', 'Настройки, отметки и «убрать из вкуса» будут заменены. Журнал прослушиваний не меняется.', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Восстановить',
        style: 'destructive',
        onPress: () => void importBackup(text).then((outcome) => {
          setResult(outcome === 'ok' ? 'Готово. Перезапусти приложение, чтобы всё встало на место.' : BACKUP_ERRORS[outcome]);
          if (outcome === 'ok') setText('');
        }),
      },
    ]);
  };
  return (
    <Section title="Резервная копия">
      <Button label="Поделиться копией" onPress={() => send(exportBackup())} />
      <TextInput
        style={[styles.input, styles.area]}
        value={text}
        onChangeText={setText}
        placeholder="Вставь сюда текст копии"
        placeholderTextColor={theme.muted}
        multiline
        autoCapitalize="none"
        autoCorrect={false}
      />
      {text.trim() ? <Button label="Восстановить из текста" onPress={restore} /> : null}
      {result ? <Text style={styles.muted}>{result}</Text> : null}
      <Text style={styles.muted}>
        В копии настройки, отметки «Не нравится», убранное из вкуса, режим волны и «Моя музыка». Журнал прослушиваний не входит: вкус
        после переустановки строится заново по лайкам. В копии лежит адрес вебхука: не отправляй её посторонним.
      </Text>
    </Section>
  );
}

function Diagnostics() {
  const [count, setCount] = useState(diagnostics.entries().length);
  return (
    <Section title="Диагностика">
      <Text style={styles.muted}>Записей: {count}. В журнале запуски, предупреждения и ошибки приложения, радар. Адреса и ключи вырезаются.</Text>
      <Button label="Отправить журнал" onPress={() => { diagnostics.flush(); void Share.share({ message: diagnosticsText() }).catch(() => undefined); }} />
      <Button label="Очистить журнал" onPress={() => { diagnostics.clear(); setCount(0); }} danger />
    </Section>
  );
}

function Content() {
  const { language, incognito } = useSettings();
  const marks = useMarks();
  const count = Object.keys(marks.tracks).length + Object.keys(marks.artists).length;
  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Accounts />
      <Section title="Язык подписей">
        <View style={styles.chips}>
          <Chip label="Русский" on={language === 'ru'} onPress={() => settings.set({ language: 'ru' })} />
          <Chip label="English" on={language === 'en'} onPress={() => settings.set({ language: 'en' })} />
        </View>
        <Text style={styles.muted}>Причины треков, подборки, радар и уведомления. Действует после перезапуска приложения; остальные экраны пока только на русском.</Text>
      </Section>
      <Section title="Инкогнито">
        <Toggle label="Не записывать прослушивания" value={incognito} onChange={(on) => settings.set({ incognito: on })} />
        <Text style={styles.muted}>Журнал и вкус не пополняются, вебхук молчит. Волна учится на пропусках только внутри текущей сессии.</Text>
      </Section>
      <Radar />
      <Webhook />
      <Section title="Отметки">
        <Pressable style={styles.row} onPress={() => router.push('/marks')}>
          <Text style={styles.label}>«Не нравится» и скрытые артисты</Text>
          <Text style={styles.muted}>{count} ›</Text>
        </Pressable>
      </Section>
      <Backup />
      <Diagnostics />
    </ScrollView>
  );
}

export default function SettingsScreen() {
  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back}>
        <Text style={styles.link}>Назад</Text>
      </Pressable>
      <Text style={styles.title}>Настройки</Text>
      <Content />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  back: { paddingHorizontal: 16, paddingVertical: 12, alignSelf: 'flex-start' },
  link: { color: theme.accent, fontSize: 15 },
  title: { color: theme.text, fontSize: 22, fontWeight: '700', paddingHorizontal: 16, paddingBottom: 8 },
  content: { paddingBottom: 48 },
  section: { paddingHorizontal: 16, paddingTop: 20, gap: 10 },
  heading: { color: theme.text, fontSize: 18, fontWeight: '700' },
  label: { color: theme.text, fontSize: 15, flexShrink: 1 },
  muted: { color: theme.muted, fontSize: 13, lineHeight: 18 },
  error: { color: '#ff6b6b', fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 8 },
  toggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  inline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 18, backgroundColor: theme.surface },
  chipOn: { backgroundColor: theme.accent },
  chipText: { color: theme.muted, fontSize: 15 },
  chipTextOn: { color: '#fff', fontWeight: '600' },
  input: { backgroundColor: theme.surface, color: theme.text, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15 },
  small: { width: 80, textAlign: 'center' },
  area: { minHeight: 90, textAlignVertical: 'top' },
  button: { backgroundColor: theme.surface, borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  buttonText: { color: theme.accent, fontSize: 15, fontWeight: '600' },
  danger: { color: '#ff6b6b' },
});
