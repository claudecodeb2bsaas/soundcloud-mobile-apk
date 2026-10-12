# SoundCloud Wave: мобильный клиент (Android)

Нативный клиент на Expo (React Native, TypeScript, Expo Router). Вход через WebView на soundcloud.com,
данные из api-v2, звук через react-native-track-player (HLS). Логика «Моей волны» переносится из
desktop-клиента (`../src/services`), чистые модули копируются в `src/core`.

## Что переносим из desktop

| Desktop | Мобильный клиент |
|---|---|
| Плеер сайта (webpack-хук) | react-native-track-player, очередь своя |
| `callEndpoint` сайта | свой клиент api-v2 с токеном из входа |
| `node:sqlite` (история, рекомендации) | `expo-sqlite` |
| `wave.ts` в DOM страницы | экраны React Native + `src/core` |
| Радар релизов | `radar.ts` + фоновая задача и уведомление |
| Адблок, Discord RPC, thumbar, GPU, автообновление | не нужны |

## Этапы

0. Каркас Expo и сборка APK в GitHub Actions.
1. `src/core`: типы, трек-идентичность, жанры, настроение, вкус, подбор, диспетчер запросов, i18n.
2. Вход и API-клиент.
3. Плеер: HLS, очередь, фон, уведомление, сохранение сессии.
4. Экраны: главная, поиск, библиотека, артист, очередь.
5. «Моя волна».
6. Вкус и история (SQLite), «Моя музыка».
7. Радар релизов и подборки дня.
8. Настройки и «аддоны»: язык, аккаунты, инкогнито, вебхуки, резервная копия, диагностика.
9. Полировка: плавный переход, DRM-треки, Android Auto, подпись APK, релиз.

## Статус

- Этап 0: готов.
- Этап 1: готов. В `src/core` скопированы без правок логики: `waveTypes`, `trackIdentity`, `waveGenres`, `waveMood`,
  `waveLinks`, `wavePicks`, `waveTaste`, `waveTexts`, `tasteParams`, `libraryMix`, `pageSources`, `wave/sources`
  и их тесты (93 теста). `src/core/wave.ts` это фасад с теми же реэкспортами, что у desktop-файла `wave.ts`.
  Правки относительно desktop: типы `WaveTrack` в `trackIdentity` берутся из `waveTypes`, путь фикстуры в тесте.
  Синхронизация с desktop пока ручная; общий пакет вынесем позже.
  Не перенесено сознательно: `radar`, `radarSchedule`, `tasteModel`, `historyIndex`, `recommendStore` (нужно хранилище,
  этапы 6–7), `wave/quiet` (этап 9), всё, что работает с DOM страницы.
- Проверить на устройстве (Hermes): регулярки `\p{L}`, `\p{Script=Cyrillic}` в `waveGenres` и `trackIdentity`,
  `Intl.PluralRules` в `waveTexts`.

## Риски

- api-v2 не документирован, `client_id` меняется, возможны 429.
- Треки с Widevine (`ctr-encrypted-hls`) на старте помечаются недоступными.
- Плавный переход и тихие края требуют отдельной реализации (два плеера).

## Сборка

Локально нужен JDK 17 и Android SDK. Без них APK собирает GitHub Actions
(`.github/workflows/android-apk.yml`), файл лежит в Artifacts запуска.

```
cd mobile
npm ci
npm run typecheck
npm test
```
