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
- Этап 2: готов. Что есть:
  - `src/api`: клиент api-v2 (`client.ts`) с диспетчером из `core/pageSources`, ключом клиента и токеном, повтором после
    401 с новым `client_id` и тайм-аутом; таблица эндпоинтов (`endpoints.ts`); `client_id` берётся обычным GET
    `https://soundcloud.com/` с User-Agent настольного браузера (`clientId.ts`); методы `me`, `likedIds`, `tracksByIds`,
    `searchTracks`, `relatedTracks`, `resolve` (`soundcloud.ts`).
  - `src/auth`: вход в WebView на `soundcloud.com/signin` с настольным User-Agent и скриптом, который ловит токен
    из заголовка Authorization запросов к api-v2, из cookie `oauth_token` и `client_id` из hydration (`loginScript.ts`);
    ручной ввод токена как запасной путь; проверка токена запросом `/me`; хранение в `expo-secure-store`.
  - Экраны: главная показывает лайки после входа, `/login` вход.
  - Проверено 12.10.2026 без входа: публичные эндпоинты отвечают 200, `/me`, `/me/track_likes/ids`,
    `/me/play-history/tracks`, `/me/playlist_likes/ids` отвечают 401.
  - Не проверено на реальном аккаунте и устройстве: поймает ли скрипт токен при входе, работает ли вход через Google
    в WebView (Google может блокировать встроенные браузеры; тогда запасной путь по токену).
  - Для этапа 3: у части треков нет открытого AAC. У трека из проверки были `hls audio/mpeg` и `progressive audio/mpeg`,
    а AAC только с шифрованием (`cbc/ctr-encrypted-hls`). Выбор потока: progressive mp3, потом hls mp3, потом hls AAC,
    шифрованное только как «недоступно».
- Этап 3: готов. Что есть:
  - Движок: `expo-audio` (ExoPlayer), один плеер на приложение, фон через сервис `mediaPlayback` и управление с экрана
    блокировки (`expoEngine.ts`). Выбран вместо `react-native-track-player`: тот не обновлялся с августа 2025, до RN 0.82+
    с одной новой архитектурой, и совместимость с RN 0.86 нельзя проверить без Android SDK. Ограничение `expo-audio`:
    в шторке пауза и перемотка на 10 с, кнопок «дальше»/«назад» нет (в приложении они есть).
  - `src/player`: `stream.ts` (выбор потока: progressive mp3, hls mp3, hls AAC, потом отрывки; шифрованные без открытых
    потоков это «недоступно»), `queue.ts` (очередь, повтор), `controller.ts` (переходы, пропуск недоступных, повтор
    запроса потока при ошибке, подготовка следующего трека, сохранение сессии), `session.ts` (снимок без потоков).
  - Экраны: мини-плеер на всех экранах, полный плеер (модально), очередь с переносом и удалением; лайки на главной
    запускают очередь с нажатого трека. Сессия восстанавливается после запуска на паузе.
  - Проверено на живом API 12.10.2026: у обычных треков progressive и hls mp3 отдают 206 на Range; у трека лейбла с
    шифрованным AAC оба открытых потока дают 404.
  - Не проверено на устройстве: звук, шторка, фоновая игра дольше 3 минут, разрешение на уведомления (Android 13+),
    ручной вход. Манифест после `expo prebuild` проверен: `FOREGROUND_SERVICE_MEDIA_PLAYBACK`, `AudioControlsService`,
    `POST_NOTIFICATIONS`, без `RECORD_AUDIO`.
  - CI: сборка APK для этапов 0 и 1 в Actions прошла. Проверка desktop-репозитория (`windows.yml`) падала из-за
    `.md` в `mobile/`: `check:repo` теперь допускает `mobile/*.md`, а `windows.yml` не запускается на изменениях только
    в `mobile/`.
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
