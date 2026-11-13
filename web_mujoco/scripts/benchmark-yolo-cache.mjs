import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {preview} from 'vite';
import {chromium} from 'playwright';

const external = process.argv.find(arg => arg.startsWith('--url='))?.slice(6);
let server, browser;
try {
  if (!external) server = await preview({preview: {host: '127.0.0.1', port: 5197, strictPort: true}});
  const base = external || server.resolvedUrls.local[0];
  browser = await chromium.launch({
    ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? {executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH} : {}),
    channel: process.env.PLAYWRIGHT_CHANNEL || (process.platform === 'win32' ? 'chrome' : undefined),
    headless: true, args: [...(process.argv.includes('--hardware') ? [] : ['--use-angle=swiftshader']), '--enable-webgl', '--ignore-gpu-blocklist']
  });
  const context = await browser.newContext({viewport: {width: 1200, height: 850}, deviceScaleFactor: process.argv.includes('--hardware') ? 1 : .5, serviceWorkers: 'block'});
  try {
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', {cacheDisabled: true});
    let requests = 0, blockModel = false;
    await page.route('**/yolo/objects.onnx*', async route => {
      requests++;
      if (blockModel) return route.abort('failed');
      return route.continue();
    });
    const url = new URL('?variant=arm&vision=yolo', base).href;
    async function visit() {
      const start = performance.now();
      await page.goto(url, {waitUntil: 'domcontentloaded'});
      await page.waitForFunction(() => window.rebotYoloStartupMetrics?.(), null, {timeout: 180000});
      return {pageToReadyMs: performance.now() - start, ...await page.evaluate(() => window.rebotYoloStartupMetrics())};
    }
    const cold = await visit();
    assert.equal(cold.source, 'network'); assert.equal(requests, 1);
    const cacheKeys = await page.evaluate(async () => (await (await caches.open('rebot-yolo-model-v1')).keys()).map(request => request.url));
    assert.equal(cacheKeys.length, 1); assert.match(cacheKeys[0], /objects\.onnx\?v=[a-f0-9]{16}$/);
    if (!external) {
      const bytes = await readFile(new URL('../public/yolo/objects.onnx', import.meta.url));
      const expected = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
      assert.equal(new URL(cacheKeys[0]).searchParams.get('v'), expected);
    }
    blockModel = true;
    const warm = await visit();
    assert.equal(warm.source, 'cache'); assert.equal(requests, 1, 'Repeat visit must work even when model network is blocked');
    assert.equal(warm.bytes, cold.bytes);
    await page.locator('#vision-targets [data-target="blue"]').click();
    await page.locator('#start-yolo-grasp').click();
    await page.waitForFunction(() => {
      const status = document.getElementById('yolo-grasp-status').textContent;
      return status.startsWith('YOLOE ') || status.startsWith('No reliable') || status.startsWith('Could not');
    }, null, {timeout: 120000});
    // Slow software renderers can exceed the existing frame-age limit; the
    // recognition must still run, and the stale pose must remain rejected.
    const status = await page.locator('#yolo-grasp-status').textContent();
    assert.match(status, process.argv.includes('--hardware') ? /^YOLOE \d+%/ : /^(YOLOE \d+%|No reliable grasp pose\.)/);
    assert.match(await page.locator('#yolo-grasp-confidence-initial').textContent(), /\d+\.\d%/);
    assert.deepEqual(errors, []);
    const report = {cold, warm, recognitionStatus: status, cacheKeys, networkRequests: requests, browser: await browser.version(), note: 'Same browser context; HTTP cache disabled; model network blocked on repeat; no network throttling.'};
    await mkdir('.reports', {recursive: true});
    await writeFile('.reports/yolo-cache-benchmark.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {await context.close();}
} finally {await browser?.close(); await server?.close();}
