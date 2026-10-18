import { test, expect } from '@playwright/test';
test.use({ baseURL: 'http://127.0.0.1:4173/gomoku/' });
const saved = page => page.evaluate(() => JSON.parse(localStorage.getItem('linxi-gomoku-match-v1')));
async function place(page, index) {
  await page.locator(`[data-square="${index}"]`).click();
  await page.locator('#place-button').click();
}
async function enableAI(page, seconds = '3') {
  await page.locator('#new-button').click();
  await page.locator('#settings-hints').selectOption('1');
  await page.locator('#settings-seconds').selectOption(seconds);
  await page.locator('#start-local').click();
  await page.locator('#ai-settings-button').click();
  await page.locator('#ai-provider').selectOption('local'); await page.locator('#save-ai-settings').click();
}
async function pair(host, guest, resume = false) {
  if (resume) { await host.locator('#connect-button').click(); await host.locator('#offline-options').click(); await host.locator('#create-room').click(); }
  else { await host.locator('#new-button').click(); await host.locator('#start-host').click(); }
  await expect(host.locator('#out-code')).toHaveValue(/^LX1\./, { timeout:15000 });
  const offer = await host.locator('#out-code').inputValue();
  await guest.locator('#connect-button').click(); await guest.locator('#offline-options').click(); await guest.locator('#join-room').click();
  await guest.locator('#paste-details > summary').click();
  await guest.locator('#in-code').fill(offer); await guest.locator('#import-signal').click();
  await expect(guest.locator('#out-code')).toHaveValue(/^LX1\./, { timeout:15000 });
  await host.locator('#scan-response').click(); await host.locator('#paste-details > summary').click();
  await host.locator('#in-code').fill(await guest.locator('#out-code').inputValue());
  await host.locator('#import-signal').click();
  for (const page of [host,guest]) {
    await expect(page.locator('#mode-label')).toContainText('已连接',{timeout:20000});
    await page.locator('#connect-dialog .dialog-heading .close-dialog').click();
  }
  if (!resume) { await guest.locator('#ready-button').click(); await expect(host.locator('#game-status')).toContainText('黑方行棋'); }
}
test('mobile preview, confirm, win, refresh and unavailable AI', async ({ page }) => {
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.setViewportSize({width:390,height:844}); await page.goto('./');
  await expect(page.locator('.square')).toHaveCount(225); await expect(page.locator('.stone')).toHaveCount(0);
  await page.locator('#hint-button').click(); await expect(page.locator('#toast')).toHaveText('AI 暂不可用');
  expect(await saved(page)).toBeNull();
  await page.locator('[data-square="105"]').click(); await expect(page.locator('.stone')).toHaveCount(0);
  await page.locator('#place-button').click(); await expect(page.locator('.stone.dark')).toHaveCount(1);
  await page.locator('[data-square="105"]').click(); await expect(page.locator('#move-count')).toHaveText('1 手');
  for(const index of [0,106,2,107,4,108,6,109]) await place(page,index);
  await expect(page.locator('#game-status')).toContainText('黑方胜');
  await expect(page.locator('.winning')).toHaveCount(5); await expect(page.locator('#place-button')).toBeDisabled();
  await page.reload(); await expect(page.locator('#move-count')).toHaveText('9 手');
  await expect(page.locator('#game-status')).toContainText('黑方胜');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({path:'test-results/gomoku-mobile.png',fullPage:true});
});
test('both PWAs cache independently; offline Gomoku AI works and Xiangqi save remains', async ({ browser }) => {
  const context=await browser.newContext(); const page=await context.newPage();
  await page.goto('http://127.0.0.1:4173/xiangqi/');
  await expect(page.locator('#offline')).toHaveText('离线已就绪');
  await page.locator('[data-square="54"]').click(); await page.locator('[data-square="45"]').click();
  const old=await page.evaluate(()=>localStorage.getItem('linxi-match-v1'));
  await page.goto('http://127.0.0.1:4173/gomoku/'); await expect(page.locator('#offline')).toHaveText('离线已就绪');
  await enableAI(page); await context.setOffline(true); await page.reload();
  await page.locator('#hint-button').click(); await expect(page.locator('#apply-hint')).toBeVisible({timeout:5000});
  await expect(page.locator('#ai-output')).not.toContainText('引擎不可用');
  await expect(page.locator('#ai-remaining')).toContainText('0'); await page.locator('#apply-hint').click();
  await expect(page.locator('.stone')).toHaveCount(1);
  expect(await page.evaluate(()=>localStorage.getItem('linxi-match-v1'))).toEqual(old);
  await page.screenshot({path:'test-results/gomoku-desktop.png',fullPage:true});
  await page.goto('http://127.0.0.1:4173/xiangqi/'); await expect(page.locator('#move-count')).toHaveText('1 手');
  await expect(page.locator('.piece')).toHaveCount(32); await context.close();
});
test('Gomoku pair, synchronized undo, disconnect cancellation and resume', async ({ browser }) => {
  const a=await browser.newContext(),b=await browser.newContext(),host=await a.newPage(),guest=await b.newPage();
  await Promise.all([host.goto('http://127.0.0.1:4173/gomoku/'),guest.goto('http://127.0.0.1:4173/gomoku/')]);
  await pair(host,guest);
  await place(host,112); await expect(guest.locator('.stone')).toHaveCount(1);
  await place(guest,113); await expect(host.locator('.stone')).toHaveCount(2);
  await host.locator('#undo-button').click(); await host.locator('#request-undo').click();
  await expect(guest.locator('#undo-text')).toContainText('撤回 2 手');
  await expect(host.locator('#accept-undo')).toBeDisabled(); await expect(guest.locator('#place-button')).toBeDisabled();
  await guest.locator('#accept-undo').click(); await expect(host.locator('.stone')).toHaveCount(0); await expect(guest.locator('.stone')).toHaveCount(0);
  await place(host,111); await expect(guest.locator('.stone')).toHaveCount(1);
  await host.locator('#undo-button').click(); await host.locator('#request-undo').click();
  await expect(guest.locator('#undo-panel')).toBeVisible(); await guest.reload();
  await expect(host.locator('#mode-label')).toContainText('待连接'); await expect(host.locator('#undo-panel')).toBeHidden();
  await pair(host,guest,true);
  await expect(guest.locator('.stone')).toHaveCount(1); await expect(guest.locator('#undo-panel')).toBeHidden();
  expect((await saved(host)).game).toEqual((await saved(guest)).game);
  await a.close();await b.close();
});
test('Xiangqi offer cannot join Gomoku or replace its saved board', async ({ browser }) => {
  const context=await browser.newContext(),x=await context.newPage(),g=await context.newPage();
  await x.goto('http://127.0.0.1:4173/xiangqi/');await x.locator('#new-button').click();await x.locator('#start-host').click();
  await expect(x.locator('#out-code')).toHaveValue(/^LX1\./,{timeout:15000});
  await g.goto('http://127.0.0.1:4173/gomoku/');await place(g,112); const before=await saved(g);
  await g.locator('#connect-button').click();await g.locator('#offline-options').click();await g.locator('#join-room').click();
  await g.locator('#paste-details > summary').click();
  await g.locator('#in-code').fill(await x.locator('#out-code').inputValue());await g.locator('#import-signal').click();
  await expect(g.locator('#connect-status')).toContainText('另一种棋');expect(await saved(g)).toEqual(before);
  await expect(g.locator('.stone')).toHaveCount(1);await context.close();
});
test('Gomoku 30-second deadline returns a playable fallback when Worker never responds', async ({ page }) => {
  await page.addInitScript(()=>{window.Worker=class {postMessage(){} terminate(){}};});
  await page.clock.install();await page.goto('./');await enableAI(page,'30');
  await page.locator('#hint-button').click();await page.clock.fastForward(30001);
  await expect(page.locator('#apply-hint')).toBeVisible();await expect(page.locator('#ai-output')).toContainText('时间预算已到');
  await page.locator('#apply-hint').click();await expect(page.locator('.stone')).toHaveCount(1);
  await expect(page.locator('#bottom-hints')).toContainText('0 / 1');
});
