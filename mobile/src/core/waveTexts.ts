// Тексты волны и то, как показать: подстановка, причина, число со словом, время, местные сутки, форма звуковой волны.
// Функции уходят на страницу текстом вместе с волной (pageHelpers в wave.ts), поэтому не ссылаются на импорты и константы
// модуля. WAVE_TEXTS идёт на страницу в настройках скрипта
import type { WaveReason, WaveTexts } from './waveTypes';

export const WAVE_TEXTS: Record<'ru' | 'en', WaveTexts> = {
    ru: {
        wave: 'Моя волна', similar: 'Похожее', fresh: 'Новое', anyGenre: 'Любой жанр', genreInput: 'Жанры через запятую', fromLikes: 'Из твоих лайков',
        hintSimilar: 'Похоже на то, что ты слушаешь и лайкаешь', hintFresh: 'Треки в твоём вкусе, которых ты ещё не слышал', hintGenre: ', в жанре {genre}',
        hintGenres: ', в жанрах {genre}',
        idleSimilar: 'Начнётся с похожего на {seed}', idleSimilarAny: 'Начнётся с похожего на твои лайки', idleFresh: 'Начнётся с треков, которых ты ещё не слышал',
        idleGenre: 'Начнётся со свежего в жанре {genre}',
        whySimilar: 'Похоже на {seed}', whyFresh: 'Новое для тебя, похоже на {seed}', whyNewArtist: 'Новый для тебя артист', whyGenreFresh: 'Свежее в жанре {genre}',
        whyGenrePopular: 'Популярное в жанре {genre}', whyGenreSimilar: '{genre}, похоже на {seed}',
        loading: 'Подбираю треки…', emptyFresh: 'Не нашлось треков, которых ты ещё не слышал', emptyFreshGenre: 'Не нашлось треков {genre}, которых ты ещё не слышал',
        emptyGenre: 'Не нашлось треков в жанре {genre}', emptySimilar: 'Не нашлось похожих треков: волне нужны лайки или история прослушивания',
        dropGenre: 'Любой жанр', toSimilar: 'Включить Похожее', play: 'Включить волну', pause: 'Пауза', clearGenre: 'Убрать жанр',
        upFirst: 'Первыми сыграют', next: 'Далее', like: 'Нравится', error: 'Не удалось подобрать треки, SoundCloud не ответил', retry: 'Повторить',
        unavailable: 'Плеер SoundCloud ещё не готов',
        whySeedTrack: 'С него началась волна', whyArtistTrack: 'Из треков {artist}', whyMood: 'В духе {seed}: {genre}',
        whyRestored: 'Из сохранённой очереди',
        seedTrack: 'Волна по треку {seed}', seedArtist: 'Волна по артисту {seed}', seedPlaylist: 'Волна по плейлисту {seed}',
        clearSeed: 'Вернуть обычную волну', emptySeed: 'Не нашлось похожих треков',
        menuWaveTrack: 'Волна по треку', menuWaveArtist: 'Волна по артисту', menuWavePlaylist: 'Волна по плейлисту',
        menuDislike: 'Не нравится', menuUndislike: 'Вернуть в волну', menuHideArtist: 'Не показывать аккаунт', menuShowArtist: 'Показывать аккаунт',
        toastDisliked: 'Трек больше не попадёт в волну', toastUndisliked: 'Трек снова может попасть в волну',
        toastHidden: 'Аккаунт больше не попадёт в волну и радар', toastShown: 'Аккаунт снова может попасть в волну',
        toastFailed: 'Не получилось: SoundCloud не ответил', toastNotSaved: 'Отметка не сохранилась', toastEmpty: 'Не нашлось похожих треков',
        shake: 'Встряхнуть', history: 'История, Ctrl+H',
        whyTasteArtist: 'Ты любишь {artist}', whyTasteTag: 'Любимый жанр: {genre}',
        more: 'Больше такого', later: 'Не сейчас', menuUnmore: 'Отменить «Больше такого»', menuUnlater: 'Вернуть в волну',
        toastMore: 'Волна подберёт больше такого', toastUnmore: 'Отметка «Больше такого» снята',
        toastLater: 'Трек не попадёт в волну неделю', toastLaterArtist: 'Артист не попадёт в волну неделю', toastUnlater: 'Снова может попасть в волну',
        lang: 'ru', shelf: 'Подборки', shelfDaily: 'Разведка', shelfForgotten: 'Давно не слушал', shelfEmpty: 'Подборкам нужны твои лайки',
        shelfFailed: 'Подборки не загрузились',
        tracksCount: 'трек|трека|треков', groupAnd: '{a} и {b}',
        whyDaily: 'Разведка: ещё не звучало у тебя', whyForgotten: 'Из твоих лайков, давно не звучал', whyGroup: 'Твой вкус: {name}',
        seedDaily: 'Разведка: новое для тебя по 20 секунд с самого яркого места', seedForgotten: 'Лайки, которые давно не звучали',
        seedGroup: 'Твой вкус: {seed}', seedTracks: 'Волна по набору: {seed}',
        menuPick: 'Добавить в набор', menuUnpick: 'Убрать из набора', toastPicked: 'В наборе {count}', toastUnpicked: 'Трек убран из набора',
        toastPickFull: 'В наборе уже {count}', pickStart: 'Включить волну по набору', pickClear: 'Очистить набор',
        mixPlay: 'Слушать подборку', rowPlay: 'Слушать: {title}', mixClose: 'Свернуть', mixLoading: 'Загружаю треки', mixFailed: 'Треки не загрузились, нажми на карточку ещё раз',
        mixEmpty: 'Все треки подборки ты убрал из волны',
        whyVersion: 'Другая версия {seed}',
        radar: 'Радар релизов', radarUploads: 'Новые загрузки',
        radarFans: 'Ремиксы и эдиты', radarFansHint: 'Перезаливы, ремиксы и эдиты чужих песен с каналов не из подписок. В 50 релизов они не входят',
        radarUploadsHint: 'Свежие публикации без доказанной даты релиза: перезаливы и сборные каналы. В 50 релизов они не входят',
        radarHeard: 'Уже слышал', radarPartial: 'неполный', radarCoverage: 'Проверено источников: {checked} из {total}', radarComplete: 'Все источники проверены',
        radarEmptyWeek: 'За четыре недели новых релизов не нашлось', radarCollecting: 'Собираю выпуск', radarNoSession: 'Войди в SoundCloud, и радар соберётся',
        radarOffline: 'Нет сети, соберу, когда она вернётся', radarError: 'Выпуск не собрался, попробую позже', radarSoon: 'Первый выпуск скоро',
        radarFailed: 'Радар не загрузился', radarFound: 'Все найденные', radarAll: 'Все', radarReleases: 'Релизы', radarPosts: 'Загрузки',
        radarHideHeard: 'Без «Уже слышал»', radarAfter: 'После выпуска', radarRebuild: 'Пересобрать', radarBuildNow: 'Собрать сейчас',
        radarRebuilt: 'Выпуск пересобран, прежний остался в архиве', radarBuilt: 'Выпуск собран', radarWaiting: 'Каталог ещё собирается, выпуск выйдет позже',
        radarArchive: 'Архив выпусков', radarRevision: 'пересборка {n}', radarFoundEmpty: 'Больше ничего не нашлось', radarNoMatch: 'Под фильтр ничего не подходит',
        whyRadar: 'Радар релизов', whyRadarArtist: 'Новое у {name}', whyRadarFollow: 'Новое у {name}, ты подписан', whyRadarTag: 'Свежее в жанре {tag}',
        whyRadarTaste: 'Свежее в твоём вкусе',
        menuVersions: 'Версии этого трека', menuHideFamily: 'Скрыть другие версии', menuShowFamily: 'Показывать другие версии',
        toastFamilyHidden: 'Другие версии этой песни больше не попадут в волну и радар', toastFamilyShown: 'Другие версии снова могут попасть в волну',
        versionsTitle: 'Версии: {title}', versionsSame: 'Эта же запись', versionsOther: 'Другие версии', versionsLoading: 'Ищу версии…',
        versionsEmpty: 'Других версий не нашлось', versionsFailed: 'Поиск не удался: SoundCloud не ответил', versionsLink: 'Та же запись',
        versionsUnlink: 'Другая запись', versionsProbable: 'похоже на копию', versionsConfirmed: 'подтверждено', versionsThis: 'этот трек',
        toastLinked: 'Отмечено: та же запись', toastUnlinked: 'Отмечено: другая запись', dialogClose: 'Закрыть', radarPost: 'Новая загрузка',
        radarAlbum: 'Альбом · {n}', radarEp: 'EP · {n}', radarSingle: 'Сингл · {n}', radarCompilation: 'Сборник · {n}', radarGroupAll: 'Слушать все {n}',
        radarGroupQueued: 'Следующими в очереди: {count}',
        library: 'Моя музыка', libraryLikes: 'Лайки', libraryOrder: 'По порядку', libraryShuffle: 'Перемешать', librarySmart: 'Умное перемешивание',
        libraryOrderTip: 'Источники в том порядке, в каком выбраны: плейлисты как на сайте, лайки от новых к старым. Играет всё',
        libraryShuffleTip: 'Случайный порядок, один артист не идёт подряд. Слышанное за последние 3 дня не играет',
        librarySmartTip: 'Как «Перемешать», плюс после каждых трёх своих треков похожий, которого у тебя ещё нет',
        libraryPlay: 'Слушать мою музыку', libraryPick: 'Выбери лайки или плейлисты', libraryLoading: 'Загружаю плейлисты…',
        libraryFailed: 'Плейлисты не загрузились', libraryBuilding: 'Собираю треки…', libraryEmpty: 'В выбранном нечего играть',
        libraryList: 'Список треков', libraryMore: 'Показать ещё', libraryModes: 'Порядок',
        librarySources: 'Источники', libraryPlaying: 'Играет', libraryPaused: 'На паузе', libraryPlaylists: 'плейлист|плейлиста|плейлистов', libraryHere: 'Сейчас играет отсюда', libraryUnavailable: 'недоступен|недоступны|недоступны',
        libraryUnavailableTip: 'Отрывки Go+ и закрытое в твоей стране: целиком SoundCloud их не даёт',
        whyLibrary: 'Из плейлиста {name}', whyLibraryLikes: 'Из твоих лайков', seedLibrary: 'Моя музыка: {seed}',
        presets: 'Настроение', presetAll: 'Всё', moodHappy: 'Весёлое', moodSad: 'Грустное', moodAggressive: 'Агрессивное', moodCalm: 'Спокойное',
        moodEnergetic: 'Энергичное', hintPreset: ', настроение: {mood}', presetShort: 'Подходящего в твоём вкусе мало, добавляю ближайшее',
        whyMoodTag: 'Автор отметил: {tag}',
        undo: 'Отменить', toastLiked: 'Лайк: {title}', toastUnliked: 'Лайк снят: {title}',
        seedCollecting: 'Собираю волну от {title}', seedCollectingAny: 'Собираю волну…', seedCollectingArtist: 'Собираю треки {title}', seedCollectingArtistAny: 'Собираю треки артиста…',
        menuArtistAll: 'Все треки артиста', seedArtistAll: 'Все треки {seed}', menuQueueNext: 'Слушать следующим', menuQueueLast: 'В конец очереди',
        scoutTitle: 'Разведка', scoutCount: '{n} из {total}', scoutKeep: 'Оставить', scoutKept: 'Оставлено', scoutNext: 'Дальше', scoutExit: 'Выйти из разведки',
        // Дни недели с воскресенья, как Date.getDay: «утро четверга» и «ночь на четверг»
        momentNight: 'Ночь на {day}', momentMorning: 'Утро {day}', momentDay: 'День {day}', momentEvening: 'Вечер {day}',
        momentDaysOf: 'воскресенья,понедельника,вторника,среды,четверга,пятницы,субботы', momentDaysOn: 'воскресенье,понедельник,вторник,среду,четверг,пятницу,субботу',
        whyRelatedArtist: 'Похож на {artist}', whyScMix: 'Из подборки SoundCloud: {name}', whyNeighbors: 'Лайкают слушатели с похожим вкусом',
        shelfLiked: 'Лайкнули твои артисты', seedLiked: 'Что лайкают артисты, которых ты слушаешь', whyLikedBy: 'Лайк от {artist}', whyLikedAny: 'Лайк от артиста, которого ты слушаешь',
        traitLessCyr: 'Меньше русскоязычного в этой волне', traitLessInst: 'Меньше инструменталов в этой волне', traitLessGenre: 'Меньше жанра {genre} в этой волне',
        traitLessMarker: 'Меньше версий {marker} в этой волне', traitLessForeign: 'Меньше перезаливов с чужих каналов в этой волне',
        forkTitle: 'Куда дальше?', forkClose: 'Закрыть', forkCalm: 'Спокойнее', forkAway: 'Похоже, ищешь другое: варианты на главной',
        pinned: 'Закреплённое', menuPin: 'Закрепить на главной', menuUnpin: 'Открепить с главной', menuWaveGenre: 'Волна по жанру',
        toastPinned: 'Закреплено на главной: {title}', toastUnpinned: 'Откреплено: {title}', toastPinFull: 'На главной уже {count}, открепи что-нибудь',
        pinPlay: 'Волна: {title}', pinRemove: 'Открепить: {title}',
    },
    en: {
        wave: 'My Wave', similar: 'Similar', fresh: 'New', anyGenre: 'Any genre', genreInput: 'Genres, comma separated', fromLikes: 'From your likes',
        hintSimilar: 'Similar to what you play and like', hintFresh: 'Tracks in your taste you haven’t heard yet', hintGenre: ', in {genre}',
        hintGenres: ', in {genre}',
        idleSimilar: 'Starts with tracks similar to {seed}', idleSimilarAny: 'Starts with tracks similar to your likes', idleFresh: 'Starts with tracks you haven’t heard yet',
        idleGenre: 'Starts with fresh {genre}',
        whySimilar: 'Similar to {seed}', whyFresh: 'New to you, similar to {seed}', whyNewArtist: 'Artist new to you', whyGenreFresh: 'Fresh in {genre}',
        whyGenrePopular: 'Popular in {genre}', whyGenreSimilar: '{genre}, similar to {seed}',
        loading: 'Picking tracks…', emptyFresh: 'No tracks you haven’t heard yet', emptyFreshGenre: 'No {genre} tracks you haven’t heard yet',
        emptyGenre: 'No tracks in {genre}', emptySimilar: 'No similar tracks: the wave needs your likes or listening history',
        dropGenre: 'Any genre', toSimilar: 'Switch to Similar', play: 'Play wave', pause: 'Pause', clearGenre: 'Clear genre',
        upFirst: 'Up first', next: 'Next up', like: 'Like', error: 'Couldn’t pick tracks, SoundCloud didn’t respond', retry: 'Try again',
        unavailable: 'The SoundCloud player is not ready yet',
        whySeedTrack: 'Your wave starts here', whyArtistTrack: 'By {artist}', whyMood: 'In the vibe of {seed}: {genre}',
        whyRestored: 'From your saved queue',
        seedTrack: 'Wave from {seed}', seedArtist: 'Wave from artist {seed}', seedPlaylist: 'Wave from playlist {seed}',
        clearSeed: 'Back to My Wave', emptySeed: 'No similar tracks found',
        menuWaveTrack: 'Wave from track', menuWaveArtist: 'Wave from artist', menuWavePlaylist: 'Wave from playlist',
        menuDislike: 'Dislike', menuUndislike: 'Allow in My Wave', menuHideArtist: 'Hide account', menuShowArtist: 'Show account',
        toastDisliked: 'This track won’t play in My Wave', toastUndisliked: 'This track can play in My Wave again',
        toastHidden: 'This account won’t play in My Wave or the radar', toastShown: 'This account can play in My Wave again',
        toastFailed: 'Didn’t work: SoundCloud didn’t respond', toastNotSaved: 'Couldn’t save this', toastEmpty: 'No similar tracks found',
        shake: 'Shake up', history: 'History, Ctrl+H',
        whyTasteArtist: 'You love {artist}', whyTasteTag: 'The {genre} you love',
        more: 'More like this', later: 'Not now', menuUnmore: 'Undo “More like this”', menuUnlater: 'Allow in My Wave',
        toastMore: 'My Wave will play more like this', toastUnmore: '“More like this” removed',
        toastLater: 'This track won’t play in My Wave for a week', toastLaterArtist: 'This artist won’t play in My Wave for a week',
        toastUnlater: 'Can play in My Wave again',
        lang: 'en', shelf: 'Mixes', shelfDaily: 'Scout', shelfForgotten: 'Not played in a while', shelfEmpty: 'Mixes need your likes',
        shelfFailed: 'Could not load mixes',
        tracksCount: 'track|tracks|tracks', groupAnd: '{a} and {b}',
        whyDaily: 'Scout: not played by you yet', whyForgotten: 'From your likes, not played in a while', whyGroup: 'Your taste: {name}',
        seedDaily: 'Scout: new to you, 20 seconds from the best part', seedForgotten: 'Likes you haven’t played in a while',
        seedGroup: 'Your taste: {seed}', seedTracks: 'Wave from picks: {seed}',
        menuPick: 'Add to picks', menuUnpick: 'Remove from picks', toastPicked: 'Picks: {count}', toastUnpicked: 'Removed from picks',
        toastPickFull: 'Picks are full: {count}', pickStart: 'Play wave from picks', pickClear: 'Clear picks',
        mixPlay: 'Play mix', rowPlay: 'Play: {title}', mixClose: 'Collapse', mixLoading: 'Loading tracks', mixFailed: 'Couldn’t load tracks, click the card again',
        mixEmpty: 'You removed every track of this mix from My Wave',
        whyVersion: 'Another version of {seed}',
        radar: 'Release Radar', radarUploads: 'New uploads',
        radarFans: 'Remixes & edits', radarFansHint: 'Reuploads, remixes and edits of other artists’ songs from channels you don’t follow. They don’t count toward the 50 releases',
        radarUploadsHint: 'Fresh posts without a proven release date: reuploads and compilation channels. They don’t count toward the 50 releases',
        radarHeard: 'Already heard', radarPartial: 'incomplete', radarCoverage: 'Sources checked: {checked} of {total}', radarComplete: 'All sources checked',
        radarEmptyWeek: 'No new releases in the last four weeks', radarCollecting: 'Building the radar', radarNoSession: 'Sign in to SoundCloud to build the radar',
        radarOffline: 'Offline, the radar will be built when you’re back', radarError: 'Couldn’t build the radar, will try again later', radarSoon: 'First edition coming soon',
        radarFailed: 'Couldn’t load the radar', radarFound: 'All found', radarAll: 'All', radarReleases: 'Releases', radarPosts: 'Uploads',
        radarHideHeard: 'Hide already heard', radarAfter: 'After release', radarRebuild: 'Rebuild', radarBuildNow: 'Build now',
        radarRebuilt: 'Rebuilt, the previous edition is in the archive', radarBuilt: 'The radar is ready', radarWaiting: 'Still collecting, the radar will be ready later',
        radarArchive: 'Past editions', radarRevision: 'rebuild {n}', radarFoundEmpty: 'Nothing else found', radarNoMatch: 'Nothing matches the filter',
        whyRadar: 'Release Radar', whyRadarArtist: 'New from {name}', whyRadarFollow: 'New from {name}, you follow them', whyRadarTag: 'Fresh {tag}',
        whyRadarTaste: 'Fresh in your taste',
        menuVersions: 'Versions of this track', menuHideFamily: 'Hide other versions', menuShowFamily: 'Show other versions',
        toastFamilyHidden: 'Other versions of this song won’t play in My Wave or the radar', toastFamilyShown: 'Other versions can play in My Wave again',
        versionsTitle: 'Versions: {title}', versionsSame: 'Same recording', versionsOther: 'Other versions', versionsLoading: 'Looking for versions…',
        versionsEmpty: 'No other versions found', versionsFailed: 'Search failed: SoundCloud didn’t respond', versionsLink: 'Mark as same',
        versionsUnlink: 'Mark as different', versionsProbable: 'likely a copy', versionsConfirmed: 'confirmed', versionsThis: 'this track',
        toastLinked: 'Marked as the same recording', toastUnlinked: 'Marked as a different recording', dialogClose: 'Close', radarPost: 'New upload',
        radarAlbum: 'Album · {n}', radarEp: 'EP · {n}', radarSingle: 'Single · {n}', radarCompilation: 'Compilation · {n}', radarGroupAll: 'Play all {n}',
        radarGroupQueued: 'Up next: {count}',
        library: 'My music', libraryLikes: 'Likes', libraryOrder: 'In order', libraryShuffle: 'Shuffle', librarySmart: 'Smart shuffle',
        libraryOrderTip: 'Sources in the order you picked them: playlists as on SoundCloud, likes newest first. Plays everything',
        libraryShuffleTip: 'Random order, no artist twice in a row. Skips what you heard in the last 3 days',
        librarySmartTip: 'Like Shuffle, plus a similar track you don’t have yet after every three of yours',
        libraryPlay: 'Play my music', libraryPick: 'Pick likes or playlists', libraryLoading: 'Loading playlists…',
        libraryFailed: 'Couldn’t load playlists', libraryBuilding: 'Collecting tracks…', libraryEmpty: 'Nothing to play in your picks',
        libraryList: 'Track list', libraryMore: 'Show more', libraryModes: 'Order',
        librarySources: 'Sources', libraryPlaying: 'Playing', libraryPaused: 'Paused', libraryPlaylists: 'playlist|playlists|playlists', libraryHere: 'Playing from here', libraryUnavailable: 'unavailable|unavailable|unavailable',
        libraryUnavailableTip: 'Go+ previews and tracks blocked in your country: SoundCloud won’t play them in full',
        whyLibrary: 'From playlist {name}', whyLibraryLikes: 'From your likes', seedLibrary: 'My music: {seed}',
        presets: 'Mood', presetAll: 'All', moodHappy: 'Happy', moodSad: 'Sad', moodAggressive: 'Aggressive', moodCalm: 'Calm',
        moodEnergetic: 'Energetic', hintPreset: ', mood: {mood}', presetShort: 'Few matches in your taste, adding the closest ones',
        whyMoodTag: 'Tagged {tag} by the author',
        undo: 'Undo', toastLiked: 'Liked: {title}', toastUnliked: 'Unliked: {title}',
        seedCollecting: 'Building a wave from {title}', seedCollectingAny: 'Building a wave…', seedCollectingArtist: 'Collecting tracks by {title}', seedCollectingArtistAny: 'Collecting the artist’s tracks…',
        menuArtistAll: 'All tracks by artist', seedArtistAll: 'All tracks by {seed}', menuQueueNext: 'Play next', menuQueueLast: 'Add to queue',
        scoutTitle: 'Scout', scoutCount: '{n} of {total}', scoutKeep: 'Keep', scoutKept: 'Kept', scoutNext: 'Next', scoutExit: 'Exit scout',
        momentNight: 'Night before {day}', momentMorning: '{day} morning', momentDay: '{day} afternoon', momentEvening: '{day} evening',
        momentDaysOf: 'Sunday,Monday,Tuesday,Wednesday,Thursday,Friday,Saturday', momentDaysOn: 'Sunday,Monday,Tuesday,Wednesday,Thursday,Friday,Saturday',
        whyRelatedArtist: 'Sounds like {artist}', whyScMix: 'From SoundCloud’s {name}', whyNeighbors: 'Liked by listeners with your taste',
        shelfLiked: 'Liked by your artists', seedLiked: 'What the artists you listen to like', whyLikedBy: 'Liked by {artist}', whyLikedAny: 'Liked by an artist you listen to',
        traitLessCyr: 'Less Russian-language music in this wave', traitLessInst: 'Fewer instrumentals in this wave', traitLessGenre: 'Less {genre} in this wave',
        traitLessMarker: 'Fewer {marker} versions in this wave', traitLessForeign: 'Fewer reuploads from other channels in this wave',
        forkTitle: 'Where to next?', forkClose: 'Close', forkCalm: 'Calmer', forkAway: 'Looking for something else? Options are on the home page',
        pinned: 'Pinned', menuPin: 'Pin to home', menuUnpin: 'Unpin from home', menuWaveGenre: 'Wave from genre',
        toastPinned: 'Pinned to home: {title}', toastUnpinned: 'Unpinned: {title}', toastPinFull: 'Home already has {count}, unpin something first',
        pinPlay: 'Wave: {title}', pinRemove: 'Unpin: {title}',
    },
};

