import { build } from 'esbuild';
import { mkdir, cp, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
const require = createRequire(import.meta.url);
const qrSource = await readFile(require.resolve('qrcode-generator'), 'utf8');
const qrLicense = qrSource.slice(0, qrSource.indexOf('var qrcode'));
const mit = `Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.\n`;

const notices = 'qrcode-generator 1.4.4\n' + qrLicense + mit + '\njsQR 1.4.0\n' + await readFile(resolve(dirname(require.resolve('jsqr/package.json')), 'LICENSE'), 'utf8');
for (const kind of ['xiangqi', 'gomoku']) {
  const source = `board-games/${kind}`, dest = `public/${kind}`;
  await rm(dest, { recursive: true, force: true }); await mkdir(dest, { recursive: true });
  await cp(`${source}/public`, dest, { recursive: true });
  const extraStyle = kind === 'gomoku' ? await readFile(`${source}/public/style.css`, 'utf8') : '';
  await writeFile(`${dest}/style.css`, await readFile('board-games/shared/style.css', 'utf8') + '\n' + extraStyle);
  await build({ entryPoints: { app: `${source}/src/app.js`, 'ai-worker': `${source}/src/ai-worker.js` },
    alias: { '@game/rules': resolve(`${source}/src/rules.js`), '@game/state': resolve(`${source}/src/game.js`), '@game/config': resolve(`${source}/src/config.js`) },
    bundle: true, outdir: dest, format: 'esm', target: ['safari16.4', 'chrome110'], minify: true, legalComments: 'eof' });
  await writeFile(`${dest}/THIRD_PARTY_NOTICES.txt`, notices);
  const assets = (await readdir(dest)).filter(f => f !== 'sw.js').sort(), hash = createHash('sha256');
  for (const f of assets) hash.update(await readFile(`${dest}/${f}`));
  const revision = hash.digest('hex').slice(0, 12);
  const sw = (await readFile('board-games/shared/sw.js', 'utf8')).replace('__REVISION__', revision).replace('__ASSETS__', JSON.stringify(['./', ...assets.map(f => './' + f)]));
  await writeFile(`${dest}/sw.js`, sw);
  console.log(`${kind}: ${revision}, ${assets.length} offline assets`);
}
