import { buildRadar, heardLast, RADAR_PARAMS, type RadarEdition, type RadarItem, type RadarReason, type StoredUpload } from '../core/radar';
import { trackCredits } from '../core/trackIdentity';
import { isWaveEligible, trackArtist } from '../core/wavePicks';
import { fillText } from '../core/waveTexts';
import type { TasteMaps, WaveTexts, WaveTrack } from '../core/waveTypes';
import type { WaveExclusions, WaveSeed } from './engine';
import type { TextStore } from './marks';

// Радар релизов на телефоне. На desktop радар обходит каталоги подписок в фоне и копит их в базе; здесь выпуск собирается
// по запросу: подписки и любимые аккаунты из вкуса (до 100 по весу), у каждого последние 20 загрузок, окно 7 дней, отбор
// и оценка из core/radar без правок. Выпуск хранится 6 часов. Не перенесено: плановый выпуск по пятницам, фоновая
// задача с уведомлением (этап 9), поиск свежего по любимым участникам, архив выпусков, «Все найденные», копии одной записи.

export interface RadarView {
    edition: RadarEdition;
    /** Аккаунтов в обходе и сколько из них ответили */
    total: number;
    checked: number;
}

export interface RadarDeps {
    userId(): number | null;
    /** Подписки аккаунта */
    follows(user: number): Promise<number[]>;
    /** Свежие загрузки аккаунта, новые первыми */
    uploads(account: number): Promise<WaveTrack[]>;
    tracksByIds(ids: number[]): Promise<WaveTrack[]>;
    taste(): Promise<TasteMaps | null>;
    /** Слышанное и лайкнутое: такие записи уходят в конец выпуска */
    heard(): Promise<Set<number>>;
    excluded(): WaveExclusions;
    store: TextStore;
    texts: WaveTexts;
    now?(): number;
}

export interface Radar {
    /** Выпуск; force собирает заново, иначе берётся хранимый моложе 6 часов */
    load(force?: boolean): Promise<RadarView>;
    /** Волна по позициям выпуска (релизы, потом загрузки); fromId это позиция, с которой начать */
    seed(view: RadarView, fromId?: number): Promise<Extract<WaveSeed, { kind: 'library' }>>;
}

const TTL = 6 * 3600000;
const SOURCES = 100;
const PARALLEL = 4;
const UPLOADS_PER_ACCOUNT = 20;

/** Загрузка в виде, который понимает радар; без загрузчика или даты публикации запись не годится */
export function uploadOf(track: WaveTrack): StoredUpload | null {
    const uploader = trackArtist(track);
    const time = (value: string | null | undefined): number => (value ? Date.parse(value) || 0 : 0);
    if (!uploader || !isWaveEligible(track)) return null;
    return {
        key: 'sc:track:' + track.id, id: track.id, uploader, uploaderName: track.user?.username ?? '', title: track.title ?? '', credits: trackCredits(track),
        isrc: track.publisher_metadata?.isrc ?? '', duration: track.full_duration ?? track.duration ?? 0, createdAt: time(track.created_at),
        displayAt: time(track.display_date), releaseDay: track.release_date ? track.release_date.slice(0, 10) : '', genre: track.genre ?? '', tags: track.tag_list ?? '',
    };
}

/** Видимая причина позиции выпуска */
export function radarReason(reason: RadarReason, texts: WaveTexts): string {
    switch (reason.kind) {
        case 'artist': return fillText(texts.whyRadarArtist, { name: reason.name });
        case 'follow': return fillText(texts.whyRadarFollow, { name: reason.name });
        case 'tag': return fillText(texts.whyRadarTag, { tag: reason.tag });
        case 'taste': return texts.whyRadarTaste;
    }
}

/** Аккаунты обхода: подписки и любимые по вкусу, больше вес выше; скрытые не берутся */
export function radarAccounts(follows: number[], taste: TasteMaps | null, hidden: ReadonlySet<number>): number[] {
    const weight = new Map<number, number>();
    for (const id of follows) weight.set(id, 1);
    for (const [id, value] of taste?.artists ?? []) if (value >= RADAR_PARAMS.curatorWeight) weight.set(id, Math.max(weight.get(id) ?? 0, value));
    return [...weight].filter(([id]) => !hidden.has(id)).sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, SOURCES).map(([id]) => id);
}

