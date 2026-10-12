<div align="center">

# SoundCloud Mobile

**Android-клиент SoundCloud со своей «Моей волной», умными рекомендациями, фоновым плеером и шторкой уведомлений.**

[![Android APK](https://github.com/claudecodeb2bsaas/soundcloud-mobile-apk/actions/workflows/android-apk.yml/badge.svg)](https://github.com/claudecodeb2bsaas/soundcloud-mobile-apk/actions/workflows/android-apk.yml)
[![Releases](https://img.shields.io/github/v/release/claudecodeb2bsaas/soundcloud-mobile-apk?filter=mobile-v*&label=release)](https://github.com/claudecodeb2bsaas/soundcloud-mobile-apk/releases)

[Возможности](#возможности) · [Где скачать APK](#где-скачать-apk) · [Разработка](#разработка-и-локальный-запуск) · [Структура](#структура-репозитория)

</div>

## О приложении

Мобильный клиент SoundCloud на Expo / React Native. Всё, что делает «умным» — волна, модель вкуса, история и радар релизов, — работает на устройстве и хранится в локальной SQLite. Музыка играет в фоне, управление доступно из шторки уведомлений и с экрана блокировки.

## Возможности

- **Моя волна** — бесконечная лента под ваш вкус:
  - настроения (весёлое, грустное, агрессивное, спокойное, энергичное);
  - серии пропусков — волна замечает, что вы пролистываете подряд, и меняет курс;
  - развилки — выбор направления, когда вкус можно повести в разные стороны;
  - фильтр артистов — исключайте исполнителей, которых не хотите слышать.
- **Локальная база SQLite** — модель вкуса, история прослушиваний, отметки; данные не покидают устройство.
- **Радар релизов** — раз в неделю (день и время настраиваются) проверяет новинки любимых артистов и присылает фоновые уведомления.
- **Мультиаккаунт** — несколько аккаунтов SoundCloud, вход через WebView, токены в `expo-secure-store`.
- **Фоновый плеер** — `expo-audio`, очередь, мини-плеер, управление из шторки.
- **Резервные копии** — экспорт и импорт настроек, вкуса и истории одним файлом.
- **Вебхуки** — POST на ваш URL, когда трек прослушан на заданный процент (режим инкогнито отключает отправку).
- **Диагностика** — журнал для разбора проблем, секреты вырезаются.
- **Языки** — русский и английский.

## Где скачать APK

### Из Actions (каждая сборка из `main`)

1. Откройте репозиторий на GitHub → вкладка **Actions**.
2. Слева выберите workflow **Android APK**.
3. Откройте последний запуск с зелёной галочкой.
4. Прокрутите страницу вниз до блока **Artifacts** и скачайте **`soundcloud-wave-apk`** (ZIP).
5. Распакуйте архив — внутри файл `.apk`.
6. Скопируйте `.apk` на телефон и откройте его. Если Android попросит, разрешите установку из неизвестных источников для вашего файлового менеджера или браузера.

> Скачивать артефакты могут только авторизованные пользователи GitHub. Артефакты хранятся ограниченное время (по умолчанию 90 дней).

### Из Releases (стабильные версии)

Подписанные релизные APK публикуются в разделе [**Releases**](https://github.com/claudecodeb2bsaas/soundcloud-mobile-apk/releases) при пуше тега `mobile-vX.Y.Z`:

```bash
git tag mobile-v0.1.0
git push origin mobile-v0.1.0
```

Для релиза в Settings → Secrets репозитория должны быть заданы `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. Перед новым релизом поднимите `version` и `android.versionCode` в `mobile/app.json`.

## Разработка и локальный запуск

Нужны Node.js 24+ и Android-устройство или эмулятор. Приложение использует нативные модули, поэтому Expo Go не подойдёт — нужна development-сборка.

```bash
cd mobile
npm install

npx expo start          # dev-сервер
npm run android         # сборка и запуск на устройстве/эмуляторе (expo run:android)

npm run typecheck       # tsc --noEmit
npm test                # vitest
npx expo export --platform android   # проверка бандла
```

Папка `mobile/android` генерируется командой `expo prebuild` и не хранится в git — нативные настройки меняйте в `mobile/app.json` и config-плагинах.

## Структура репозитория

```text
.github/workflows/android-apk.yml   сборка APK, артефакты и релизы
mobile/
  src/app/        экраны (Expo Router)
  src/wave/       движок волны, радар, модель вкуса
  src/core/       чистая логика: жанры, настроения, источники
  src/api/        клиент SoundCloud API
  src/player/     плеер и очередь
  src/store/      SQLite
  src/addons/     резервные копии, вебхуки, диагностика
  plugins/        config-плагины Expo (подпись релиза)
```

## Лицензия

[MIT](LICENSE)
