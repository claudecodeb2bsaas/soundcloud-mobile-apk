import { WAVE_TEXTS } from '../core/waveTexts';
import { settings } from './instance';

/** Подписи волны, радара и подборок на языке из настроек. Берутся при запуске: смена языка действует после перезапуска */
export const texts = WAVE_TEXTS[settings.getSnapshot().language];
