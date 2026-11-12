// Dev probe: what does the pano container hold after Start? (not run in CI)
import puppeteer from 'puppeteer';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve('site');
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const p = path.join(root, url === '/' ? 'index.html' : url);
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200); fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-compositing', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 780 });
const log = [];
page.on('console', m => { const t = m.text(); if (!/GL Driver|Canvas2D/.test(t)) log.push(m.type() + ': ' + t.slice(0, 200)); });
page.on('pageerror', e => log.push('PAGEERROR ' + e.message));
page.on('request', r => { const u = r.url(); if (!/cartocdn|basemaps/.test(u)) log.push('REQ ' + u.slice(0, 120)); });
page.on('response', r => { const u = r.url(); if (/panoramas|xotours|wikimedia/.test(u)) log.push('RES ' + r.status() + ' ' + u.slice(0, 120)); });
await page.goto(`http://127.0.0.1:${port}/?lang=en`, { waitUntil: 'load' });
await page.click('#startBtn');
const snap = () => page.evaluate(() => ({
  t: Math.round(performance.now()), canvas: !!document.querySelector('#pano canvas'),
  loadBox: (document.querySelector('.pnlm-load-box') || {}).style?.display, lmsg: (document.querySelector('.pnlm-lmsg') || {}).textContent,
  errMsg: (document.querySelector('.pnlm-error-msg') || {}).textContent, loaded: window.pnlmViewer ? pnlmViewer.isLoaded() : null,
  maxTex: (() => { const gl = document.createElement('canvas').getContext('webgl'); return gl && gl.getParameter(gl.MAX_TEXTURE_SIZE); })(),
}));
for (const ms of [3000, 10000, 20000, 30000]) { await new Promise(r => setTimeout(r, ms)); console.log(JSON.stringify(await snap())); }
console.log(log.join('\n'));
await browser.close(); server.close();
