import { test, expect } from '@playwright/test';
import jsQR from 'jsqr';
import { decodeSignal } from '../../board-games/shared/peer.js';
test.use({ baseURL: 'http://127.0.0.1:4173/xiangqi/' });
const saved = page => page.evaluate(() => JSON.parse(localStorage.getItem('linxi-match-v1')));
async function setAI(page, provider = 'local') {
  await page.locator('#ai-settings-button').click();
  await page.locator('#ai-provider').selectOption(provider);
  await page.locator('#save-ai-settings').click();
}
async function move(page, from, to) { await page.locator(`[data-square="${from}"]`).click(); await page.locator(`[data-square="${to}"]`).click(); }
async function chooseSettings(page, hints = '3', seconds = '3') {
  await page.getByRole('button', { name: '新开一局', exact: true }).click();
  await page.locator('#settings-hints').selectOption(hints); await page.locator('#settings-seconds').selectOption(seconds);
}
async function pair(host, guest, resume = false) {
  if (resume) {
    await host.locator('#connect-button').click(); await host.locator('#create-room').click();
  } else {
    await chooseSettings(host, '1'); await host.locator('#start-host').click();
  }
  await expect(host.locator('#out-code')).toHaveValue(/^LX1\./, { timeout: 15000 });
  const offer = await host.locator('#out-code').inputValue();
  await guest.locator('#connect-button').click(); await guest.locator('#join-room').click();
  await guest.locator('#in-code').fill(offer); await guest.locator('#import-signal').click();
  await expect(guest.locator('#out-code')).toHaveValue(/^LX1\./, { timeout: 15000 });
  const answer = await guest.locator('#out-code').inputValue();
  await host.locator('#in-code').fill(answer); await host.locator('#import-signal').click();
  await expect(host.locator('#mode-label')).toContainText('已连接', { timeout: 20000 });
  await expect(guest.locator('#mode-label')).toContainText('已连接', { timeout: 20000 });
  await host.locator('#connect-dialog .close-dialog').click(); await guest.locator('#connect-dialog .close-dialog').click();
  if (!resume) { await guest.locator('#ready-button').click(); await expect(host.locator('#game-status')).toContainText('红方行棋'); }
}
test('mobile layout, legal moves, AI quota and restored game', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('./');
  await expect(page.locator('.piece')).toHaveCount(32);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await chooseSettings(page, '1'); await page.locator('#start-local').click();
  await setAI(page);
  await move(page, 54, 45); await expect(page.locator('#move-count')).toHaveText('1 手');
  await expect(page.locator('[data-square="45"] .piece')).toHaveText('兵');
  await move(page, 27, 36);
  await page.locator('#hint-button').click();
  await expect(page.locator('#apply-hint')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('#ai-remaining')).toContainText('0');
  expect(await page.locator('.square.suggested').count()).toBe(2);
  await page.locator('#apply-hint').click(); await expect(page.locator('#move-count')).toHaveText('3 手');
  await page.reload(); await expect(page.locator('#move-count')).toHaveText('3 手');
  expect((await saved(page)).game.events.filter(e => e.action.type === 'hint')).toHaveLength(1);
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
});
test('all cached assets support an offline reload and AI worker', async ({ browser }) => {
  const context = await browser.newContext(); const page = await context.newPage(); await page.goto('./');
  await expect(page.locator('#offline')).toHaveText('离线已就绪', { timeout: 10000 });
  await page.reload(); await context.setOffline(true); await page.reload();
  await expect(page.locator('.piece')).toHaveCount(32);
  await setAI(page);
  await chooseSettings(page, '1'); await page.locator('#start-local').click(); await page.locator('#hint-button').click();
  await expect(page.locator('#apply-hint')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('#ai-output')).not.toContainText('引擎不可用');
  await context.close();
});
test('two independent browsers pair, sync, enforce quotas and resume after reload', async ({ browser }) => {
  const a = await browser.newContext(), b = await browser.newContext();
  const host = await a.newPage(), guest = await b.newPage();
  const errors = []; for (const page of [host, guest]) page.on('pageerror', e => errors.push(e.message));
  await Promise.all([host.goto('./'), guest.goto('./')]); await pair(host, guest);
  const before = (await saved(host)).game;
  await guest.locator('#hint-button').click(); await expect(guest.locator('#toast')).toHaveText('AI 暂不可用');
  expect((await saved(guest)).game).toEqual(before);
  expect((await saved(host)).game).toEqual(before);
  await setAI(host); await setAI(guest);
  await move(host, 54, 45); await expect(guest.locator('#move-count')).toHaveText('1 手');
  await guest.locator('#hint-button').click(); await expect(guest.locator('#apply-hint')).toBeVisible({ timeout: 6000 });
  await expect(host.locator('#top-hints')).toHaveText('AI 剩余 0 / 1');
  await guest.locator('#apply-hint').click(); await expect(host.locator('#move-count')).toHaveText('2 手');
  await expect(guest.locator('#move-count')).toHaveText('2 手');
  expect((await saved(host)).game).toEqual((await saved(guest)).game);
  await Promise.all([host.reload(), guest.reload()]);
  await expect(host.locator('#hint-button')).toBeDisabled(); await expect(guest.locator('#hint-button')).toBeDisabled();
  await pair(host, guest, true);
  expect((await saved(host)).game).toEqual((await saved(guest)).game);
  await expect(host.locator('#move-count')).toHaveText('2 手');
  await host.locator('#draw-button').click(); await expect(guest.locator('#draw-panel')).toBeVisible();
  await guest.locator('#accept-draw').click(); await expect(host.locator('#game-status')).toContainText('双方同意和棋');
  expect(errors).toEqual([]);
  await a.close(); await b.close();
});
test('desktop visual and malformed connection input', async ({ page }) => {
  await page.goto('./'); await page.screenshot({ path: 'test-results/desktop.png', fullPage: true });
  await page.locator('#connect-button').click(); await page.locator('#join-room').click();
  await page.locator('#in-code').fill('invalid-code'); await page.locator('#import-signal').click();
  await expect(page.locator('#connect-status')).toContainText('不是有效');
  await expect(page.locator('.piece')).toHaveCount(32);
});
test('generated multipart QR images decode back into the complete offer', async ({ page }) => {
  await page.goto('./'); await chooseSettings(page); await page.locator('#start-host').click();
  await expect(page.locator('#out-code')).toHaveValue(/^LX1\./, { timeout: 15000 });
  const code = await page.locator('#out-code').inputValue();
  const parts = [];
  for (;;) {
    const raw = await page.locator('#qr-image').evaluate(image => {
      const c = document.createElement('canvas'); c.width = image.naturalWidth; c.height = image.naturalHeight;
      const ctx = c.getContext('2d'); ctx.drawImage(image, 0, 0);
      return { pixels: [...ctx.getImageData(0, 0, c.width, c.height).data], width: c.width, height: c.height };
    });
    const decoded = jsQR(new Uint8ClampedArray(raw.pixels), raw.width, raw.height);
    expect(decoded).not.toBeNull(); parts.push(decoded.data);
    if (await page.locator('#qr-pagination').isHidden() || await page.locator('#qr-next').isDisabled()) break;
    const old = await page.locator('#qr-image').getAttribute('src'); await page.locator('#qr-next').click();
    await expect(page.locator('#qr-image')).not.toHaveAttribute('src', old);
  }
  const reconstructed = parts.length === 1 && parts[0].startsWith('LX1.') ? parts[0] : parts.map(p => p.split('.').slice(4).join('.')).join('');
  expect(reconstructed).toBe(code); expect((await decodeSignal(code)).description.type).toBe('offer');
  await page.screenshot({ path: 'test-results/pairing.png', fullPage: true });
});
test('30-second watchdog returns a legal candidate when the engine never replies', async ({ page }) => {
  await page.addInitScript(() => { window.Worker = class { postMessage() {} terminate() {} }; });
  await page.goto('./'); await chooseSettings(page, '1', '30'); await page.locator('#start-local').click();
  await setAI(page);
  const started = Date.now(); await page.locator('#hint-button').click();
  await expect(page.locator('#apply-hint')).toBeVisible({ timeout: 33000 });
  expect(Date.now() - started).toBeLessThan(33000);
  await expect(page.locator('#ai-output')).toContainText('时间预算已到');
  await expect(page.locator('#ai-remaining')).toContainText('0');
  await page.locator('#apply-hint').click(); await expect(page.locator('#move-count')).toHaveText('1 手');
});
test('unconfigured AI is unavailable without charging; explicit configuration persists', async ({ page }) => {
  await page.goto('./'); await chooseSettings(page, '1'); await page.locator('#start-local').click();
  const before = await saved(page);
  await expect(page.locator('#ai-provider-label')).toHaveText('未配置');
  await page.locator('#hint-button').click(); await expect(page.locator('#toast')).toHaveText('AI 暂不可用');
  expect(await saved(page)).toEqual(before);
  await expect(page.locator('#ai-remaining')).toContainText('1');
  await expect(page.locator('#apply-hint')).toBeHidden();
  await setAI(page); await page.reload();
  await expect(page.locator('#ai-provider-label')).toHaveText('本地 AI');
  await page.locator('#hint-button').click(); await expect(page.locator('#apply-hint')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('#ai-remaining')).toContainText('0');
  await setAI(page, 'none'); await page.reload();
  await expect(page.locator('#ai-provider-label')).toHaveText('未配置');
  const used = await saved(page);
  await page.locator('#hint-button').click(); await expect(page.locator('#toast')).toHaveText('AI 暂不可用');
  expect(await saved(page)).toEqual(used);
  await expect(page.locator('#ai-remaining')).toContainText('0');
});

