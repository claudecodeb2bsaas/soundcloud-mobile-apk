import type { LibraryMode } from './libraryMix';
// Типы «Моей волны»: трек сайта, причины, фильтр подбора, тексты, профиль вкуса. Только типы, на страницу не уходят

export interface WaveTrack {
    id: number;
    kind?: string;
    title?: string;
    genre?: string | null;
    tag_list?: string | null;
    user_id?: number;
    user?: { id?: number; username?: string; avatar_url?: string | null; permalink_url?: string } | null;
    permalink_url?: string;
    artwork_url?: string | null;
    waveform_url?: string | null;
    policy?: string;
    streamable?: boolean;
    duration?: number;
    full_duration?: number;
    /** Метаданные издателя: часто null или псевдоним загрузчика, иногда isrc и автор (приложение А плана радара) */
    publisher_metadata?: { artist?: string | null; isrc?: string | null; writer_composer?: string | null } | null;
    /** Даты ISO: загрузка, публикация (бывает позже загрузки), заявленный релиз с точностью до дня */
    created_at?: string;
    display_date?: string;
    release_date?: string | null;
    /** Счётчики сайта: слабый член порядка и порог «Свежего в жанре»; у заготовок и старых записей их нет */
    likes_count?: number | null;
    playback_count?: number | null;
}

export type WaveMode = 'similar' | 'fresh';

export type OpenTrackResult = 'played' | 'not-ready' | 'unavailable' | 'failed' | 'superseded';

export type WaveReason =
    | { kind: 'similar'; seed: string }
    | { kind: 'fresh'; seed: string }
    | { kind: 'newArtist' }
    | { kind: 'genreFresh'; genre: string }
    | { kind: 'genrePopular'; genre: string }
    | { kind: 'genreSimilar'; genre: string; seed: string }
    | { kind: 'seedTrack' }
    | { kind: 'restored' }
    | { kind: 'artistTrack'; artist: string }
    | { kind: 'mood'; seed: string; genre: string }
    | { kind: 'tasteArtist'; artist: string }
    | { kind: 'tasteTag'; genre: string }
    | { kind: 'daily' }
    | { kind: 'forgotten' }
    | { kind: 'group'; name: string }
    | { kind: 'version'; seed: string }
    /** Пресет настроения: трек из поиска SoundCloud по метке настроения, tag это метка */
    | { kind: 'moodTag'; tag: string }
    /** Позиция радара: why это готовая короткая причина из выпуска */
    | { kind: 'radar'; why: string }
    /** Трек «Моей музыки»: name это плейлист, из которого он пришёл, пусто у лайков */
    | { kind: 'library'; name: string }
    /** Трек похожего артиста (relatedartists): artist это тот, на кого он похож */
    | { kind: 'relatedArtist'; artist: string }
    /** Из персональной подборки SoundCloud: name это её название (Your Mix 1, Weekly Wave) */
    | { kind: 'scMix'; name: string }
    /** Свежий лайк слушателей, которые лайкают то же нишевое, что и ты */
    | { kind: 'neighbors' }
    /** «Лайкнули твои артисты» (П13): artist это тот, чей лайк; пусто, если неизвестно */
    | { kind: 'likedBy'; artist: string };

/** Для журнала: откуда кандидат на самом деле и как его оценил вкус; причина в reason может смениться причиной по вкусу */
export interface WaveTrace {
    /** Источник кандидата: вид причины или station у станции трека, у которой своя доля по успеху (П9) */
    origin: WaveReason['kind'] | 'station';
    /** Трек-зерно, от которого найден кандидат; 0 без зерна */
    seed: number;
    /** Оценка вкуса при упорядочивании; null, пока профиля вкуса нет */
    score: number | null;
    known: boolean;
    /** Версия модели вкуса, которой посчитана оценка */
    tv?: number;
}
export interface WaveCandidate {
    track: WaveTrack;
    reason: WaveReason;
    trace?: WaveTrace;
}

