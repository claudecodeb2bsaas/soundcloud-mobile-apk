// Фасад ядра «Моей волны»: те же реэкспорты, что в desktop-файле wave.ts, но без страничной части (installWave и DOM).
// Экраны и тесты импортируют чистую логику отсюда или напрямую из модулей.
export type { WaveTrack, WaveMode, OpenTrackResult, WaveReason, WaveCandidate, WaveFilter, WaveLinkKind, WaveTexts, TasteMaps, TasteScore, TasteGroup } from './waveTypes';
export { WAVE_TEXTS, fillText, reasonText, localDay, countText, formatTime, shapeSamples } from './waveTexts';
export { normalizeTag, tagKeys, tagShares, trackLang, genreKeys, genreEnglish, genreCanon, genrePhrases, genreParts, genreMain, parseGenres, formatGenres, genreKeysFor, trackMatchesGenre, topGenres } from './waveGenres';
export { classifyLink, classifyTag, canonicalUrl, trackPath, artworkUrl, playEnd, siteSource, retryDelay } from './waveLinks';
export { trackArtist, rememberRecent, isWaveEligible, freshEnough, acceptCandidate, pickSpaced, spacingKeys, spacingGap, shuffleInPlace, capPerArtist, forgottenPicks, daySample, artistNames, performerNames, sharedPerformer, isNewArtist, spreadBy } from './wavePicks';
export { tasteMaps, tasteSlot, tasteForTime, sourceBias, trackTraits, seriesTrait, tasteScore, tasteOrder, tasteReason, applyTasteReasons, tasteGroups, moodTags, pickFinds } from './waveTaste';
export { moodList, moodDictionary, trackMood, playlistMood, artistMoods, neighborMood, moodScore } from './waveMood';
export type { WaveMood, MoodScores, ArtistMoods } from './waveMood';
