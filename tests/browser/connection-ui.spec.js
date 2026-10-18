import { test, expect } from '@playwright/test';

async function fakeCamera(page, denied = false) {
  await page.addInitScript(denied => {
    window.__cameraCalls = 0; window.__cameraStops = 0;
    MediaDevices.prototype.getUserMedia = async () => {
      window.__cameraCalls++;
      if (denied) throw new DOMException('Permission denied', 'NotAllowedError');
      const stream = new MediaStream();
      stream.getTracks = () => [{ stop() { window.__cameraStops++; } }];
      return stream;
    };
    HTMLMediaElement.prototype.play = async function () {};
    window.__LINXI_SIGNAL_SERVER__ = { host: '127.0.0.1', port: 4174, path: '/', secure: false, config: { iceServers: [] } };
  }, denied);
}

for (const kind of ['xiangqi', 'gomoku']) {
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 664 }]) {
    test(`${kind}: connection actions, camera and QR fit a ${viewport.width}x${viewport.height} first screen`, async ({ page }) => {
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.setViewportSize(viewport); await fakeCamera(page); await page.goto(`/${kind}/`);
      await page.locator('#connect-button').click();
      await expect(page.locator('#quick-create')).toBeInViewport({ ratio: 1 });
      await expect(page.locator('#quick-join')).toBeInViewport({ ratio: 1 });
      await expect(page.locator('#create-room')).toBeHidden();
      await page.screenshot({ path: `test-results/${kind}-connect-home-${viewport.width}.png` });

      await page.locator('#quick-join').click();
      await expect(page.locator('#camera-panel')).toBeVisible();
      await expect(page.locator('#camera')).toBeInViewport({ ratio: 1 });
      await expect(page.locator('#in-code')).toBeHidden();
      expect(await page.evaluate(() => window.__cameraCalls)).toBe(1);
      await page.screenshot({ path: `test-results/${kind}-connect-camera-${viewport.width}.png` });
      await page.locator('#connect-back').click();
      expect(await page.evaluate(() => window.__cameraStops)).toBe(1);
      await expect(page.locator('#quick-create')).toBeVisible();

      await page.locator('#quick-create').click();
      await expect(page.locator('#start-local')).toBeHidden();
      await expect(page.locator('#start-host')).toBeHidden();
      await page.locator('#start-quick').click();
      await expect(page.locator('#out-code')).toHaveValue(/#join=LXQ1\./);
      await expect(page.locator('#qr-image')).toBeInViewport({ ratio: 1 });
      await expect(page.locator('#copy-code')).toBeInViewport({ ratio: 1 });
      await expect(page.locator('#quick-join')).toBeHidden();
      await page.screenshot({ path: `test-results/${kind}-connect-qr-${viewport.width}.png` });

      await page.locator('#connect-back').click();
      await expect(page.locator('#out-code')).toHaveValue('');
      await page.locator('#offline-options').click(); await page.locator('#create-room').click();
      await expect(page.locator('#out-code')).toHaveValue(/^LX1\./, { timeout: 15000 });
      const offer = await page.locator('#out-code').inputValue();
      await expect(page.locator('#qr-image')).toBeInViewport({ ratio: 1 });
      await expect(page.locator('#scan-response')).toBeInViewport({ ratio: 1 });
      await page.screenshot({ path: `test-results/${kind}-connect-offline-${viewport.width}.png` });
      await page.locator('#scan-response').click();
      await expect(page.locator('#camera')).toBeInViewport({ ratio: 1 });
      await page.locator('#connect-back').click();
      await expect(page.locator('#out-code')).toHaveValue(offer);
      await expect(page.locator('#qr-image')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(errors).toEqual([]);
    });
  }
}

test('denied camera keeps scan and paste alternatives accessible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 664 }); await fakeCamera(page, true); await page.goto('/gomoku/');
  await page.locator('#connect-button').click(); await page.locator('#quick-join').click();
  await expect(page.locator('#connect-status')).toContainText('相机暂不可用');
  await expect(page.locator('#scan-code')).toBeInViewport({ ratio: 1 });
  await page.locator('#paste-details > summary').click();
  await page.locator('#in-code').fill('not-a-valid-code'); await page.locator('#import-signal').click();
  await expect(page.locator('#connect-status')).toContainText('不是有效');
  await page.locator('#connect-back').click();
  await expect(page.locator('#quick-join')).toBeInViewport({ ratio: 1 });
});
