// CI smoke test: serve site/, play all five rounds headlessly under SwiftShader
// (MapLibre needs WebGL), save stills, fail on page errors or a broken loop.
import puppeteer from 'puppeteer';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('site');
const out = path.resolve('stills');
fs.mkdirSync(out, { recursive: true });

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const p = path.join(root, url === '/' ? 'index.html' : url);
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const sl = ms => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--disable-gpu-compositing', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 780 });
const errors = [];
const ignorable = t => /googleapis|RefererNotAllowed|getRootNode|favicon|net::ERR|404/.test(t);
page.on('pageerror', e => { if (!ignorable(e.message)) errors.push('PAGEERROR ' + e.message); });
page.on('console', m => { const t = m.text(); if (m.type() === 'error' && !ignorable(t)) errors.push(t.slice(0, 300)); });

await page.goto(`http://127.0.0.1:${port}/?lang=en`, { waitUntil: 'load', timeout: 90000 });
await page.waitForSelector('#startBtn', { timeout: 30000 });
await page.screenshot({ path: path.join(out, '0_intro.png') });

const rounds = [];
await page.click('#startBtn');
for (let i = 0; i < 5; i++) {
  // the pano (Pannellum canvas or photo fallback) and the guess map must both be up
  try {
    await page.waitForFunction(() => {
      const fb = document.getElementById('photoFallback');
      return (document.querySelector('#pano canvas') || !fb.classList.contains('hidden')) && document.querySelector('#guessMap canvas');
    }, { timeout: 60000 });
  } catch (e) {
    const st = await page.evaluate(() => ({
      round: window.state && state.round, panoCanvas: !!document.querySelector('#pano canvas'),
      fbHidden: document.getElementById('photoFallback').classList.contains('hidden'),
      mapCanvas: !!document.querySelector('#guessMap canvas'), gameShown: !document.getElementById('game').classList.contains('hidden'),
      maplibre: typeof window.maplibregl, pannellum: typeof window.pannellum, webgl: !!document.createElement('canvas').getContext('webgl'),
    }));
    await page.screenshot({ path: path.join(out, `timeout_round${i + 1}.png`) });
    console.error('ROUND WAIT TIMEOUT', JSON.stringify(st), JSON.stringify(errors));
    throw e;
  }
  await sl(1500);
  if (i === 0) await page.screenshot({ path: path.join(out, '1_round1.png') });
  // drop a pin somewhere on the map, then guess
  const map = await page.$('#guessMap');
  const box = await map.boundingBox();
  await page.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.45);
  await page.waitForFunction(() => !document.getElementById('guessBtn').disabled, { timeout: 10000 });
  await page.click('#guessBtn');
  await page.waitForFunction(() => !document.getElementById('reveal').classList.contains('hidden') && document.querySelector('#revealMap canvas'), { timeout: 30000 });
  await sl(1200);
  const r = await page.evaluate(() => ({
    score: document.getElementById('rScore').textContent,
    detail: document.getElementById('rDetail').textContent,
    stop: document.getElementById('rTitle').textContent,
    tour: document.getElementById('tName').textContent,
    link: document.getElementById('tLink').href,
  }));
  rounds.push(r);
  if (i === 0) await page.screenshot({ path: path.join(out, '2_reveal.png') });
  await page.click('#nextBtn');
}
await page.waitForFunction(() => !document.getElementById('end').classList.contains('hidden'), { timeout: 10000 });
await sl(500);
await page.screenshot({ path: path.join(out, '3_end.png') });
const end = await page.evaluate(() => ({
  total: document.getElementById('eTotal').textContent,
  rows: document.querySelectorAll('#eRounds li').length,
  share: document.getElementById('shareText').textContent,
}));
await browser.close();
server.close();

console.log(JSON.stringify({ rounds, end, errors }, null, 2));
const bad = [];
if (rounds.length !== 5) bad.push('did not reach 5 reveals');
for (const r of rounds) {
  if (!/^\d[\d,]*$/.test(r.score) || r.score === '0') bad.push('bad score ' + r.score);
  if (!r.tour || !r.stop) bad.push('reveal missing stop/tour');
  if (!/^https:\/\/xotours\.net\/\d{4}\/\?utm_source=play/.test(r.link)) bad.push('bad tour link ' + r.link);
}
if (end.rows !== 5) bad.push('end screen rows ' + end.rows);
if (!end.share.includes('/25,000')) bad.push('share text ' + end.share);
if (errors.length) bad.push(...errors);
if (bad.length) { console.error('SMOKE FAILED:\n' + bad.join('\n')); process.exit(1); }
console.log('SMOKE OK');
