// 探针: 渲染一帧并把 WebGPU 画布读到 2D 画布取平均色
import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: true,
  executablePath: `${process.env.LOCALAPPDATA}/ms-playwright/chromium-1254/chrome-win64/chrome.exe`,
  args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[console]', m.text().slice(0, 300)); });
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));

await page.goto('http://localhost:4173/#/projects', { waitUntil: 'networkidle' });
await page.evaluate(() => {
  [...document.querySelectorAll('button')].find((b) => b.textContent.includes('生成演示项目')).click();
});
await page.waitForTimeout(300);
await page.evaluate(() => { location.hash = '#/modeling'; });
await page.waitForTimeout(400);
await page.evaluate(() => {
  [...document.querySelectorAll('button')].find((b) => b.textContent === '64³').click();
  const inputs = [...document.querySelectorAll('input[type=number]')];
  inputs[4].value = '150';
  [...document.querySelectorAll('button')].find((b) => b.textContent === '开始插值').click();
});
await page.waitForFunction(() => document.querySelector('#app').innerText.includes('插值完成'), null, { timeout: 120000 });
await page.evaluate(() => { location.hash = '#/volume'; });
await page.waitForFunction(() => !!(window).__vol, null, { timeout: 15000 });
await page.waitForTimeout(2000);

const probe = await page.evaluate(() => {
  const { renderer, cam, canvas, model } = (window).__vol;
  // 手动渲染一帧
  renderer.render(cam.camera(canvas.width / canvas.height));
  const c2 = document.createElement('canvas');
  c2.width = canvas.width; c2.height = canvas.height;
  const ctx = c2.getContext('2d');
  ctx.drawImage(canvas, 0, 0);
  const d = ctx.getImageData(0, 0, c2.width, c2.height).data;
  let sum = [0, 0, 0], max = [0, 0, 0], nonBg = 0;
  for (let i = 0; i < d.length; i += 4) {
    sum[0] += d[i]; sum[1] += d[i + 1]; sum[2] += d[i + 2];
    max[0] = Math.max(max[0], d[i]); max[1] = Math.max(max[1], d[i + 1]); max[2] = Math.max(max[2], d[i + 2]);
    if (d[i] > 40 || d[i + 1] > 40 || d[i + 2] > 40) nonBg++;
  }
  const n = d.length / 4;
  return {
    canvasSize: [canvas.width, canvas.height],
    avg: sum.map((s) => (s / n).toFixed(1)),
    max,
    nonBgPct: ((nonBg / n) * 100).toFixed(2),
    cam: { theta: cam.theta, phi: cam.phi, radius: cam.radius, target: cam.target },
    boxDiag: model.spacing.map((s, i) => s * ([model.nx, model.ny, model.nz][i] - 1)),
  };
});
console.log(JSON.stringify(probe, null, 1));
await browser.close();