export interface WaveFilter {
    mode: WaveMode;
    /** Треки сессии и уже стоящие в очереди */
    taken: Set<number>;
    /** Недавняя история SoundCloud: в «Похожем» не повторяется */
    recent: Set<number>;
    /** Всё слышанное: история и свой журнал */
    heard: Set<number>;
    liked: Set<number>;
    /** Ключи вероятных копий версий, рано пропущенных человеком в этой сессии: аккаунт целиком не банится */
    skipped: Set<string>;
    /** «Не нравится» (с подтверждёнными копиями) и скрытые артисты: навсегда, в любом режиме */
    excludedTracks: Set<number>;
    excludedArtists: Set<number>;
    /** «Скрыть другие версии»: семья по разбору названия и версии, которые в ней оставлены */
    excludedFamilies: Map<string, Set<string>>;
}

export type WaveLinkKind = 'track' | 'artist' | 'playlist';
/** Цель меню по правому клику: трек, артист или плейлист по ссылке, трек волны сразу с данными; жанр по ссылке
 *  сайта /tags/… или по карточке жанра на полке, его название в genre */
export interface MenuTarget { kind: WaveLinkKind | 'genre'; url: string; artistUrl: string; track?: WaveTrack; genre?: string }
/** Закреплённое на главной (В5): плейлист и артист по ссылке, жанр по названию; title для подписи в быстром ряду */
export interface WavePin { kind: 'playlist' | 'artist' | 'genre'; url: string; title: string }

