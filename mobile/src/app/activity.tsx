import { useMemo, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { auth } from '../auth/instance';
import { Loadable, RequireAuth } from '../components/Loadable';
import { buildActivity, hoursText, type Activity, type ActivityBar, type Bucket } from '../core/activity';
import type { TastePlay } from '../core/historyTypes';
import { artwork } from '../player/format';
import { theme } from '../theme';
import { Icon, type IconName } from '../ui/Icon';
import { Chip, ScreenHeader } from '../ui/kit';
import { useLoad } from '../ui/useLoad';
import { DAY, history } from '../wave/data';

const PERIODS = [
  { id: 'week', label: 'Неделя', days: 7, bucket: 'day', noun: 'за неделю' },
  { id: 'month', label: 'Месяц', days: 30, bucket: 'day', noun: 'за 30 дней' },
  { id: 'year', label: 'Год', days: 12, bucket: 'month', noun: 'за год' },
] as const satisfies ReadonlyArray<{ id: string; label: string; days: number; bucket: Bucket; noun: string }>;

const WEEKDAYS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const GENRE_COLORS = ['#ff5500', '#ff2d8f', '#7b2ff7', '#18c9c0', '#ffb454'];

/** Начало периода: день N дней назад или первое число месяца 11 месяцев назад */
function periodFrom(period: (typeof PERIODS)[number], now: number): number {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  if (period.bucket === 'month') {
    date.setDate(1);
    date.setMonth(date.getMonth() - (period.days - 1));
  } else date.setDate(date.getDate() - (period.days - 1));
  return date.getTime();
}

function Stat({ icon, value, label }: { icon: IconName; value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <Icon name={icon} size={18} color={theme.accent} />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function heatColor(share: number): string {
  if (share <= 0) return '#ffffff12';
  if (share < 0.25) return '#ff550044';
  if (share < 0.5) return '#ff550088';
  if (share < 0.75) return '#ff5500cc';
  return theme.accent;
}

/** Сетка дней как вклад вклада на GitHub: понедельник сверху, недели столбцами */
function Heatmap({ days }: { days: ActivityBar[] }) {
  const max = Math.max(...days.map((day) => day.ms), 1);
  const first = days[0];
  if (!first) return null;
  const pad = (new Date(first.start).getDay() + 6) % 7;
  const cells: Array<ActivityBar | null> = [...Array(pad).fill(null), ...days];
  while (cells.length % 7) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
  return (
    <View>
      <View style={styles.heat}>
        {weeks.map((week, w) => (
          <View key={w} style={styles.heatWeek}>
            {week.map((day, d) => (
              <View key={d} style={[styles.heatCell, { backgroundColor: heatColor(day ? day.ms / max : 0) }]} />
            ))}
          </View>
        ))}
      </View>
      <View style={styles.heatLegend}>
        <Text style={styles.barLabel}>меньше</Text>
        {[0, 0.2, 0.45, 0.7, 1].map((n) => <View key={n} style={[styles.heatDot, { backgroundColor: heatColor(n) }]} />)}
        <Text style={styles.barLabel}>больше</Text>
      </View>
    </View>
  );
}

function Bars({ activity, bucket }: { activity: Activity; bucket: Bucket }) {
  const max = Math.max(...activity.bars.map((bar) => bar.ms), 1);
  const dense = activity.bars.length > 12;
  return (
    <View>
      <View style={styles.bars}>
        {activity.bars.map((bar) => {
          const best = activity.best?.start === bar.start && bar.ms > 0;
          return (
            <View key={bar.start} style={styles.barSlot}>
              <View style={[styles.bar, dense && styles.barDense, { height: Math.max(4, (bar.ms / max) * 120) }, bar.ms ? (best ? styles.barBest : styles.barOn) : styles.barOff]} />
            </View>
          );
        })}
      </View>
      <View style={styles.barLabels}>
        {activity.bars.map((bar, i) => {
          const date = new Date(bar.start);
          const label = bucket === 'month' ? MONTHS_SHORT[date.getMonth()] : dense ? (i % 5 === 0 ? String(date.getDate()) : '') : WEEKDAYS[date.getDay()];
          return <Text key={bar.start} style={styles.barLabel} numberOfLines={1}>{label}</Text>;
        })}
      </View>
    </View>
  );
}

function Content({ plays }: { plays: TastePlay[] }) {
  const [periodId, setPeriodId] = useState<(typeof PERIODS)[number]['id']>('week');
  const period = PERIODS.find((item) => item.id === periodId) ?? PERIODS[0];
  const activity = useMemo(() => {
    const now = Date.now();
    return buildActivity(plays, periodFrom(period, now), now, period.bucket);
  }, [plays, period]);
  const empty = activity.totalMs === 0;
  const bestDate = activity.best ? new Date(activity.best.start) : null;

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.chips}>
        {PERIODS.map((item) => <Chip key={item.id} label={item.label} on={item.id === periodId} onPress={() => setPeriodId(item.id)} />)}
      </View>

      <View style={styles.hero}>
        <View style={styles.glow} />
        <Text style={styles.heroLabel}>Ты слушал {period.noun}</Text>
        <Text style={styles.heroValue}>{hoursText(activity.totalMs)}</Text>
        <View style={styles.stats}>
          <Stat icon="headphones" value={String(activity.plays)} label="прослушиваний" />
          <Stat icon="music" value={String(activity.tracks)} label="треков" />
          <Stat icon="person" value={String(activity.artists)} label="артистов" />
        </View>
      </View>

      {empty ? (
        <Text style={styles.empty}>Пока пусто: включи музыку, и здесь появятся часы, жанры и любимые артисты</Text>
      ) : (
        <>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Когда ты слушал</Text>
            {period.bucket === 'month' ? <Heatmap days={activity.days} /> : <Bars activity={activity} bucket={period.bucket} />}
            <View style={styles.streakRow}>
              <View style={styles.streak}>
                <Icon name="bolt" size={18} color={theme.warn} />
                <Text style={styles.streakText}>Серия: {activity.streak} дн.</Text>
              </View>
              <Text style={styles.muted}>
                {bestDate && activity.best ? `Рекорд: ${hoursText(activity.best.ms)}, ${period.bucket === 'month' ? MONTHS_SHORT[bestDate.getMonth()] : `${bestDate.getDate()} ${MONTHS[bestDate.getMonth()]}`}` : ''}
              </Text>
            </View>
          </View>

          {activity.genres.length ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Жанры</Text>
              {activity.genres.map((genre, i) => (
                <View key={genre.key} style={styles.genre}>
                  <View style={styles.genreHead}>
                    <View style={[styles.dot, { backgroundColor: GENRE_COLORS[i % GENRE_COLORS.length] }]} />
                    <Text style={styles.genreName} numberOfLines={1}>{genre.label}</Text>
                    <Text style={styles.genreTime}>{hoursText(genre.ms)}</Text>
                    <Text style={styles.genrePct}>{Math.round(genre.share * 100)}%</Text>
                  </View>
                  <View style={styles.track}>
                    <View style={[styles.fill, { width: `${Math.max(3, genre.share * 100)}%`, backgroundColor: GENRE_COLORS[i % GENRE_COLORS.length] }]} />
                  </View>
                </View>
              ))}
            </View>
          ) : null}

          {activity.topArtists.length ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Любимые артисты</Text>
              {activity.topArtists.map((artist, i) => {
                const cover = artwork(artist.artwork);
                return (
                  <View key={artist.id} style={styles.row}>
                    <Text style={styles.rank}>{i + 1}</Text>
                    {cover ? <Image source={{ uri: cover }} style={[styles.cover, styles.round]} /> : <View style={[styles.cover, styles.round, styles.noCover]}><Icon name="person" size={20} color={theme.muted} /></View>}
                    <View style={styles.rowText}>
                      <Text style={styles.name} numberOfLines={1}>{artist.name || 'Без названия'}</Text>
                      <Text style={styles.muted}>{hoursText(artist.ms)}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          ) : null}

          {activity.topTracks.length ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Часто переслушиваешь</Text>
              {activity.topTracks.map((track, i) => {
                const cover = artwork(track.artwork);
                return (
                  <View key={track.id} style={styles.row}>
                    <Text style={styles.rank}>{i + 1}</Text>
                    {cover ? <Image source={{ uri: cover }} style={styles.cover} /> : <View style={[styles.cover, styles.noCover]}><Icon name="music" size={20} color={theme.muted} /></View>}
                    <View style={styles.rowText}>
                      <Text style={styles.name} numberOfLines={1}>{track.title || 'Без названия'}</Text>
                      <Text style={styles.muted} numberOfLines={1}>{track.artist}</Text>
                    </View>
                    <Text style={styles.times}>×{track.plays}</Text>
                  </View>
                );
              })}
            </View>
          ) : null}
          <Text style={styles.foot}>Считается по журналу этого телефона. В режиме «Инкогнито» прослушивания не записываются.</Text>
        </>
      )}
    </ScrollView>
  );
}

function ActivityBody() {
  const user = auth.getState().session?.user.id ?? 0;
  const { data, error, reload } = useLoad(() => history.tastePlays(user, Date.now() - 366 * DAY), [user]);
  return (
    <Loadable ready={!!data} error={error} onRetry={reload}>
      <Content plays={data ?? []} />
    </Loadable>
  );
}

export default function ActivityScreen() {
  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScreenHeader title="Активность" />
      <RequireAuth>
        <ActivityBody />
      </RequireAuth>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  content: { paddingHorizontal: 16, paddingBottom: 40, gap: 14 },
  chips: { flexDirection: 'row', gap: 8 },
  hero: { backgroundColor: theme.surface, borderRadius: 28, padding: 22, gap: 6, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border },
  glow: { position: 'absolute', right: -70, top: -90, width: 240, height: 240, borderRadius: 120, backgroundColor: theme.accent, opacity: 0.22 },
  heroLabel: { color: theme.muted, fontSize: 14 },
  heroValue: { color: theme.text, fontSize: 38, fontWeight: '800', letterSpacing: -0.5 },
  stats: { flexDirection: 'row', gap: 10, marginTop: 14 },
  stat: { flex: 1, backgroundColor: '#ffffff0d', borderRadius: 16, paddingVertical: 12, paddingHorizontal: 12, gap: 2 },
  statValue: { color: theme.text, fontSize: 20, fontWeight: '800', marginTop: 4 },
  statLabel: { color: theme.muted, fontSize: 12 },
  empty: { color: theme.muted, fontSize: 14, lineHeight: 20, textAlign: 'center', paddingHorizontal: 24, paddingTop: 24 },
  card: { backgroundColor: theme.surface, borderRadius: 24, padding: 18, gap: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border },
  cardTitle: { color: theme.text, fontSize: 17, fontWeight: '800' },
  bars: { flexDirection: 'row', alignItems: 'flex-end', height: 124 },
  barSlot: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  bar: { width: '58%', maxWidth: 28, borderRadius: 8 },
  barDense: { width: '60%', maxWidth: 8, borderRadius: 3 },
  barOn: { backgroundColor: '#ff550080' },
  barBest: { backgroundColor: theme.accent },
  barOff: { backgroundColor: '#ffffff14' },
  barLabels: { flexDirection: 'row', marginTop: 8 },
  barLabel: { flex: 1, color: theme.muted, fontSize: 10, textAlign: 'center' },
  heat: { flexDirection: 'row', gap: 2 },
  heatWeek: { flex: 1, gap: 2 },
  heatCell: { width: '100%', aspectRatio: 1, borderRadius: 2 },
  heatDot: { width: 10, height: 10, borderRadius: 2 },
  heatLegend: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginTop: 10 },
  streakRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  streak: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#ffb4541f', borderRadius: 14, paddingVertical: 6, paddingHorizontal: 10 },
  streakText: { color: theme.warn, fontSize: 13, fontWeight: '700' },
  muted: { color: theme.muted, fontSize: 13 },
  genre: { gap: 8 },
  genreHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  genreName: { flex: 1, color: theme.text, fontSize: 15, fontWeight: '600' },
  genreTime: { color: theme.muted, fontSize: 13 },
  genrePct: { color: theme.text, fontSize: 14, fontWeight: '800', width: 42, textAlign: 'right' },
  track: { height: 8, borderRadius: 4, backgroundColor: '#ffffff12', overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rank: { color: theme.muted, width: 18, fontSize: 14, fontWeight: '700', textAlign: 'center' },
  cover: { width: 48, height: 48, borderRadius: 12, backgroundColor: theme.surfaceHigh },
  round: { borderRadius: 24 },
  noCover: { alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, gap: 2 },
  name: { color: theme.text, fontSize: 15, fontWeight: '600' },
  times: { color: theme.accentBright, fontSize: 14, fontWeight: '800' },
  foot: { color: theme.muted, fontSize: 12, lineHeight: 17, textAlign: 'center', paddingHorizontal: 12 },
});
