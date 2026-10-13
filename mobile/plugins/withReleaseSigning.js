// Подпись релизного APK, имя файла SoundCloud-Wave.apk и белая иконка облака в шторке.
const fs = require('fs');
const path = require('path');
const { withAppBuildGradle, withDangerousMod } = require('expo/config-plugins');

const MARK = 'ANDROID_KEYSTORE_PATH';
const APK = 'SoundCloud-Wave.apk';

const ICON = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24">
    <path android:fillColor="#FFFFFF" android:pathData="M9.6,16.6V8.4c0.9,-0.6 2,-0.95 3.2,-0.95 2.5,0 4.6,1.7 5.2,4h0.2c1.9,0 3.4,1.45 3.4,3.25 0,1.1 -0.9,1.9 -2,1.9H9.6z"/>
    <path android:strokeColor="#FFFFFF" android:strokeWidth="1.5" android:strokeLineCap="round" android:pathData="M1.8,13.2v3.4M4.4,11.4v5.2M7,10v6.6"/>
</vector>
`;

function patch(gradle) {
    let out = gradle;
    if (!out.includes(MARK)) {
        const useRelease = `signingConfig System.getenv('${MARK}') ? signingConfigs.release : signingConfigs.debug`;
        const inRelease = /(buildTypes \{[\s\S]*?release \{[^}]*?)signingConfig signingConfigs\.debug/;
        if (!inRelease.test(out) || !/signingConfigs \{/.test(out)) throw new Error('withReleaseSigning: шаблон build.gradle изменился, поправь плагин');
        out = out.replace(inRelease, `$1${useRelease}`).replace(
            /signingConfigs \{/,
            `signingConfigs {
        release {
            if (System.getenv('${MARK}')) {
                storeFile file(System.getenv('${MARK}'))
                storePassword System.getenv('ANDROID_KEYSTORE_PASSWORD')
                keyAlias System.getenv('ANDROID_KEY_ALIAS')
                keyPassword System.getenv('ANDROID_KEY_PASSWORD')
            }
        }`,
        );
    }
    if (!out.includes(APK)) {
        out += `
android.applicationVariants.configureEach { variant ->
    variant.outputs.configureEach { output ->
        output.outputFileName = "${APK}"
    }
}
`;
    }
    return out;
}

module.exports = (config) => {
    config = withAppBuildGradle(config, (modConfig) => {
        modConfig.modResults.contents = patch(modConfig.modResults.contents);
        return modConfig;
    });
    return withDangerousMod(config, [
        'android',
        (mod) => {
            const dir = path.join(mod.modRequest.platformProjectRoot, 'app/src/main/res/drawable');
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, 'notification_icon.xml'), ICON);
            return mod;
        },
    ]);
};
module.exports.patch = patch;
