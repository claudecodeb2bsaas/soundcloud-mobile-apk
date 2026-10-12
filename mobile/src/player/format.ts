import type { PlayerError } from './controller';

/** 83 → «1:23», 3725 → «1:02:05» */
export function clock(seconds: number): string {
    const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

export function errorText(error: PlayerError | null): string {
    if (error === 'unavailable') return 'Трек недоступен: закрыт правообладателем или в вашей стране';
    if (error === 'network') return 'Нет связи с SoundCloud. Нажмите play, чтобы повторить.';
    if (error === 'playback') return 'Не удалось проиграть трек. Нажмите play, чтобы повторить.';
    return '';
}

/** Обложка нужного размера: сайт отдаёт large (100x100), остальные размеры лежат рядом по тому же адресу */
export function artwork(url: string | null | undefined, size: 't200x200' | 't500x500' = 't200x200'): string | null {
    return url ? url.replace('-large.', `-${size}.`) : null;
}
