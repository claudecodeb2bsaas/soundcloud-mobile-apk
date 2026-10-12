// Подпись релизного APK своим ключом. Ключ приходит из окружения (в CI это секреты репозитория); без него сборка
// подписывается отладочным ключом, как у шаблона Expo, чтобы локальная сборка не требовала хранилища.
// ANDROID_KEYSTORE_PATH, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS, ANDROID_KEY_PASSWORD
const { withAppBuildGradle } = require('expo/config-plugins');

const MARK = 'ANDROID_KEYSTORE_PATH';

function patch(gradle) {
    if (gradle.includes(MARK)) return gradle;
    const useRelease = `signingConfig System.getenv('${MARK}') ? signingConfigs.release : signingConfigs.debug`;
    const inRelease = /(buildTypes \{[\s\S]*?release \{[^}]*?)signingConfig signingConfigs\.debug/;
    if (!inRelease.test(gradle) || !/signingConfigs \{/.test(gradle)) throw new Error('withReleaseSigning: шаблон build.gradle изменился, поправь плагин');
    return gradle.replace(inRelease, `$1${useRelease}`).replace(
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

module.exports = (config) =>
    withAppBuildGradle(config, (modConfig) => {
        modConfig.modResults.contents = patch(modConfig.modResults.contents);
        return modConfig;
    });
module.exports.patch = patch;
