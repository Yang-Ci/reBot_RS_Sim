import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.argv.find(arg => arg.startsWith('--url='))?.slice(6) ?? 'http://127.0.0.1:5173/';
const browser = await chromium.launch({
  ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}),
  channel: process.env.PLAYWRIGHT_CHANNEL || (process.platform === 'win32' ? 'chrome' : undefined),
  headless: true
});
try {
  const page = await browser.newPage({ serviceWorkers: 'block' });
  await page.goto(new URL('scripts/fixtures/yolo-browser.html', base).href);
  await page.waitForFunction(() => document.querySelector('#status').textContent !== 'loading', null, { timeout: 120000 });
  const text = await page.locator('#status').textContent();
  assert(!text.startsWith('ERROR'), text);
  const results = JSON.parse(text);
  for (const [id, expected] of Object.entries({ red: [.24, -.30], blue: [.34, .06], yellow: [.33, -.20] })) {
    const pose = results[id];
    assert(pose && pose.source === 'yolo-rgbd', `${id} missing pose`);
    assert(Math.hypot(pose.position.x - expected[0], pose.position.y - expected[1]) < .008, `${id}: ${JSON.stringify(pose)}`);
    console.log(`${id}: ${Math.round(pose.confidence * 100)}%, ${JSON.stringify(pose.position)}`);
  }
  assert.equal(results.flatMarker, null, 'A flat surface must not be accepted as a raised object');
  console.log('Flat marker rejected');
} finally { await browser.close(); }
