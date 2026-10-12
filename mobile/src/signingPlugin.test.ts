import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const { patch } = createRequire(import.meta.url)('../plugins/withReleaseSigning.js') as { patch(gradle: string): string };

// Кусок build.gradle из шаблона Expo (SDK 57)
const TEMPLATE = `android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            signingConfig signingConfigs.debug
            minifyEnabled true
        }
    }
}`;

describe('подпись релизного APK', () => {
  it('релиз берёт свой ключ из окружения, отладочная сборка остаётся на отладочном', () => {
    const out = patch(TEMPLATE);
    expect(out).toContain("signingConfig System.getenv('ANDROID_KEYSTORE_PATH') ? signingConfigs.release : signingConfigs.debug");
    expect(out.match(/signingConfig signingConfigs\.debug/g)).toHaveLength(1);
    expect(out).toMatch(/signingConfigs \{\s*release \{[\s\S]*ANDROID_KEY_ALIAS[\s\S]*\}\s*debug \{/);
  });

  it('повторный запуск ничего не меняет, чужой шаблон даёт понятную ошибку', () => {
    const once = patch(TEMPLATE);
    expect(patch(once)).toBe(once);
    expect(() => patch('android { }')).toThrow('шаблон build.gradle');
  });
});