export type WaveTexts = Record<
    | 'wave' | 'similar' | 'fresh' | 'anyGenre' | 'genreInput' | 'fromLikes' | 'hintSimilar' | 'hintFresh' | 'hintGenre' | 'hintGenres'
    | 'idleSimilar' | 'idleSimilarAny' | 'idleFresh' | 'idleGenre' | 'whySimilar' | 'whyFresh' | 'whyNewArtist' | 'whyGenreFresh'
    | 'whyGenrePopular' | 'whyGenreSimilar' | 'loading' | 'emptyFresh' | 'emptyFreshGenre' | 'emptyGenre' | 'emptySimilar'
    | 'dropGenre' | 'toSimilar' | 'play' | 'pause' | 'clearGenre' | 'upFirst' | 'next' | 'like' | 'error' | 'retry' | 'unavailable'
    | 'whySeedTrack' | 'whyRestored' | 'whyArtistTrack' | 'whyMood' | 'seedTrack' | 'seedArtist' | 'seedPlaylist' | 'clearSeed' | 'emptySeed'
    | 'menuWaveTrack' | 'menuWaveArtist' | 'menuWavePlaylist' | 'menuDislike' | 'menuUndislike' | 'menuHideArtist' | 'menuShowArtist'
    | 'toastDisliked' | 'toastUndisliked' | 'toastHidden' | 'toastShown' | 'toastFailed' | 'toastNotSaved' | 'toastEmpty' | 'shake' | 'history'
    | 'whyTasteArtist' | 'whyTasteTag' | 'more' | 'later' | 'menuUnmore' | 'menuUnlater' | 'toastMore' | 'toastUnmore' | 'toastLater'
    | 'toastLaterArtist' | 'toastUnlater'
    | 'lang' | 'shelf' | 'shelfDaily' | 'shelfForgotten' | 'shelfEmpty' | 'shelfFailed' | 'tracksCount' | 'groupAnd' | 'whyDaily' | 'whyForgotten' | 'whyGroup'
    | 'seedDaily' | 'seedForgotten' | 'seedGroup' | 'seedTracks' | 'menuPick' | 'menuUnpick' | 'toastPicked' | 'toastUnpicked' | 'toastPickFull'
    | 'pickStart' | 'pickClear' | 'mixPlay' | 'mixClose' | 'mixLoading' | 'mixFailed' | 'mixEmpty' | 'whyVersion'
    | 'radar' | 'radarUploads' | 'radarUploadsHint' | 'radarFans' | 'radarFansHint' | 'radarHeard' | 'radarPartial' | 'radarCoverage' | 'radarComplete' | 'radarEmptyWeek'
    | 'radarCollecting' | 'radarNoSession' | 'radarOffline' | 'radarError' | 'radarSoon' | 'radarFailed' | 'radarFound' | 'radarAll' | 'radarReleases'
    | 'radarPosts' | 'radarHideHeard' | 'radarAfter' | 'radarRebuild' | 'radarBuildNow' | 'radarRebuilt' | 'radarBuilt' | 'radarWaiting' | 'radarArchive'
    | 'radarRevision' | 'radarFoundEmpty' | 'radarNoMatch' | 'whyRadar' | 'whyRadarArtist' | 'whyRadarFollow' | 'whyRadarTag' | 'whyRadarTaste'
    | 'menuVersions' | 'menuHideFamily' | 'menuShowFamily' | 'toastFamilyHidden' | 'toastFamilyShown' | 'versionsTitle' | 'versionsSame'
    | 'versionsOther' | 'versionsLoading' | 'versionsEmpty' | 'versionsFailed' | 'versionsLink' | 'versionsUnlink' | 'versionsProbable'
    | 'versionsConfirmed' | 'versionsThis' | 'toastLinked' | 'toastUnlinked' | 'dialogClose' | 'radarPost' | 'rowPlay'
    | 'radarAlbum' | 'radarEp' | 'radarSingle' | 'radarCompilation' | 'radarGroupAll' | 'radarGroupQueued'
    | 'library' | 'libraryLikes' | 'libraryOrder' | 'libraryShuffle' | 'librarySmart' | 'libraryOrderTip' | 'libraryShuffleTip' | 'librarySmartTip'
    | 'libraryPlay' | 'libraryPick' | 'libraryLoading' | 'libraryFailed' | 'libraryBuilding' | 'libraryEmpty' | 'libraryList' | 'libraryMore'
    | 'libraryModes' | 'librarySources' | 'libraryPlaying' | 'libraryPaused' | 'libraryPlaylists' | 'libraryHere' | 'libraryUnavailable' | 'libraryUnavailableTip' | 'whyLibrary' | 'whyLibraryLikes' | 'seedLibrary'
    | 'presets' | 'presetAll' | 'moodHappy' | 'moodSad' | 'moodAggressive' | 'moodCalm' | 'moodEnergetic' | 'hintPreset' | 'presetShort' | 'whyMoodTag'
    | 'undo' | 'toastLiked' | 'toastUnliked' | 'seedCollecting' | 'seedCollectingAny' | 'seedCollectingArtist' | 'seedCollectingArtistAny' | 'menuArtistAll' | 'seedArtistAll' | 'menuQueueNext' | 'menuQueueLast'
    | 'scoutTitle' | 'scoutCount' | 'scoutKeep' | 'scoutKept' | 'scoutNext' | 'scoutExit'
    | 'momentNight' | 'momentMorning' | 'momentDay' | 'momentEvening' | 'momentDaysOf' | 'momentDaysOn'
    | 'whyRelatedArtist' | 'whyScMix' | 'whyNeighbors' | 'shelfLiked' | 'seedLiked' | 'whyLikedBy' | 'whyLikedAny'
    | 'traitLessCyr' | 'traitLessInst' | 'traitLessGenre' | 'traitLessMarker' | 'traitLessForeign' | 'forkTitle' | 'forkClose' | 'forkCalm' | 'forkAway'
    | 'pinned' | 'menuPin' | 'menuUnpin' | 'menuWaveGenre' | 'toastPinned' | 'toastUnpinned' | 'toastPinFull' | 'pinPlay' | 'pinRemove',
    string
>;

// Профиль вкуса из main: веса треков, аккаунтов-кураторов, участников, семей версий, тегов и пометок версии
export interface TasteMaps {
    /** Версия модели в main; 0, если профиль её не принёс */
    version: number;
    artists: Map<number, number>;
    credits: Map<string, number>;
    families: Map<string, number>;
    tags: Map<string, number>;
    markers: Map<string, number>;
    tracks: Map<number, number>;
    /** Язык трека (trackLang): cyr, inst, lat */
    langs: Map<string, number>;
    /** Поправки артистов и тегов по отрезку суток: ключ slot × 2 + выходной, slot это ночь, утро, день, вечер (П5) */
    contexts: Map<number, { artists: Map<number, number>; tags: Map<string, number> }>;
    /** Источники волны за 14 дней: дослушано и ранних пропусков по исходной причине (П9) */
    sources: Map<string, { done: number; early: number }>;
}

