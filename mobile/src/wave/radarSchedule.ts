import { isRadarTime, type Settings } from '../settings/settings';
import type { TextStore } from './marks';
import type { RadarView } from './radar';

// Плановый выпуск радара: раз в неделю в выбранные день и час по времени телефона. На desktop это класс RadarScheduler с
// таймерами окна Electron и часовым поясом из настроек; здесь запуск делает система (фоновая задача, раз в час и реже),
// а решает, пора ли, эта чистая логика. Период это последний прошедший момент «день недели + час»; если для него
// уведомление не отправлялось, выпуск пора собрать.

export interface RadarPeriod {
    /** Дата начала периода YYYY-MM-DD по местному времени: сравнивается как строка */
    key: string;
    /** Начало периода */
    at: number;
}

export function radarPeriod(now: number, day: number, time: string): RadarPeriod {
    const [hour, minute] = (isRadarTime(time) ? time : '09:00').split(':').map(Number);
    const today = new Date(now);
    const at = (back: number): Date => new Date(today.getFullYear(), today.getMonth(), today.getDate() - back, hour, minute);
    let back = (today.getDay() - day + 7) % 7;
    // Сегодня тот самый день, но час ещё не наступил: период начался неделю назад
    if (at(back).getTime() > now) back += 7;
    const start = at(back);
    const pad = (value: number): string => String(value).padStart(2, '0');
    return { key: `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`, at: start.getTime() };
}

export type RadarJobResult = 'off' | 'baseline' | 'not-due' | 'no-session' | 'sent' | 'empty' | 'failed';

export interface RadarJobDeps {
    settings(): Pick<Settings, 'radarEnabled' | 'radarDay' | 'radarTime'>;
    now(): number;
    /** Ключ последнего периода, по которому радар собран; пусто на первом запуске */
    done: TextStore;
    /** Ждёт чтения сохранённого входа; true, если аккаунт есть */
    signedIn(): Promise<boolean>;
    /** Принудительная сборка выпуска */
    build(): Promise<RadarView>;
    notify(count: number): Promise<void>;
    log(event: string, message: string): void;
}

/**
 * Одна проверка: не пора ли собрать радар и сообщить. Безопасно звать часто: если период уже обработан, сеть не
 * трогается. Сбой сборки период не закрывает, следующий запуск повторит.
 */
export async function runRadarJob(deps: RadarJobDeps): Promise<RadarJobResult> {
    const setting = deps.settings();
    if (!setting.radarEnabled) return 'off';
    const period = radarPeriod(deps.now(), setting.radarDay, setting.radarTime);
    const last = deps.done.get();
    // Первый запуск: уведомление о неделе, которая прошла до установки, не нужно; ждём ближайший срок
    if (last === null) {
        deps.done.set(period.key);
        return 'baseline';
    }
    if (last >= period.key) return 'not-due';
    if (!(await deps.signedIn())) return 'no-session';
    let view: RadarView;
    try {
        view = await deps.build();
    } catch (error) {
        deps.log('radar', 'Радар не собран: ' + (error instanceof Error ? error.message : String(error)));
        return 'failed';
    }
    deps.done.set(period.key);
    const count = view.edition.items.filter((item) => !item.heard).length;
    deps.log('radar', `Выпуск ${period.key}: новых ${count}, проверено ${view.checked} из ${view.total}`);
    if (!count) return 'empty';
    try {
        await deps.notify(count);
    } catch (error) {
        deps.log('radar', 'Уведомление не показано: ' + (error instanceof Error ? error.message : String(error)));
    }
    return 'sent';
}

/** Закрывает текущий период без сборки: после включения радара или смены срока первое уведомление придёт в следующий срок */
export function armRadar(deps: Pick<RadarJobDeps, 'settings' | 'now' | 'done'>): void {
    const setting = deps.settings();
    deps.done.set(radarPeriod(deps.now(), setting.radarDay, setting.radarTime).key);
}
