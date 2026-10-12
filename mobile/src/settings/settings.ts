import type { TextStore } from '../wave/marks';

// Настройки приложения одним JSON в kv-store. Читаются недоверенно (резервная копия, старые версии): каждое поле
// проверяется отдельно, негодное заменяется значением по умолчанию. На desktop то же делают validateSetting и settingsManager.

export type Language = 'ru' | 'en';

export interface Settings {
    /** Язык подписей волны, радара и подборок; применяется при следующем запуске */
    language: Language;
    /** Прослушивания не пишутся в журнал и вкус, вебхук молчит */
    incognito: boolean;
    webhookEnabled: boolean;
    webhookUrl: string;
    /** Сколько трека нужно прослушать до вебхука, процентов */
    webhookPercent: number;
    /** Радар релизов в день и час недели: фоновая сборка и уведомление */
    radarEnabled: boolean;
    /** День недели 0-6, воскресенье 0 */
    radarDay: number;
    radarTime: string;
}

export const DEFAULT_SETTINGS: Settings = {
    language: 'ru', incognito: false, webhookEnabled: false, webhookUrl: '', webhookPercent: 50,
    radarEnabled: true, radarDay: 5, radarTime: '09:00',
};

export const isWebhookUrl = (value: unknown): value is string => typeof value === 'string' && value.length <= 500 && /^https?:\/\/[^\s/]+\S*$/i.test(value);
export const isRadarTime = (value: unknown): value is string => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

export function cleanSettings(input: unknown): Settings {
    const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    const D = DEFAULT_SETTINGS;
    const flag = (key: 'incognito' | 'webhookEnabled' | 'radarEnabled'): boolean => (typeof raw[key] === 'boolean' ? (raw[key] as boolean) : D[key]);
    const percent = raw.webhookPercent;
    const day = raw.radarDay;
    return {
        language: raw.language === 'en' || raw.language === 'ru' ? raw.language : D.language,
        incognito: flag('incognito'),
        webhookEnabled: flag('webhookEnabled'),
        webhookUrl: isWebhookUrl(raw.webhookUrl) ? raw.webhookUrl : D.webhookUrl,
        webhookPercent: typeof percent === 'number' && Number.isFinite(percent) ? Math.round(Math.min(100, Math.max(0, percent))) : D.webhookPercent,
        radarEnabled: flag('radarEnabled'),
        radarDay: typeof day === 'number' && Number.isInteger(day) && day >= 0 && day <= 6 ? day : D.radarDay,
        radarTime: isRadarTime(raw.radarTime) ? raw.radarTime : D.radarTime,
    };
}

export interface SettingsStore {
    /** Снимок меняется при каждой правке: для useSyncExternalStore */
    getSnapshot(): Settings;
    subscribe(listener: () => void): () => void;
    set(patch: Partial<Settings>): void;
    /** Заменяет всё (восстановление копии) */
    replace(next: unknown): void;
}

export function createSettings(store: TextStore): SettingsStore {
    const read = (): Settings => {
        try {
            return cleanSettings(JSON.parse(store.get() ?? 'null'));
        } catch {
            return cleanSettings(null);
        }
    };
    let data = read();
    const listeners = new Set<() => void>();
    const change = (next: Settings): void => {
        data = next;
        try {
            store.set(JSON.stringify(data));
        } catch (error) {
            console.warn('Настройки не сохранены', error);
        }
        for (const listener of [...listeners]) listener();
    };
    return {
        getSnapshot: () => data,
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        set: (patch) => change(cleanSettings({ ...data, ...patch })),
        replace: (next) => change(cleanSettings(next)),
    };
}
