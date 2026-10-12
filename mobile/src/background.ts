import * as BackgroundTask from 'expo-background-task';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { diagnostics } from './addons/instance';
import { auth } from './auth/instance';
import { countText } from './core/waveTexts';
import { settings } from './settings/instance';
import { texts } from './settings/texts';
import { kv, likes, radar } from './wave/data';
import { armRadar, runRadarJob, type RadarJobDeps, type RadarJobResult } from './wave/radarSchedule';

// Загружается при старте (index.ts), в том числе когда систему будит фоновая задача без экрана: задача должна быть
// определена в глобальной области. Здесь же журнал диагностики подписывается на консоль.
// Не тянет плеер: данные радара лежат в wave/data.ts, звук не поднимается.

export const RADAR_TASK = 'radar-weekly';
const CHANNEL = 'radar';

diagnostics.captureConsole();
diagnostics.record('start', 'Запуск');

Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldPlaySound: false, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true }),
});

const done = kv('wave.radar-done.v1');

async function notify(count: number): Promise<void> {
    if (!(await Notifications.getPermissionsAsync()).granted) throw new Error('нет разрешения на уведомления');
    await Notifications.setNotificationChannelAsync(CHANNEL, { name: texts.radar, importance: Notifications.AndroidImportance.DEFAULT });
    const body = settings.getSnapshot().language === 'en'
        ? `${countText(count, 'new release|new releases|new releases', 'en')} for you`
        : `${countText(count, 'новый релиз|новых релиза|новых релизов', 'ru')} для тебя`;
    await Notifications.scheduleNotificationAsync({ content: { title: texts.radar, body, data: { url: '/radar' } }, trigger: { channelId: CHANNEL } });
}

const deps: RadarJobDeps = {
    settings: () => settings.getSnapshot(),
    now: () => Date.now(),
    done,
    // Фоновый запуск стартует без экрана: вход читаем сами
    signedIn: async () => {
        if (auth.getState().status === 'loading') await auth.init();
        return auth.getState().status === 'in';
    },
    build: async () => {
        await likes.load().catch(() => undefined);
        return radar.load(true);
    },
    notify,
    log: (event, message) => diagnostics.record(event, message),
};

let running: Promise<RadarJobResult> | null = null;
/** Проверка срока радара; параллельные вызовы (задача и открытие приложения) делят один проход */
export function checkRadar(): Promise<RadarJobResult> {
    running ??= runRadarJob(deps).finally(() => { running = null; });
    return running;
}

TaskManager.defineTask(RADAR_TASK, async () => {
    try {
        await checkRadar();
        return BackgroundTask.BackgroundTaskResult.Success;
    } catch (error) {
        diagnostics.record('radar', 'Фоновая задача упала: ' + (error instanceof Error ? error.message : String(error)));
        return BackgroundTask.BackgroundTaskResult.Failed;
    }
});

/** Включает или выключает фоновую задачу по настройке; система запускает её не чаще раза в час */
export async function syncRadarTask(enabled: boolean): Promise<void> {
    try {
        const registered = await TaskManager.isTaskRegisteredAsync(RADAR_TASK);
        if (enabled && !registered) await BackgroundTask.registerTaskAsync(RADAR_TASK, { minimumInterval: 60 });
        else if (!enabled && registered) await BackgroundTask.unregisterTaskAsync(RADAR_TASK);
    } catch (error) {
        console.warn('Радар: фоновая задача не настроена', error);
    }
}

/** Разрешение на уведомления (Android 13+); true, если есть */
export async function askNotifications(): Promise<boolean> {
    try {
        const current = await Notifications.getPermissionsAsync();
        return current.granted || (await Notifications.requestPermissionsAsync()).granted;
    } catch (error) {
        console.warn('Разрешение на уведомления не запрошено', error);
        return false;
    }
}

/** Срок или включение радара поменялись: первое уведомление придёт в ближайший срок, а не за прошлый */
export function rearmRadar(): void {
    armRadar(deps);
}
