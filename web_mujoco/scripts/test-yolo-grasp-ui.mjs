import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.argv.find(arg => arg.startsWith('--url='))?.slice(6) ?? 'http://127.0.0.1:5173/';
const url = new URL('?variant=arm&vision=yolo', base);
const health = await fetch(new URL('api/yolo/health', url));
assert(health.ok && (await health.json()).ready, 'Start Vite and the local YOLOE service first');
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL || (process.platform === 'win32' ? 'chrome' : undefined),
  headless: true,
  args: ['--enable-webgl', '--ignore-gpu-blocklist']
});
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 850 }, serviceWorkers: 'block' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url.href, { waitUntil: 'domcontentloaded' });
  await page.locator('#loading-overlay.is-hidden').waitFor({ state: 'attached', timeout: 90000 });
  const start = page.locator('#start-yolo-grasp');
  const status = page.locator('#yolo-grasp-status');
  const select = id => page.locator(`#vision-targets [data-target="${id}"]`).click();

  for (const id of ['blue', 'red', 'yellow']) {
    await page.locator('#reset').click();
    await select(id);
    if (id === 'blue') {
      // Move the block 30 mm forward and 15 mm left via the actual editor.
      await page.keyboard.press('w');
      await page.keyboard.press('w');
      await page.keyboard.press('a');
    }
    const response = page.waitForResponse(item => item.url().endsWith('/api/yolo/detect'));
    await start.click();
    const reply = await response;
    assert(reply.ok(), `Inference HTTP ${reply.status()}`);
    await page.waitForFunction(() => {
      const text = document.getElementById('yolo-grasp-status').textContent;
      return text.startsWith('YOLOE ') || text.startsWith('No reliable') || text.startsWith('Could not');
    });
    const message = await status.textContent();
    assert.match(message, /^YOLOE \d+%/, `${id}: ${message}; ${(await reply.text()).slice(0, 700)}`);
    if (id === 'blue') {
      const position = message.match(/X (\d+) mm · Y (-?\d+) mm/);
      assert(position && Math.abs(Number(position[1]) - 370) < 8 && Math.abs(Number(position[2]) - 75) < 8,
        `Observed pose should follow the moved block: ${message}`);
    }
    await page.waitForFunction(() => document.getElementById('grasp-progress').value === 1, null, { timeout: 45000 });
    const stage = await page.locator('#grasp-stage').textContent();
    assert.equal(stage, 'Grasp complete', `${id}: ${message}; ${stage} (${await page.locator('#grasp-stage').getAttribute('data-message')})`);
    console.log(`${id}: ${message} · ${stage}`);
    if (id === 'blue') {
      await mkdir('.reports/yolo-grasp', { recursive: true });
      await page.locator('#grasp-controls').screenshot({ path: '.reports/yolo-grasp/vision-ui.png' });
    }
  }

  await page.locator('#reset').click();
  await select('blue');
  // Simulate a high-confidence false detection around the flat blue marker.
  await page.route('**/api/yolo/detect', route => route.fulfill({ json: { detections: [{
    id: 'blue', confidence: .99, box: [373, 216, 419, 263], polygon: [[373, 216], [419, 216], [419, 263], [373, 263]]
  }] } }));
  await start.click();
  await page.waitForFunction(() => document.getElementById('yolo-grasp-status').textContent.startsWith('No reliable'));
  assert.equal(await page.locator('#grasp-progress').evaluate(progress => progress.value), 0);
  assert.deepEqual(errors, []);
  console.log('Flat storage marker rejected before motion, no page errors');
} finally {
  await browser.close();
}
