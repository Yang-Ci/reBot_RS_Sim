import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright';

const externalUrl = process.argv.find(arg => arg.startsWith('--url='))?.slice(6);
let server, browser;
try {
  if (!externalUrl) {
    server = await createServer({
      optimizeDeps: {include: ['onnxruntime-web/wasm']},
      server: {host: '127.0.0.1', port: 5199, strictPort: true}
    });
    await server.listen();
  }
  const url = new URL('?variant=arm&vision=yolo', externalUrl || 'http://127.0.0.1:5199/');
  browser = await chromium.launch({
    ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? {executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH} : {}),
    channel: process.env.PLAYWRIGHT_CHANNEL || (process.platform === 'win32' ? 'chrome' : undefined),
    headless: true,
    args: [...(process.argv.includes('--hardware') ? [] : ['--use-angle=swiftshader']), '--enable-webgl', '--ignore-gpu-blocklist']
  });
  for (const scenario of ['ready-before-click', 'click-during-preload', 'retry-after-failure']) {
    console.log(`Checking ${scenario}`);
    const context = await browser.newContext({viewport: {width: 1200, height: 850}, deviceScaleFactor: process.argv.includes('--hardware') ? 1 : .5, serviceWorkers: 'block'});
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    try {
      const page = await context.newPage();
      const errors = [];
      let requests = 0;
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/yolo/objects.onnx', async route => {
        requests++;
        if (requests === 1) {
          if (scenario === 'retry-after-failure') return route.abort('failed');
          await gate;
        }
        await route.continue();
      });
      await page.goto(url.href, {waitUntil: 'domcontentloaded'});
      await page.locator('#loading-overlay.is-hidden').waitFor({state: 'attached', timeout: 180000});
      const status = page.locator('#yolo-grasp-status');
      // The model request is held open: the page must already be usable and
      // the background preload must begin without a grasp click.
      await page.waitForFunction(() => {
        const text = document.getElementById('yolo-grasp-status').textContent;
        return text.startsWith('Preparing the vision') || text.startsWith('Vision model preparation failed');
      });
      assert(await page.locator('#reset').isEnabled());
      await page.locator('#vision-targets [data-target="blue"]').click();
      if (scenario === 'retry-after-failure') {
        await page.waitForFunction(() => document.getElementById('yolo-grasp-status').textContent.startsWith('Vision model preparation failed'), null, {timeout: 120000});
        assert.equal(requests, 1);
      } else if (scenario === 'ready-before-click') {
        release();
        await page.waitForFunction(() => document.getElementById('yolo-grasp-status').textContent.startsWith('Vision model ready.'), null, {timeout: 120000});
        assert.equal(requests, 1);
      }
      await page.evaluate(() => {
        window.preloadTestStatuses = [];
        new MutationObserver(() => window.preloadTestStatuses.push(document.getElementById('yolo-grasp-status').textContent))
          .observe(document.getElementById('yolo-grasp-status'), {childList: true, subtree: true, characterData: true});
      });
      await page.locator('#start-yolo-grasp').click();
      release();
      await page.waitForFunction(() => {
        const text = document.getElementById('yolo-grasp-status').textContent;
        return text.startsWith('YOLOE ') || text.startsWith('No reliable') || text.startsWith('Could not');
      }, null, {timeout: 120000});
      const result = await status.textContent();
      // This suite gates model preparation and reuse. SwiftShader can exceed
      // the existing 4-second camera-frame age limit, which must still reject
      // stale poses. A hardware run additionally requires an accepted pose.
      assert.match(result, process.argv.includes('--hardware') ? /^YOLOE \d+%/ : /^(YOLOE \d+%|No reliable grasp pose\.)/, scenario);
      assert.match(await page.locator('#yolo-grasp-confidence-initial').textContent(), /\d+\.\d%/, 'Real inference must complete even if a slow camera frame is rejected');
      const messages = await page.evaluate(() => window.preloadTestStatuses);
      if (scenario === 'ready-before-click') assert(messages.includes('Reading the overhead camera and recognizing the target…'));
      else assert(messages.includes('Loading the vision model or reading the overhead camera…'));
      assert(!messages.some(message => message.startsWith('Vision model ready.')), 'Preload completion must not overwrite a grasp result');
      assert.equal(requests, scenario === 'retry-after-failure' ? 2 : 1, 'Reuse the loaded model; retry only after failure');
      assert.deepEqual(errors, []);
      console.log(`${scenario}: automatic preload, camera inference and model reuse passed`);
    } finally {
      release();
      await context.close();
    }
  }
} finally {
  await browser?.close();
  await server?.close();
}
