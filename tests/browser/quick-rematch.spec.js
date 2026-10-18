import { test, expect } from '@playwright/test';
import jsQR from 'jsqr';
import { decodeQuickSignal } from '../../board-games/shared/quick-code.js';
const localBroker = page => page.addInitScript(() => { window.__LINXI_SIGNAL_SERVER__ = {host:'127.0.0.1',port:4174,path:'/',secure:false,config:{iceServers:[]}}; });
const saved = (page, kind) => page.evaluate(key=>JSON.parse(localStorage.getItem(key)),kind==='xiangqi'?'linxi-match-v1':'linxi-gomoku-match-v1');
async function quickPair(host, guest, kind, reuseTab = false) {
  await Promise.all([localBroker(host),localBroker(guest)]);
  await host.goto(`/${kind}/`); await host.locator('#new-button').click();
  await host.locator('#settings-hints').selectOption('1'); await host.locator('#settings-seconds').selectOption('3');
  await host.locator('#start-quick').click();
  await expect(host.locator('#out-code')).toHaveValue(/#join=LXQ1\./,{timeout:10000});
  const invite=await host.locator('#out-code').inputValue();
  const raw=await host.locator('#qr-image').evaluate(image=>{
    const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
    const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
    return {pixels:[...ctx.getImageData(0,0,canvas.width,canvas.height).data],width:canvas.width,height:canvas.height};
  });
  const qr=jsQR(new Uint8ClampedArray(raw.pixels),raw.width,raw.height);
  expect(qr?.data).toBe(invite);expect(decodeQuickSignal(invite).gameType).toBe(kind);
  await expect(host.locator('#qr-pagination')).toBeHidden();
  let timeOrigin;
  if (reuseTab) {
    await guest.goto(`/${kind}/`); timeOrigin = await guest.evaluate(() => performance.timeOrigin);
    await guest.evaluate(url => { location.href = url; }, invite);
  } else await guest.goto(invite);
  for(const page of [host,guest]) {
    await expect(page.locator('#mode-label')).toContainText('已连接',{timeout:10000});
    await expect(page.locator('#connect-dialog')).not.toBeVisible();
  }
  await expect(guest.locator('#out-code')).toHaveValue('');
  if (reuseTab) expect(await guest.evaluate(() => performance.timeOrigin)).toBe(timeOrigin);
  expect(new URL(guest.url()).hash).toBe('');
  await guest.locator('#ready-button').click();
  await expect(host.locator('#ready-panel')).toBeHidden();
  return invite;
}
async function resign(page) { await page.locator('#resign-button').click();await page.locator('#confirm-ok').click(); }
async function firstMove(page,kind) {
  if(kind==='xiangqi') {await page.locator('[data-square="54"]').click();await page.locator('[data-square="45"]').click();}
  else {await page.locator('[data-square="112"]').click();await page.locator('#place-button').click();}
}
for(const kind of ['xiangqi','gomoku']) {
  test(`${kind}: an invitation reusing the current tab still joins without a reload`, async ({browser}) => {
    const a=await browser.newContext(),b=await browser.newContext(),host=await a.newPage(),guest=await b.newPage();
    const errors=[];for(const page of [host,guest]) page.on('pageerror',error=>errors.push(error.message));
    await quickPair(host,guest,kind,true);await firstMove(host,kind);
    await expect(guest.locator('#move-count')).toHaveText('1 手');
    await expect(host.locator('#diagnostics')).toContainText('联机版本：2026-10-18.1');
    await expect(guest.locator('#diagnostics')).toContainText('配对阶段：数据通道已建立');
    expect(errors).toEqual([]);await a.close();await b.close();
  });
  test(`${kind}: one QR auto-joins; broker disconnects; two agreed rematches reuse the connection`,async({browser})=>{
    const a=await browser.newContext(),b=await browser.newContext(),host=await a.newPage(),guest=await b.newPage();
    const sockets={opened:0,closed:0}; const errors=[];
    for(const page of [host,guest]) {page.on('pageerror',e=>errors.push(e.message));page.on('websocket',socket=>{sockets.opened++;socket.on('close',()=>sockets.closed++);});}
    await quickPair(host,guest,kind);
    await expect.poll(()=>sockets.closed).toBe(sockets.opened);expect(sockets.opened).toBe(2);
    const old=(await saved(host,kind)).game;
    await host.locator('#ai-settings-button').click();await host.locator('#ai-provider').selectOption('local');await host.locator('#save-ai-settings').click();
    await host.locator('#hint-button').click();await host.locator('#stop-hint').click();
    await firstMove(host,kind);await expect(guest.locator('#move-count')).toHaveText('1 手');
    await resign(guest);for(const page of [host,guest]) await expect(page.locator('#result-panel')).toBeVisible();
    await host.locator('#rematch-button').click();await expect(guest.locator('#rematch-panel')).toBeVisible();
    await expect(host.locator('#accept-rematch')).toBeDisabled();await guest.locator('#accept-rematch').click();
    await expect(host.locator('#result-panel')).toBeHidden();await expect(guest.locator('#result-panel')).toBeHidden();
    await expect(host.locator('#move-count')).toHaveText('0 手');await expect(guest.locator('#move-count')).toHaveText('0 手');
    await expect(host.locator('#bottom-hints')).toContainText('1 / 1');
    const next=(await saved(host,kind)).game;expect(next.id).not.toBe(old.id);expect(next.settings).toEqual(old.settings);
    expect(next).toEqual((await saved(guest,kind)).game);
    await firstMove(host,kind);await expect(guest.locator('#move-count')).toHaveText('1 手');await resign(host);
    await expect(guest.locator('#result-panel')).toBeVisible();await guest.locator('#rematch-button').click();
    await expect(host.locator('#rematch-panel')).toBeVisible();await host.locator('#accept-rematch').click();
    await expect(guest.locator('#result-panel')).toBeHidden();await expect(host.locator('#move-count')).toHaveText('0 手');
    expect((await saved(host,kind)).game).toEqual((await saved(guest,kind)).game);
    expect(sockets.opened).toBe(2);expect(errors).toEqual([]);await a.close();await b.close();
  });
  test(`${kind}: local rematch keeps rules and resets quotas without opening settings`,async({page})=>{
    await page.goto(`/${kind}/`);await page.locator('#new-button').click();await page.locator('#settings-hints').selectOption('1');
    await page.locator('#start-local').click();const old=(await saved(page,kind)).game;
    await resign(page);await page.locator('#rematch-button').click();
    await expect(page.locator('#result-panel')).toBeHidden();await expect(page.locator('#settings-dialog')).not.toBeVisible();
    expect((await saved(page,kind)).game.id).not.toBe(old.id);expect((await saved(page,kind)).game.settings).toEqual(old.settings);
    await expect(page.locator('#bottom-hints')).toContainText('1 / 1');
  });
}
test('rematch rejection, timeout and disconnect preserve result; stale quick link fails clearly',async({browser})=>{
  const a=await browser.newContext(),b=await browser.newContext(),host=await a.newPage(),guest=await b.newPage();
  const errors=[];for(const page of [host,guest]) page.on('pageerror',error=>errors.push(error.message));
  const invite=await quickPair(host,guest,'gomoku');await resign(host);
  await expect(guest.locator('#result-panel')).toBeVisible();const id=(await saved(host,'gomoku')).game.id;
  await host.locator('#rematch-button').click();await expect(guest.locator('#rematch-panel')).toBeVisible();
  await guest.locator('#reject-rematch').click();await expect(host.locator('#rematch-panel')).toBeHidden();
  expect((await saved(host,'gomoku')).game.id).toBe(id);
  await host.clock.install();await host.locator('#rematch-button').click();await host.clock.fastForward(30001);
  await expect(host.locator('#rematch-panel')).toBeHidden();await expect(guest.locator('#rematch-panel')).toBeHidden();
  await guest.locator('#rematch-button').click();await expect(host.locator('#rematch-panel')).toBeVisible();await guest.reload();
  await expect(host.locator('#mode-label')).toContainText('待连接');await expect(host.locator('#rematch-panel')).toBeHidden();
  expect((await saved(host,'gomoku')).game.id).toBe(id);
  const third=await b.newPage();await localBroker(third);await third.goto(invite);
  await expect(third.locator('#connect-status')).toContainText('邀请已失效',{timeout:10000});
  await expect(third.locator('#diagnostics')).toContainText('配对错误类型：peer-unavailable');
  await expect(third.locator('#mode-label')).toContainText('待连接');expect(errors).toEqual([]);await a.close();await b.close();
});
test('quick service failure leaves the offline pairing controls available',async({page})=>{
  await page.addInitScript(()=>{window.__LINXI_SIGNAL_SERVER__={host:'127.0.0.1',port:4199,path:'/',secure:false};});
  await page.goto('/gomoku/');await page.locator('#new-button').click();await page.locator('#start-quick').click();
  await expect(page.locator('#connect-status')).toContainText('快捷配对暂不可用',{timeout:10000});
  await expect(page.locator('#create-room')).toBeEnabled();await expect(page.locator('#join-room')).toBeEnabled();
});

test('a browser with no usable ICE candidates reports the direct connection failure', async ({browser}) => {
  const a=await browser.newContext(),b=await browser.newContext(),host=await a.newPage(),guest=await b.newPage();
  for (const page of [host,guest]) {
    await localBroker(page);
    await page.addInitScript(() => {
      const Native = window.RTCPeerConnection;
      window.RTCPeerConnection = new Proxy(Native, {construct(Target,args) {
        return Reflect.construct(Target,[{...args[0],iceServers:[],iceTransportPolicy:'relay'}]);
      }});
    });
  }
  await host.clock.install();await host.goto('/gomoku/');
  await host.locator('#new-button').click();await host.locator('#start-quick').click();
  await expect(host.locator('#out-code')).toHaveValue(/#join=LXQ1\./);
  await guest.goto(await host.locator('#out-code').inputValue());
  await expect(host.locator('#diagnostics')).toContainText('已收到对方描述：是');
  await host.clock.fastForward(20001);
  await expect(host.locator('#connect-status')).toContainText('浏览器未提供可用的连接地址');
  await expect(host.locator('#diagnostics')).toContainText('本机候选地址数量：host 0 / srflx 0 / relay 0');
  await expect(host.locator('#create-room')).toBeEnabled();
  await expect(host.locator('#mode-label')).toContainText('待连接');
  await a.close();await b.close();
});
