import type { SoundCloud } from '../api/soundcloud';

// Лайки аккаунта в памяти: сердечко в интерфейсе мгновенное, запрос идёт следом, при отказе сердечко возвращается.

export interface Likes {
    /** Снимок меняется при каждой правке: для useSyncExternalStore */
    getSnapshot(): ReadonlySet<number>;
    subscribe(listener: () => void): () => void;
    /** Загружает id лайков (до 1000 свежих); повторный вызов ничего не делает, пока не было reset */
    load(): Promise<void>;
    /** Новое состояние лайка; при отказе сайта возвращает прежнее и бросает ошибку */
    toggle(trackId: number): Promise<boolean>;
    reset(): void;
}

export interface LikesDeps {
    sc: Pick<SoundCloud, 'likedIds' | 'setLike'>;
    userId(): number | null;
}

// ponytail: 5 страниц по 200, дальше лайк со старых треков показывается пустым сердечком; PUT/DELETE от этого не ломаются
const PAGES = 5;

export function createLikes({ sc, userId }: LikesDeps): Likes {
    let ids: ReadonlySet<number> = new Set();
    let loading: Promise<void> | null = null;
    let loaded = false;
    const listeners = new Set<() => void>();

    const set = (next: Set<number>): void => {
        ids = next;
        for (const listener of [...listeners]) listener();
    };

    return {
        getSnapshot: () => ids,
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        load() {
            if (loaded) return Promise.resolve();
            loading ??= (async () => {
                const found = new Set<number>();
                let query: Parameters<typeof sc.likedIds>[0] = { limit: 200 };
                for (let i = 0; i < PAGES && query; i++) {
                    const page = await sc.likedIds(query);
                    for (const id of page.items) found.add(id);
                    query = page.next ?? undefined;
                }
                // Лайк, поставленный пока шла загрузка, не теряется
                set(new Set([...found, ...ids]));
                loaded = true;
            })().finally(() => {
                loading = null;
            });
            return loading;
        },
        async toggle(trackId) {
            const user = userId();
            if (!user) throw new Error('Нужен вход в аккаунт');
            const was = ids.has(trackId);
            const flip = (on: boolean): void => {
                const next = new Set(ids);
                if (on) next.add(trackId);
                else next.delete(trackId);
                set(next);
            };
            flip(!was);
            try {
                await sc.setLike(user, trackId, !was);
            } catch (error) {
                flip(was);
                throw error;
            }
            return !was;
        },
        reset() {
            loaded = false;
            set(new Set());
        },
    };
}