/** Общий признак серии ранних пропусков (П7): пометка версии, язык, главный жанр или чужой канал */
export interface SeriesTrait {
    kind: 'marker' | 'lang' | 'genre' | 'foreign';
    key: string;
    /** Как назвать в плашке: пометка или жанр в написании трека */
    label: string;
}

export interface TasteScore {
    score: number;
    track: number;
    /** Вес загрузившего аккаунта как куратора */
    artist: number;
    /** Участники из названия и метаданных, кроме загрузчика: лучший плюс и худший минус вместе */
    credit: number;
    /** Самый любимый участник и его вес */
    creditName: string;
    creditBest: number;
    /** Семья версий: другая версия любимой песни */
    family: number;
    /** Средний вес известных пометок версии (slowed, remix, live) */
    marker: number;
    /** Вклад тегов: сумма весов долями (жанр 1, метки вместе 0.5), плюс насыщен до 1 */
    tag: number;
    /** Язык трека против самого любимого языка: от -1 до 0 */
    lang: number;
    /** Самый любимый из тегов трека и его вклад без насыщения */
    tagKey: string;
    tagBest: number;
    /** У аккаунта или участника есть история */
    known: boolean;
}

export interface TasteGroup {
    /** Ключи тегов группы, самые весомые первыми */
    keys: string[];
    /** Главные теги для названия в написании, которое у треков встречается чаще */
    labels: string[];
    /** Треки группы, самые весомые первыми */
    tracks: WaveTrack[];
    weight: number;
}

// Типы ядра волны, которые нужны и разделам в wave/
export type WaveState = 'idle' | 'loading' | 'playing' | 'empty' | 'error' | 'unavailable';
export interface Profile {
    userId: number;
    history: WaveTrack[];
    recent: Set<number>;
    heard: Set<number>;
    liked: Set<number>;
    likedTracks: WaveTrack[];
    knownArtists: Set<number>;
    /** Ключи имён исполнителей из истории и лайков: для причины «новый артист» */
    knownNames: Set<string>;
    loadedAt: number;
    likesCursor: Record<string, string | number> | null;
    /** Лайки прошлого профиля, которых новое листание ещё не подтвердило: в конце листания снятые уходят */
    unconfirmed?: Set<number>;
}
// Волна от трека, артиста или плейлиста из меню по ПКМ: зёрна вместо вкуса, жанр не действует.
// own это треки самого артиста, они идут в подборку; derived это найденное, от него волна едет дальше.
// У подборок полки и набора из меню own это сама подборка
export type SeedKind = WaveLinkKind | 'artistAll' | 'daily' | 'forgotten' | 'liked' | 'group' | 'tracks' | 'radar' | 'library';
export interface Seed {
    kind: SeedKind;
    title: string;
    tracks: WaveTrack[];
    own: WaveTrack[];
    /** own по порядку впереди найденного (fixed), через один с ним (blend) или три к одному (smart); без order own тасуется с найденным */
    order?: 'fixed' | 'blend' | 'smart';
    /** Свой режим подбора у подборки полки, переключатель на неё не действует */
    mode?: WaveMode;
    /** Номер карточки полки, от которой идёт волна */
    card?: number;
    /** «Моя музыка»: выбранные источники и режим; left это номера оставшихся треков из сессии, пока пул не собран заново */
    library?: { pick: string[]; mode: LibraryMode; left?: number[] };
    /** Волна от артиста: его аккаунт, по нему берутся похожие артисты */
    artist?: number;
    /** Своя причина у трека подборки: чей лайк в «Лайкнули твои артисты», соседи в находках. В сессию не пишется,
     *  причина сохраняется у трека в очереди */
    reasons?: Map<number, WaveReason>;
}
/** Вид отметки из меню и блока: «Не нравится», скрытый артист, «Не сейчас» у трека и артиста, «Больше такого» */
export type MarkKind = 'track' | 'artist' | 'later-track' | 'later-artist' | 'more';
/** Отметка волны из main: «Не нравится», скрытый артист, «Не сейчас» до until */
export interface Excluded { id: number; title: string; artist: string; url: string; until?: number }
