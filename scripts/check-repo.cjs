const { execFileSync, spawnSync } = require('node:child_process');
const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
// Проверяем и принудительно добавленные файлы, учитывая общие и локальные исключения Git.
const ignored = spawnSync('git', ['check-ignore', '--no-index', '--stdin', '-z'], { input: files.join('\0') + '\0', encoding: 'utf8' });
if (ignored.error) throw ignored.error;
if (ignored.status !== 0 && ignored.status !== 1) throw new Error(ignored.stderr || 'Не удалось проверить исключения Git');
const excluded = new Set(ignored.stdout.split('\0').filter(Boolean));
const forbidden = files.filter(file => excluded.has(file) || /(^|\/)(docs|node_modules|build|tsc)(\/|$)/i.test(file) ||
    /(^|\/)\.env($|\.)/i.test(file) ||
    // Лицензия шрифта OFL обязана ехать рядом с файлами шрифта
    (/\.(md|txt)$/i.test(file) && !/^(README\.md|LICENSE(?:\.txt)?)$/i.test(file) && !/(^|\/)fonts\/OFL\.txt$/.test(file) && !/^mobile\/[^/]+\.md$/.test(file)) || /\.(pem|pfx|p12|key|log)$/i.test(file));
if (forbidden.length) { console.error('Лишние файлы в репозитории:\n' + forbidden.join('\n')); process.exitCode = 1; }
else console.log('Состав репозитория проверен');