async function askUndo(page, side) {
  await page.locator('#undo-button').click();
  if (side) await page.locator('#undo-side').selectOption(side);
  await page.locator('#request-undo').click();
  await expect(page.locator('#undo-panel')).toBeVisible();
}
test('local undo previews exact plies, pauses play, needs consent and persists quota', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('./');
  await chooseSettings(page, '1'); await page.locator('#start-local').click(); await setAI(page);
  await expect(page.locator('#undo-button')).toBeDisabled();
  await page.locator('#hint-button').click(); await page.locator('#stop-hint').click();
  await move(page, 54, 45); await move(page, 27, 36);
  await askUndo(page, '1'); await expect(page.locator('#undo-text')).toContainText('撤回 2 手');
  await expect(page.locator('#hint-button')).toBeDisabled(); await expect(page.locator('#draw-button')).toBeDisabled();
  await move(page, 56, 47); await expect(page.locator('#move-count')).toHaveText('2 手');
  await page.locator('#reject-undo').click(); await expect(page.locator('#undo-panel')).toBeHidden();
  await expect(page.locator('#move-count')).toHaveText('2 手');
  await askUndo(page, '1'); await page.locator('#accept-undo').click();
  await expect(page.locator('#move-count')).toHaveText('0 手'); await expect(page.locator('#game-status')).toContainText('红方行棋');
  await expect(page.locator('#ai-remaining')).toContainText('0'); await expect(page.locator('.piece')).toHaveCount(32);
  await page.reload(); await expect(page.locator('#move-count')).toHaveText('0 手');
  await expect(page.locator('#ai-remaining')).toContainText('0');
  await move(page, 56, 47); await askUndo(page, '1');
  await page.screenshot({ path: 'test-results/undo-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.reload(); await expect(page.locator('#undo-panel')).toBeHidden();
  await expect(page.locator('#move-count')).toHaveText('1 手');
  expect((await saved(page)).game.events.at(-1).action.reason).toBe('disconnect');
});
test('undo expires after 30 seconds and withdrawal leaves the board unchanged', async ({ page }) => {
  await page.clock.install(); await page.goto('./');
  await move(page, 54, 45); await askUndo(page, '1');
  await page.clock.fastForward(30001);
  await expect(page.locator('#undo-panel')).toBeHidden(); await expect(page.locator('#move-count')).toHaveText('1 手');
  expect((await saved(page)).game.events.at(-1).action.reason).toBe('timeout');
  await askUndo(page, '1'); await page.locator('#withdraw-undo').click();
  await expect(page.locator('#undo-panel')).toBeHidden(); await expect(page.locator('#move-count')).toHaveText('1 手');
  expect((await saved(page)).game.events.at(-1).action.reason).toBe('withdraw');
});
test('network undo requires the opponent, handles clock skew and cancels on disconnect', async ({ browser }) => {
  test.setTimeout(70000);
  const a = await browser.newContext(), b = await browser.newContext();
  const host = await a.newPage(), guest = await b.newPage();
  const errors = []; for (const page of [host, guest]) page.on('pageerror', e => errors.push(e.message));
  await guest.clock.setFixedTime(new Date(Date.now() + 86400000));
  await Promise.all([host.goto('./'), guest.goto('./')]); await pair(host, guest);
  await setAI(host); await host.locator('#hint-button').click(); await host.locator('#stop-hint').click();
  await move(host, 54, 45); await expect(guest.locator('#move-count')).toHaveText('1 手');
  await askUndo(host); await expect(guest.locator('#undo-text')).toContainText('撤回 1 手');
  await expect(host.locator('#accept-undo')).toBeDisabled(); await expect(guest.locator('#accept-undo')).toBeEnabled();
  await guest.locator('#accept-undo').click(); await expect(host.locator('#move-count')).toHaveText('0 手');
  await expect(guest.locator('#move-count')).toHaveText('0 手');
  await expect(host.locator('#ai-remaining')).toContainText('0');
  await move(host, 54, 45); await expect(guest.locator('#move-count')).toHaveText('1 手');
  await move(guest, 27, 36); await expect(host.locator('#move-count')).toHaveText('2 手');
  await move(host, 56, 47); await expect(guest.locator('#move-count')).toHaveText('3 手');
  await askUndo(guest); await expect(host.locator('#undo-text')).toContainText('黑方申请撤回 2 手');
  await expect(guest.locator('#accept-undo')).toBeDisabled(); await host.locator('#reject-undo').click();
  await expect(guest.locator('#undo-panel')).toBeHidden(); await expect(host.locator('#move-count')).toHaveText('3 手');
  await askUndo(guest); await expect(host.locator('#undo-panel')).toBeVisible(); await host.locator('#accept-undo').click();
  await expect(guest.locator('#move-count')).toHaveText('1 手'); await expect(host.locator('#game-status')).toContainText('黑方行棋');
  expect((await saved(host)).game).toEqual((await saved(guest)).game);
  await askUndo(host); await expect(guest.locator('#undo-panel')).toBeVisible();
  await guest.reload(); await expect(host.locator('#mode-label')).toContainText('待连接', { timeout: 10000 });
  await expect(host.locator('#undo-panel')).toBeHidden();
  expect((await saved(host)).game.events.at(-1).action.reason).toBe('disconnect');
  await host.reload(); await pair(host, guest, true);
  await expect(guest.locator('#undo-panel')).toBeHidden(); await expect(host.locator('#move-count')).toHaveText('1 手');
  expect((await saved(host)).game).toEqual((await saved(guest)).game);
  expect(errors).toEqual([]); await a.close(); await b.close();
});