export function fillText(template: string, values: Record<string, string>): string {
    return template.replace(/\{(\w+)\}/g, (all, name: string) => (name in values ? values[name] : all));
}

export function reasonText(reason: WaveReason, texts: WaveTexts): string {
    switch (reason.kind) {
        case 'similar': return fillText(texts.whySimilar, { seed: reason.seed });
        case 'fresh': return fillText(texts.whyFresh, { seed: reason.seed });
        case 'newArtist': return texts.whyNewArtist;
        case 'genreFresh': return fillText(texts.whyGenreFresh, { genre: reason.genre });
        case 'genrePopular': return fillText(texts.whyGenrePopular, { genre: reason.genre });
        case 'genreSimilar': return fillText(texts.whyGenreSimilar, { genre: reason.genre, seed: reason.seed });
        case 'seedTrack': return texts.whySeedTrack;
        case 'restored': return texts.whyRestored;
        case 'artistTrack': return fillText(texts.whyArtistTrack, { artist: reason.artist });
        case 'mood': return fillText(texts.whyMood, { seed: reason.seed, genre: reason.genre });
        case 'tasteArtist': return fillText(texts.whyTasteArtist, { artist: reason.artist });
        case 'tasteTag': return fillText(texts.whyTasteTag, { genre: reason.genre });
        case 'daily': return texts.whyDaily;
        case 'forgotten': return texts.whyForgotten;
        case 'group': return fillText(texts.whyGroup, { name: reason.name });
        case 'version': return fillText(texts.whyVersion, { seed: reason.seed });
        case 'moodTag': return fillText(texts.whyMoodTag, { tag: reason.tag });
        case 'radar': return reason.why || texts.whyRadar;
        case 'library': return reason.name ? fillText(texts.whyLibrary, { name: reason.name }) : texts.whyLibraryLikes;
        case 'relatedArtist': return fillText(texts.whyRelatedArtist, { artist: reason.artist });
        case 'scMix': return fillText(texts.whyScMix, { name: reason.name });
        case 'neighbors': return texts.whyNeighbors;
        case 'likedBy': return reason.artist ? fillText(texts.whyLikedBy, { artist: reason.artist }) : texts.whyLikedAny;
    }
}

// Местные сутки строкой: подборки дня меняются в местную полночь
export function localDay(now: number): string {
    const date = new Date(now);
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
}

// Число со словом по правилам языка, forms это «один|несколько|много» через черту: 21 трек, 3 трека, 5 треков
export function countText(count: number, forms: string, lang: string): string {
    const [one, few, many] = forms.split('|');
    const rule = new Intl.PluralRules(lang).select(count);
    return count + ' ' + (rule === 'one' ? one : rule === 'few' ? few : rule === 'many' ? many : lang === 'ru' ? few : many);
}

// Громкие мастеринги дают сплошной «штрихкод», поэтому динамика растягивается: 10-й и 99-й перцентили в 0..1
export function shapeSamples(samples: number[]): number[] {
    if (!samples.length) return [];
    const sorted = samples.slice().sort((a, b) => a - b);
    const low = sorted[Math.floor(sorted.length * 0.1)];
    const high = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))] || 1;
    return samples.map((value) => 0.1 + 0.9 * Math.pow(Math.min(1, Math.max(0, (value - low) / (high - low || 1))), 1.4));
}

export function formatTime(ms: number): string {
    const seconds = Math.max(0, Math.floor(ms / 1000));
    return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
}