export function createRadar(deps: RadarDeps): Radar {
    const now = deps.now ?? (() => Date.now());
    let running: Promise<RadarView> | null = null;
    let memory: { user: number; at: number; view: RadarView } | null = null;

    function readSaved(user: number): { at: number; view: RadarView } | null {
        try {
            const raw = JSON.parse(deps.store.get() ?? 'null') as { user?: unknown; at?: unknown; view?: RadarView } | null;
            return raw && raw.user === user && typeof raw.at === 'number' && Array.isArray(raw.view?.edition?.items) ? { at: raw.at, view: raw.view } : null;
        } catch {
            return null;
        }
    }

    async function build(user: number): Promise<RadarView> {
        const [follows, taste, heard] = await Promise.all([deps.follows(user).catch(() => [] as number[]), deps.taste().catch(() => null), deps.heard().catch(() => new Set<number>())]);
        const marks = deps.excluded();
        const accounts = radarAccounts(follows, taste, marks.artists);
        const uploads = new Map<number, StoredUpload>();
        let checked = 0;
        let cursor = 0;
        await Promise.all(Array.from({ length: Math.min(PARALLEL, accounts.length) }, async () => {
            while (cursor < accounts.length) {
                const account = accounts[cursor++];
                try {
                    for (const track of (await deps.uploads(account)).slice(0, UPLOADS_PER_ACCOUNT)) {
                        const upload = uploadOf(track);
                        if (upload) uploads.set(track.id, upload);
                    }
                    checked++;
                } catch (error) {
                    console.warn('Радар: каталог аккаунта не загружен', account, error);
                }
            }
        }));
        if (accounts.length && !checked) throw new Error('Радар: ни один каталог не загрузился');
        const at = now();
        const edition = buildRadar({
            now: at, cutoff: at, uploads: [...uploads.values()], reuploads: new Set(), maps: taste,
            follows, heard, excluded: (upload) => marks.tracks.has(upload.id) || marks.artists.has(upload.uploader), groups: new Map(), history: [],
        });
        const view = { edition: { ...edition, items: heardLast(edition.items), uploads: heardLast(edition.uploads) }, total: accounts.length, checked };
        memory = { user, at, view };
        try {
            deps.store.set(JSON.stringify({ user, at, view }));
        } catch (error) {
            console.warn('Радар: выпуск не сохранён', error);
        }
        return view;
    }

    return {
        load(force = false) {
            const user = deps.userId();
            if (!user) return Promise.reject(new Error('Нет входа'));
            if (!force) {
                const saved = memory?.user === user ? memory : readSaved(user);
                if (saved && now() - saved.at < TTL) {
                    memory = { user, ...saved };
                    return Promise.resolve(saved.view);
                }
            }
            running ??= build(user).finally(() => { running = null; });
            return running;
        },

        async seed(view, fromId = 0) {
            const items: RadarItem[] = [...view.edition.items, ...view.edition.uploads.filter((item) => !item.fan)];
            const tracks = new Map((await deps.tracksByIds(items.map((item) => item.id))).map((track) => [track.id, track]));
            const marks = deps.excluded();
            let own = items.flatMap((item) => {
                const track = tracks.get(item.id);
                return track && isWaveEligible(track) && !marks.tracks.has(track.id) && !marks.artists.has(trackArtist(track)) ? [{ track, item }] : [];
            });
            const at = fromId ? own.findIndex((entry) => entry.item.id === fromId) : -1;
            if (at >= 0) own = [own[at], ...own.slice(at + 1), ...own.slice(0, at)];
            return {
                kind: 'library', title: deps.texts.radar, order: 'fixed', seeds: [],
                own: own.map(({ track, item }) => ({ track, from: deps.texts.radar, reason: { kind: 'radar', why: radarReason(item.reason, deps.texts) } })),
            };
        },
    };
}