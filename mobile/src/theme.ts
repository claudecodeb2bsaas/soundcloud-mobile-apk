// Фирменный оранжевый SoundCloud на глубоком тёмном фоне; подача карточек, скруглений и подсветки как у Яндекс Музыки
export const theme = {
  bg: '#0b0b0d',
  surface: '#17171a',
  surfaceHigh: '#222226',
  border: '#ffffff14',
  text: '#f5f5f7',
  muted: '#9b9ba3',
  accent: '#ff5500',
  accentSoft: '#ff550026',
  accentBright: '#ff8a3d',
  danger: '#ff5a5f',
  warn: '#ffb454',
  radius: 20,
} as const;

/** Три цвета шара волны у каждого настроения: первый основной, остальные добавляют переливы */
export const MOOD_COLORS = {
  '': ['#ff5500', '#ff2d8f', '#7b2ff7'],
  happy: ['#ffd400', '#ff9a00', '#3ddc84'],
  sad: ['#3a6df0', '#6a3df0', '#18c9c0'],
  aggressive: ['#ff2a2a', '#b3002d', '#ff7a00'],
  calm: ['#18c9c0', '#2b7fff', '#7be8c9'],
  energetic: ['#ff8a00', '#ff2d8f', '#ffd400'],
} as const satisfies Record<string, readonly [string, string, string]>;
