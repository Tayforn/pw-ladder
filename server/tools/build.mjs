// =========================================================
// Збірка бекенда: server/src/index.ts → server/dist/index.mjs (esbuild, усе
// вбудовано, крім опційного pg-native).
//
// ЗАЛЕЖНІСТЬ ВІД ../pw-pvp: прийом заявок на фул-рандом (server/src/pvpRegister.ts)
// імпортує скорер сайту турнірів ../pw-pvp/src/server/scorer.ts разом із моделлю
// ляльки й каталогами речей (JSON вбудовуються в бандл). Тож перед збіркою репо
// pw-pvp має лежати поруч (D:\pw-pvp ↔ D:\pw-ladder) на актуальному коміті —
// тому, що задеплоєно на pvp.thunderpw.fun, — інакше сервер рахуватиме заявки
// іншою версією моделі, ніж браузер і адмінка. Коміт pw-pvp підставляється в
// бандл (__PVP_SCORER__ → item_breakdown.scorer кожної заявки), незакомічені
// зміни в pw-pvp/src дають суфікс -dirty і попередження.
// =========================================================

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PVP = resolve(ROOT, '../pw-pvp');
const SCORER = resolve(PVP, 'src/server/scorer.ts');

if (!existsSync(SCORER)) {
  console.error(`Немає ${SCORER}: збірка бекенда потребує репо pw-pvp поруч (../pw-pvp) на актуальному коміті.`);
  process.exit(1);
}

function pvpCommit() {
  const git = (...args) => execFileSync('git', ['-C', PVP, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  try {
    const sha = git('rev-parse', '--short=12', 'HEAD');
    const dirty = git('status', '--porcelain', '--', 'src').length > 0;
    if (dirty) console.warn(`Увага: у ../pw-pvp/src є незакомічені зміни — бандл позначено pw-pvp@${sha}-dirty.`);
    return `${sha}${dirty ? '-dirty' : ''}`;
  } catch {
    console.warn('Увага: не вдалося прочитати коміт ../pw-pvp (git) — бандл позначено pw-pvp@unknown.');
    return 'unknown';
  }
}

const scorerId = `pw-pvp@${pvpCommit()}`;
const outfile = resolve(ROOT, 'server/dist/index.mjs');

const result = await build({
  absWorkingDir: ROOT,
  entryPoints: [resolve(ROOT, 'server/src/index.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile,
  external: ['pg-native'],
  banner: { js: "import{createRequire}from'module';const require=createRequire(import.meta.url);" },
  define: { __PVP_SCORER__: JSON.stringify(scorerId) },
  // Пакети, які імпортують файли pw-pvp (react у catalog.ts), шукаються спершу в
  // ../pw-pvp/node_modules, а якщо там не встановлено — у нашому node_modules.
  nodePaths: [resolve(ROOT, 'node_modules')],
  metafile: true,
  logLevel: 'warning',
});

// Розмір: увесь бандл і частка pw-pvp (модель ляльки + каталоги JSON).
const out = Object.values(result.metafile.outputs)[0];
const fromPvp = Object.entries(out.inputs)
  .filter(([path]) => resolve(ROOT, path).startsWith(PVP + sep))
  .reduce((s, [, input]) => s + input.bytesInOutput, 0);
const mb = (n) => (n / 1024 / 1024).toFixed(2) + ' МБ';
console.log(`${relative(ROOT, outfile)}: ${mb(out.bytes)}, з них ../pw-pvp — ${mb(fromPvp)}; скорер ${scorerId}`);
