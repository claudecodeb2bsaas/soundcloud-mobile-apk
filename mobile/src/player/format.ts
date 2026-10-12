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

/** 950 → «950», 12400 → «12,4 тыс.», 3200000 → «3,2 млн» (Intl compact в Hermes ненадёжен) */
export function count(value: number): string {
    const short = (n: number, unit: string) => `${(Math.floor(n * 10) / 10).toString().replace('.', ',')} ${unit}`;
    if (!Number.isFinite(value) || value < 0) return '0';
    if (value < 1000) return String(Math.floor(value));
    return value < 1e6 ? short(value / 1000, 'тыс.') : short(value / 1e6, 'млн');
}

/** Аккаунт, загрузивший трек */
export function artistIdOf(track: { user?: { id?: number } | null; user_id?: number }): number | null {
    const id = track.user?.id ?? track.user_id;
    return typeof id === 'number' && Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** Обложка нужного размера: сайт отдаёт large (100x100), остальные размеры лежат рядом по тому же адресу */
export function artwork(url: string | null | undefined, size: 't200x200' | 't500x500' = 't200x200'): string | null {
    return url ? url.replace('-large.', `-${size}.`) : null;
}
