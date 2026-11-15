// 端到端冒烟测试: 生成演示项目 -> 插值 -> 体渲染 -> 剖面, 截图并收集控制台错误
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:4173';

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH ??
    `${process.env.LOCALAPPDATA}/ms-playwright/chromium-1254/chrome-win64/chrome.exe`,
  args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(`${BASE}/#/projects`, { waitUntil: 'networkidle' });

// 1. 生成演示项目
await page.evaluate(() => {
  [...document.querySelectorAll('button')].find((b) => b.textContent.includes('生成演示项目')).click();
});
await page.waitForTimeout(300);
console.log('项目页:', (await page.textContent('#app')).slice(0, 80).replace(/\n/g, ' '));

// 2. 插值 (64^3, 半径150)
await page.evaluate(() => { location.hash = '#/modeling'; });
await page.waitForTimeout(400);
await page.evaluate(() => {
  [...document.querySelectorAll('button')].find((b) => b.textContent === '64³').click();
  const inputs = [...document.querySelectorAll('input[type=number]')];
  inputs[4].value = '150';
  [...document.querySelectorAll('button')].find((b) => b.textContent === '开始插值').click();
});
await page.waitForFunction(() => document.querySelector('#app').innerText.includes('插值完成'), null, { timeout: 120000 });
console.log('插值完成');

// 3. 体渲染
await page.evaluate(() => { location.hash = '#/volume'; });
await page.waitForTimeout(4000);
const volText = await page.textContent('#app');
console.log('体渲染页 WebGPU:', volText.includes('不支持 WebGPU') ? '不支持!' : '正常');
await page.screenshot({ path: 'shots/volume.png' });

// 拖动传输函数节点模拟: 双击添加一个节点
await page.evaluate(() => {
  const c = document.querySelector('.tf-canvas');
  const r = c.getBoundingClientRect();
  c.dispatchEvent(new MouseEvent('dblclick', { clientX: r.left + r.width * 0.7, clientY: r.top + r.height * 0.4, bubbles: true }));
});
await page.waitForTimeout(500);
await page.screenshot({ path: 'shots/volume_tf.png' });

// 4. 剖面
await page.evaluate(() => { location.hash = '#/section'; });
await page.waitForTimeout(2000);
await page.screenshot({ path: 'shots/section.png' });

// 5. 钻孔管理页
await page.evaluate(() => { location.hash = '#/holes'; });
await page.waitForTimeout(500);
await page.screenshot({ path: 'shots/holes.png' });

console.log('控制台错误:', errors.length ? errors : '无');
await browser.close();
process.exit(errors.length ? 1 : 0);
