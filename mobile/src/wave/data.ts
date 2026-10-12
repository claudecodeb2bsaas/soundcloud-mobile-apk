import Storage from 'expo-sqlite/kv-store';
import { auth } from '../auth/instance';
import { texts } from '../settings/texts';
import { expoDb } from '../store/db';
import { createHistory } from '../store/history';
import { createLikes } from './likes';
import { createMarks } from './marks';
import { createRadar } from './radar';
import { createTaste, tasteLibraryOf } from './taste';
import { createTasteOverrides } from './tasteOverrides';

// Данные волны без плеера: история, вкус, отметки, лайки, радар. Отдельно от instance.ts, чтобы фоновая задача радара
// не поднимала плеер и звук. Экраны и волна берут всё через instance.ts.

export const DAY = 86400000;
// После восстановления копии записи живут в памяти модулей со старыми значениями: заморозка не даёт им затереть
// восстановленное, пока приложение не перезапустят
let frozen = false;
export const freezeKv = (): void => { frozen = true; };
export const kv = (key: string) => ({
    get: () => Storage.getItemSync(key),
    set: (value: string) => { if (!frozen) Storage.setItemSync(key, value); },
});
export const userId = (): number | null => auth.getState().session?.user.id ?? null;

// Раздел подборок SoundCloud и соседей хранит кэш в localStorage, которого в Hermes нет
const shim = globalThis as unknown as { localStorage?: { getItem(key: string): string | null; setItem(key: string, value: string): void } };
shim.localStorage ??= { getItem: (key) => Storage.getItemSync(key), setItem: (key, value) => Storage.setItemSync(key, value) };

export const history = createHistory(expoDb);

export const taste = createTaste({
    history,
    library: (user) => tasteLibraryOf(auth.sc, user),
    overrides: createTasteOverrides(kv('wave.taste-overrides.v1')),
});

export const marks = createMarks(kv('wave.marks.v1'), (change) => {
    const user = userId();
    if (!user) return;
    const at = Date.now();
    const kind = change.kind;
    const done = change.on
        ? history.setMark(user, {
            kind, id: change.id, at, artist: kind === 'artist' ? change.id : change.track?.user_id ?? change.track?.user?.id ?? 0,
            genre: change.track?.genre ?? '', tags: change.track?.tag_list ?? '', title: change.track?.title ?? '', name: change.name,
        })
        : history.removeMark(user, kind, change.id);
    void done.then(() => taste.invalidate(user), (error: unknown) => console.warn('Отметка не записана', error));
});

export const likes = createLikes({ sc: auth.sc, userId });

export const excluded = () => {
    const data = marks.getSnapshot();
    return { tracks: new Set(Object.keys(data.tracks).map(Number)), artists: new Set(Object.keys(data.artists).map(Number)) };
};

export const radar = createRadar({
    userId,
    follows: async (user) => (await auth.sc.followings(user, 200)).map((account) => account.id),
    uploads: (account) => auth.sc.userTracks(account, 20, { background: true }),
    tracksByIds: (ids) => auth.sc.tracksByIds(ids),
    taste: async () => {
        const user = userId();
        return user ? taste.maps(user) : null;
    },
    heard: async () => {
        const user = userId();
        const ids = new Set<number>(likes.getSnapshot());
        if (user) for (const id of await history.heardIds(user, Date.now() - 90 * DAY).catch(() => [])) ids.add(id);
        return ids;
    },
    excluded,
    store: kv('wave.radar.v1'),
    texts,
});
