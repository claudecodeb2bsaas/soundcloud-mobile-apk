import { createAudioPlayer, setAudioModeAsync, type AudioStatus } from 'expo-audio';
import { PermissionsAndroid, Platform } from 'react-native';
import type { AudioEngine, EngineStatus, TrackMeta } from './controller';

// Движок на expo-audio (ExoPlayer на Android). Один плеер на всё приложение: адрес меняется через replace.
// Фоновая игра держится на сервисе expo-audio и управлении с экрана блокировки (setActiveForLockScreen).
// Ограничение expo-audio: в шторке есть пауза и перемотка на 10 секунд, кнопок «дальше» и «назад» нет.

/** Android 13+: без разрешения шторка с управлением не покажется, а звук всё равно играет */
async function askNotifications(): Promise<void> {
    if (Platform.OS !== 'android' || Platform.Version < 33) return;
    try {
        await PermissionsAndroid.request('android.permission.POST_NOTIFICATIONS' as never);
    } catch (error) {
        console.warn('Разрешение на уведомления не запрошено', error);
    }
}

export function createExpoEngine(): AudioEngine {
    setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: 'doNotMix' }).catch((error: unknown) =>
        console.warn('Режим звука не задан', error),
    );
    const player = createAudioPlayer(null, { updateInterval: 500 });
    const listeners = new Set<(status: EngineStatus) => void>();
    // После replace события прежнего трека не должны сойти за события нового: слушаем с первого «загружен и не закончен»
    let armed = false;
    let startAt = 0;
    let lockActive = false;
    let asked = false;

    const subscription = player.addListener('playbackStatusUpdate', (s: AudioStatus) => {
        if (!armed) {
            if (s.isLoaded && !s.didJustFinish) {
                armed = true;
                if (startAt > 0) {
                    void player.seekTo(startAt);
                    startAt = 0;
                }
            } else if (!s.error) return;
        }
        const status: EngineStatus = {
            playing: s.playing,
            buffering: s.isBuffering,
            loaded: s.isLoaded,
            position: s.currentTime,
            duration: s.duration,
            finished: s.didJustFinish,
            error: s.error,
        };
        for (const listener of [...listeners]) listener(status);
    });

    return {
        load(url: string, meta: TrackMeta, options) {
            armed = false;
            startAt = options.startAt;
            player.replace({ uri: url });
            if (options.autoplay) player.play();
            if (!lockActive) {
                player.setActiveForLockScreen(true, meta, { showSeekBackward: true, showSeekForward: true });
                lockActive = true;
            } else player.updateLockScreenMetadata(meta);
            if (!asked) {
                asked = true;
                void askNotifications();
            }
        },
        play: () => player.play(),
        pause: () => player.pause(),
        seekTo: (seconds) => void player.seekTo(seconds),
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        release() {
            listeners.clear();
            subscription.remove();
            player.clearLockScreenControls();
            player.remove();
        },
    };
}
