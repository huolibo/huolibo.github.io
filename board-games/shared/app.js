import config from '@game/config';
import qrcode from 'qrcode-generator';
import jsQR from 'jsqr';
import { names, sideName, legalMoves, inCheck, moveLabel } from '@game/rules';
import { createGame, transition, packGame, unpackGame, acceptSnapshot, undoCount, PROTOCOL, UNDO_TIMEOUT_MS } from '@game/state';
import { QuickPeerLink } from './quick-peer.js';
import { encodeQuickSignal, decodeQuickSignal, quickInviteURL } from './quick-code.js';
import { REMATCH_ACTIONS, validateRematch } from './rematch.js';
import { PeerLink, decodeSignal } from './peer.js';

const $ = id => document.getElementById(id);
const STORE = config.store;
const AI_STORE = config.aiStore;
let aiProvider = null;
try { if (JSON.parse(localStorage.getItem(AI_STORE) || 'null')?.provider === 'local') aiProvider = 'local'; } catch {}
const aiAvailable = () => aiProvider === 'local' && typeof Worker === 'function';
for (const dialog of document.querySelectorAll('dialog')) {
  const heading = dialog.querySelector('h2');
  if (heading) { heading.id ||= dialog.id + '-title'; dialog.setAttribute('aria-labelledby', heading.id); }
}
let game = createGame(), mode = 'local', role = 1, flipped = false, selected = null;
let link = null, connected = false, pending = null, pendingTimer = null, signalBusy = false;
let worker = null, analysis = null, suggestion = null, aiTimer = null, aiTicker = null;
let cameraStream = null, scanFrame = null, cameraStarting = false, cameraGeneration = 0;
let signalParts = [], signalPage = 0, scanParts = new Map(), scanGroup = null;
let connectionState = '未连接', log = [], toastTimer;
let confirmation = null, undoTicker = null, guestUndoDeadline = 0, undoPreviewRevision = null, guestRematchDeadline = 0;
const uid = () => crypto.randomUUID();
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 5000); }
function note(message) { log.push(`${new Date().toLocaleTimeString('zh-CN')} ${message}`); log = log.slice(-12); renderDiagnostics(); }
function openDialog(id) { if (!$(id).open) $(id).showModal(); }
function confirmAction(title, message) {
  $('confirm-title').textContent = title; $('confirm-message').textContent = message;
  openDialog('confirm-dialog');
  return new Promise(resolve => { confirmation = resolve; });
}
$('confirm-ok').onclick = () => { confirmation?.(true); confirmation = null; $('confirm-dialog').close(); };
$('confirm-cancel').onclick = () => $('confirm-dialog').close();
$('confirm-dialog').addEventListener('close', () => { confirmation?.(false); confirmation = null; });
for (const button of document.querySelectorAll('.close-dialog')) button.onclick = () => button.closest('dialog').close();
$('connect-dialog').addEventListener('close', stopCamera);
function persist() {
  try { localStorage.setItem(STORE, JSON.stringify({ game: packGame(game), mode, role, flipped })); }
  catch { toast('本机存储不可用，请及时导出棋谱'); }
}
try {
  const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
  if (saved) { game = unpackGame(saved.game); mode = saved.mode === 'network' ? 'network' : 'local'; role = saved.role === -1 ? -1 : 1; flipped = !!saved.flipped; }
} catch { toast('之前的本机存档无法读取，已打开新棋盘'); }
function clearPending() { pending = null; clearTimeout(pendingTimer); }
function disconnect() {
  cancelDisconnectedUndo();
  link?.close(); link = null; connected = false; clearPending(); stopCamera();
  signalParts = []; $('signal-output').hidden = true; $('signal-input').hidden = true;
}
function resetGame(settings, nextMode) {
  disconnect(); cancelAnalysis(); suggestion = null; selected = null;
  mode = nextMode; role = 1; flipped = false;
  game = createGame(settings, uid(), mode === 'network' ? 'lobby' : 'playing');
  persist(); syncUndoTimer(); render();
}
function canPlay() { return game.phase === 'playing' && !game.result && !game.undoRequest && !pending && (mode === 'local' || connected); }
function actorSide() { return mode === 'local' ? game.turn : role; }
function myTurn() { return canPlay() && (mode === 'local' || role === game.turn); }
function canHint() { return aiAvailable() && myTurn() && !analysis && game.used[actorSide()] < game.settings.hints && game.lastHint?.ply !== game.moves.length; }
function statusText() {
  if (game.result) return `${game.result.winner ? sideName(game.result.winner) + '胜' : '和棋'} · ${game.result.reason}`;
  if (mode === 'network' && !connected) return '联机尚未连接 · 当前棋局已保存，请重新配对';
  if (game.phase === 'lobby') return '等待后手方确认规则，然后先手方先行';
  if (pending) return '正在等待对方确认操作…';
  if (game.undoRequest) return '棋局暂停 · 等待对方决定是否同意悔棋';
  if (config.kind === 'gomoku') return `${sideName(game.turn)}行棋 · ${!myTurn() ? '等待对方落子' : selected === null ? '选择一个交叉点' : '已选 ' + moveLabel(game.board, { to: selected }) + '，再次点击或确认落子'}`;
  return `${sideName(game.turn)}${inCheck(game.board, game.turn) ? '被将军，请应将' : '行棋'} · ${mode === 'network' && game.turn !== role ? '等待对方落子' : selected === null ? '请选择一枚棋子' : '请选择标记的位置'}`;
}
// The red peer timestamps decisions. Guest wall clocks never decide acceptance.
function stampUndo(action, authoritative) {
  if (![...REMATCH_ACTIONS, 'requestUndo', 'acceptUndo', 'rejectUndo', 'cancelUndo'].includes(action?.type)) return action;
  const request = game.undoRequest || game.rematchOffer;
  const at = authoritative ? Math.max(Date.now(), request?.createdAt || 0) : request?.createdAt ?? Date.now();
  return { ...action, at };
}
function cancelDisconnectedUndo() {
  if (mode === 'network' && role !== 1) return;
  let changed = false;
  for (const [field, type] of [['undoRequest', 'cancelUndo'], ['rematchOffer', 'cancelRematch']]) {
    if (game[field]) { game = transition(game, stampUndo({ type, requestId: game[field].id, reason: 'disconnect' }, true), 1); changed = true; }
  }
  if (changed) { persist(); syncUndoTimer(); }
}
function expireUndoIfDue() {
  if (mode === 'network' && role !== 1) return;
  for (const [field, type] of [['undoRequest', 'cancelUndo'], ['rematchOffer', 'cancelRematch']]) {
    const request = game[field];
    if (!request || Date.now() < request.expiresAt) continue;
    commit(transition(game, { type, requestId: request.id, reason: 'timeout', at: Date.now() }, 1));
    if (mode === 'network' && connected) sendSnapshot();
    toast(type === 'cancelUndo' ? '悔棋请求已超时，棋局保持不变' : '再来一局的邀请已超时');
  }
}
function syncUndoTimer() {
  clearInterval(undoTicker); undoTicker = null;
  if (game.undoRequest || game.rematchOffer) undoTicker = setInterval(() => { expireUndoIfDue(); renderUndo(); renderRematch(); }, 250);
}
function renderRematch() {
  $('result-panel').hidden = !game.result;
  if (!game.result) return;
  $('result-title').textContent = `${game.result.winner ? sideName(game.result.winner) + '胜' : '和棋'} · ${game.result.reason}`;
  const online = mode === 'local' || connected, offer = game.rematchOffer;
  $('rematch-button').disabled = !online || !!pending || !!offer || !!game.rematchAccepted;
  $('rematch-panel').hidden = !offer;
  if (!offer) return;
  const remaining = mode === 'network' && role === -1 ? guestRematchDeadline - performance.now() : offer.expiresAt - Date.now();
  const seconds = Math.max(0, Math.ceil(remaining / 1000));
  $('rematch-text').textContent = `${sideName(offer.side)}邀请再来一局，${seconds ? '剩余 ' + seconds + ' 秒' : '等待超时取消同步'}。`;
  const canRespond = online && !pending && seconds > 0 && role === -offer.side;
  $('accept-rematch').disabled = !canRespond; $('reject-rematch').disabled = !canRespond;
  $('withdraw-rematch').hidden = role !== offer.side; $('withdraw-rematch').disabled = !online || !!pending;
}
function startRematch(request = null) {
  if (role !== 1 || !connected || !game.rematchAccepted) return;
  const previous = packGame(game), next = createGame(game.settings, uid(), 'playing');
  try {
    link.send({ type: 'rematch-start', previous, game: packGame(next), request });
    commit(next); toast('新局开始，AI 次数已重置');
  } catch (e) { connected = false; render(); toast('新局同步中断，请重连后继续'); }
}
function renderUndo() {
  const request = game.undoRequest;
  $('undo-button').disabled = !canPlay() || !!game.drawOffer || !(mode === 'local' ? game.moves.length : undoCount(game, role));
  $('undo-panel').hidden = !request;
  if (!request) return;
  const online = mode === 'local' || connected;
  const remaining = mode === 'network' && role === -1 ? guestUndoDeadline - performance.now() : request.expiresAt - Date.now();
  const seconds = Math.max(0, Math.ceil(remaining / 1000));
  $('undo-text').textContent = online
    ? `${sideName(request.side)}申请撤回 ${request.count} 手：${game.moves.slice(request.targetPly).map(m => m.label).join('、')}。请${sideName(-request.side)}确认；${seconds ? '剩余 ' + seconds + ' 秒' : '等待超时取消同步'}。AI 次数不退还。`
    : '连接已断开，悔棋请求不可继续。重新配对后同步取消状态，棋盘暂时保留。';
  const canRespond = online && !pending && seconds > 0 && (mode === 'local' || role === -request.side);
  $('accept-undo').disabled = !canRespond; $('reject-undo').disabled = !canRespond;
  $('withdraw-undo').hidden = mode === 'network' && role !== request.side;
  $('withdraw-undo').disabled = !online || !!pending;
}
function previewUndo() {
  undoPreviewRevision = game.revision;
  const actor = mode === 'local' ? Number($('undo-side').value) : role;
  const count = undoCount(game, actor);
  $('undo-preview').textContent = count
    ? `将撤回 ${count} 手：${game.moves.slice(-count).map(m => m.label).join('、')}。回到${sideName(actor)}落子前；对方须在 30 秒内同意，AI 次数不退还。`
    : '这一方还没有可撤回的棋步。';
  $('request-undo').disabled = !canPlay() || !!game.drawOffer || !count;
}
function gridSVG() {
  let content = '<rect x="30" y="30" width="480" height="540" fill="none" stroke="currentColor" stroke-width="2"/>';
  for (let row = 1; row < 9; row++) content += `<line x1="30" y1="${30 + row * 60}" x2="510" y2="${30 + row * 60}"/>`;
  for (let col = 1; col < 8; col++) content += `<path d="M${30 + col * 60} 30V270 M${30 + col * 60} 330V570"/>`;
  content += '<path d="M210 30L330 150M330 30L210 150M210 450L330 570M330 450L210 570"/><text x="120" y="309" text-anchor="middle">楚河</text><text x="420" y="309" text-anchor="middle">汉界</text>';
  for (const [x, y] of [[1, 2], [7, 2], [1, 7], [7, 7], ...[0, 2, 4, 6, 8].flatMap(x => [[x, 3], [x, 6]])]) {
    const px = 30 + x * 60, py = 30 + y * 60;
    for (const dx of [-1, 1]) for (const dy of [-1, 1]) if (x + dx >= 0 && x + dx < 9) content += `<path d="M${px + dx * 5} ${py + dy * 14}V${py + dy * 5}H${px + dx * 14}"/>`;
  }
  return `<svg class="board-grid" viewBox="0 0 540 600" aria-hidden="true">${content}</svg>`;
}
function renderBoard() {
  if (config.kind === 'gomoku') { renderGomoku(); return; }
  const board = $('board'); board.innerHTML = gridSVG();
  const last = game.moves.at(-1), legal = selected === null ? [] : legalMoves(game.board, game.turn, selected).map(m => m.to);
  for (let i = 0; i < 90; i++) {
    const cell = document.createElement('button'), piece = game.board[i], display = flipped ? 89 - i : i;
    cell.className = 'square'; cell.dataset.square = i;
    cell.style.left = `${((display % 9) + .5) / 9 * 100}%`; cell.style.top = `${(Math.floor(display / 9) + .5) / 10 * 100}%`;
    cell.setAttribute('aria-label', `${'abcdefghi'[i % 9]}${10 - Math.floor(i / 9)} ${piece ? sideName(Math.sign(piece)) + names[piece] : '空位'}${legal.includes(i) ? '，可以落子' : ''}`);
    cell.setAttribute('aria-pressed', String(selected === i));
    if (selected === i) cell.classList.add('selected');
    if (last && (last.from === i || last.to === i)) cell.classList.add('last');
    if (suggestion?.ply === game.moves.length && (suggestion.move.from === i || suggestion.move.to === i)) cell.classList.add('suggested');
    if (legal.includes(i)) cell.classList.add('legal');
    if (piece) { const span = document.createElement('span'); span.className = `piece ${piece > 0 ? 'red' : 'black'}`; span.textContent = names[piece]; cell.append(span); }
    cell.onclick = () => clickSquare(i);
    board.append(cell);
  }
}
function clickSquare(i) {
  if (!myTurn()) { toast(statusText()); return; }
  if (config.kind === 'gomoku') {
    if (game.board[i]) { toast('这个交叉点已有棋子'); return; }
    if (selected === i) { act({ type: 'move', from: -1, to: i }); return; }
    selected = i; renderBoard(); $('game-status').textContent = statusText(); return;
  }
  if (selected !== null && legalMoves(game.board, game.turn, selected).some(m => m.to === i)) {
    act({ type: 'move', from: selected, to: i }); return;
  }
  if (Math.sign(game.board[i]) === game.turn) selected = selected === i ? null : i;
  else { selected = null; }
  renderBoard(); $('game-status').textContent = statusText();
  document.querySelector(`[data-square="${i}"]`)?.focus({ preventScroll: true });
}
function renderGomoku() {
  const board = $('board');
  let lines = '';
  for (let i = 0; i < 15; i++) {
    const p = 20 + i * 40;
    lines += `<path d="M20 ${p}H580 M${p} 20V580"/>`;
  }
  for (const [x, y] of [[3,3],[11,3],[7,7],[3,11],[11,11]]) lines += `<circle cx="${20+x*40}" cy="${20+y*40}" r="4" fill="currentColor"/>`;
  board.innerHTML = `<svg class="board-grid" viewBox="0 0 600 600" aria-hidden="true">${lines}</svg>`;
  for (let i = 0; i < 225; i++) {
    const cell = document.createElement('button'), piece = game.board[i], display = flipped ? 224-i : i;
    cell.className = 'square'; cell.dataset.square = i;
    cell.style.left = `${(display%15+.5)/15*100}%`; cell.style.top = `${(Math.floor(display/15)+.5)/15*100}%`;
    cell.setAttribute('aria-label', `${moveLabel(game.board, {to:i})} ${piece ? sideName(piece) : '空位'}`);
    cell.setAttribute('aria-pressed', String(selected === i));
    if (piece) { const stone = document.createElement('span'); stone.className = `stone ${piece === 1 ? 'dark' : 'light'}`; cell.append(stone); }
    if (selected === i) cell.classList.add('selected');
    if (game.moves.at(-1)?.to === i) cell.classList.add('last');
    if (game.winning?.includes(i)) cell.classList.add('winning');
    if (suggestion?.ply === game.moves.length && suggestion.move.to === i) cell.classList.add('suggested');
    cell.onclick = () => clickSquare(i); board.append(cell);
  }
  $('place-button').hidden = !!game.result;
  $('place-button').disabled = !myTurn() || selected === null || !!game.board[selected];
}
function renderPlayers() {
  for (const [place, side] of [['top', flipped ? 1 : -1], ['bottom', flipped ? -1 : 1]]) {
    $(place + '-name').textContent = sideName(side) + (mode === 'network' ? side === role ? ' · 你' : ' · 对方' : '');
    $(place + '-info').textContent = game.result ? '本局已结束' : side === game.turn ? inCheck(game.board, side) ? '将军 · 请应将' : '轮到这一方落子' : '静候下一步';
    $(place + '-hints').textContent = `AI 剩余 ${game.settings.hints - game.used[side]} / ${game.settings.hints}`;
    $(place + '-turn').hidden = side !== game.turn || !!game.result || game.phase !== 'playing';
    const avatar = $(place + '-name').closest('.player-bar').querySelector('.player-avatar');
    avatar.textContent = names[side]; avatar.className = `player-avatar ${side === 1 ? 'red-avatar' : 'black-avatar'}`;
  }
}
function renderMoves() {
  $('move-count').textContent = `${game.moves.length} 手`;
  const list = $('move-list');
  if (!game.moves.length) { list.innerHTML = '<div class="empty-record"><span>弈</span><p>棋局未启，万象待生。</p></div>'; return; }
  list.replaceChildren();
  game.moves.forEach((move, i) => {
    const row = document.createElement('div'); row.className = 'move-row';
    for (const [className, text] of [['move-number', String(i + 1).padStart(2, '0')], ['move-side' + (move.side < 0 ? ' black' : ''), sideName(move.side)], ['move-text', move.label]]) {
      const span = document.createElement('span'); span.className = className; span.textContent = text; row.append(span);
    }
    list.append(row);
  });
  list.scrollTop = list.scrollHeight;
}
function renderAI() {
  $('ai-remaining').innerHTML = `${game.settings.hints - game.used[actorSide()]} <small>次</small>`;
  $('ai-seconds').innerHTML = `${game.settings.seconds} <small>秒</small>`;
  $('hint-button').disabled = aiAvailable() ? !canHint() : false;
  $('ai-provider-label').textContent = aiProvider === 'local' ? '本地 AI' : '未配置';
  $('hint-button').textContent = analysis ? '参谋正在思考…' : '✧ 分析当前局面';
  $('apply-hint').hidden = !suggestion || !!analysis || suggestion.ply !== game.moves.length;
  $('apply-hint').disabled = !myTurn(); $('stop-hint').hidden = !analysis;
  const output = $('ai-output');
  if (!aiAvailable()) {
    output.innerHTML = '<span class="quiet-icon">◌</span><p>AI 暂不可用<br><small></small></p>';
    output.querySelector('small').textContent = aiProvider ? '此浏览器暂不支持所选引擎' : '尚未配置 AI，可在“AI 设置”中选择引擎';
  } else if (analysis) {
    const seconds = Math.min(game.settings.seconds, (performance.now() - analysis.started) / 1000);
    output.innerHTML = '<strong>正在推演棋局</strong><progress></progress><small></small>';
    output.querySelector('progress').max = game.settings.seconds; output.querySelector('progress').value = seconds;
    output.querySelector('small').textContent = `${seconds.toFixed(1)} / ${game.settings.seconds} 秒 · 已完成 ${analysis.best.depth || 0} 层搜索`;
  } else if (suggestion?.ply === game.moves.length) {
    output.replaceChildren(); const title = document.createElement('strong'); title.textContent = moveLabel(game.board, suggestion.move);
    const detail = document.createElement('p'); detail.textContent = suggestion.depth ? `已搜索 ${suggestion.depth} 层 · ${suggestion.nodes.toLocaleString()} 个节点` : '快速合法候选 · 尚未完成一层搜索';
    const small = document.createElement('small'); small.textContent = suggestion.reason || '蓝色标记为建议走法，由你决定是否采用'; output.append(title, detail, small);
  } else {
    output.innerHTML = '<span class="quiet-icon">◌</span><p>好棋值得思量<br><small></small></p>';
    output.querySelector('small').textContent = game.lastHint?.ply === game.moves.length ? '本回合已使用 AI；刷新后不会恢复分析结果' : '轮到你时，可以请求一步建议';
  }
}
function render() {
  $('mode-label').textContent = mode === 'local' ? '同机对弈' : connected ? '附近联机 · 已连接' : '附近联机 · 待连接';
  $('seat-label').textContent = mode === 'local' ? '两人轮流操作' : `你执${sideName(role).slice(0, 1)}`;
  $('game-status').textContent = statusText();
  renderBoard(); renderPlayers(); renderMoves(); renderAI(); renderUndo(); renderRematch();
  $('ready-panel').hidden = game.phase !== 'lobby' || !connected;
  $('ready-text').textContent = `每人 AI ${game.settings.hints} 次，每次最多 ${game.settings.seconds} 秒；${config.rules}。${role === 1 ? '等待后手方确认。' : '确认后先手方先行。'}`;
  $('ready-button').hidden = role === 1; $('ready-button').disabled = !!pending;
  $('draw-panel').hidden = !game.drawOffer || !!game.result;
  $('draw-text').textContent = `${sideName(game.drawOffer)}提议和棋，等待另一方决定。`;
  const canRespond = canPlay() && (mode === 'local' || role === -game.drawOffer);
  $('accept-draw').disabled = !canRespond; $('reject-draw').disabled = !canRespond;
  $('resign-button').disabled = !canPlay(); $('draw-button').disabled = !canPlay() || !!game.drawOffer;
  $('connection-title').textContent = mode === 'local' ? '好友就在身边' : connected ? '两端棋局同步中' : '棋局已保留，等待连接';
  $('connection-description').textContent = mode === 'local' ? '同一 Wi-Fi 或手机热点，互扫连接码即可尝试联机。' : connected ? '棋步直接传给对方；AI 在本机分析。保持页面在前台。' : '重新交换连接码可以恢复原局。请勿新开一局覆盖存档。';
}
function commit(next) {
  const justEnded = !!next.result && !game.result;
  if (next.moves.length !== game.moves.length || next.result || next.undoRequest) { cancelAnalysis(); suggestion = null; selected = null; }
  game = next; persist(); syncUndoTimer(); render();
  if (justEnded && !document.querySelector('dialog[open]')) $('result-panel').scrollIntoView({ block: 'nearest' });
}
function act(action, actor = actorSide()) {
  try {
    if (action.type === 'hint' && !aiAvailable()) { toast('AI 暂不可用'); return; }
    if (mode === 'network' && (!connected || !link?.isOpen)) throw Error('双方尚未连接，不能操作棋局');
    if (pending) throw Error('请等待上一条操作确认');
    expireUndoIfDue();
    action = stampUndo(action, mode === 'local' || role === 1);
    // Both peers validate locally before requesting or applying a transition.
    const next = transition(game, action, actor);
    if (mode === 'network' && role === -1) {
      pending = { id: uid(), action, base: game.revision };
      link.send({ type: 'action', id: game.id, request: pending.id, base: pending.base, action });
      pendingTimer = setTimeout(() => { if (pending) { toast('操作确认超时，已暂停。请重连以核对是否已生效'); connected = false; link?.close(); clearPending(); render(); } }, 10000);
      render(); return;
    }
    commit(next);
    if (mode === 'network' && action.type === 'acceptRematch') startRematch();
    else if (mode === 'network') sendSnapshot();
    if (action.type === 'hint') startAnalysis();
  } catch (e) { toast(e.message); }
}
function sendSnapshot(request = null) {
  try { link.send({ type: 'snapshot', request, game: packGame(game), hostTime: Date.now() }); }
  catch (e) { connected = false; cancelDisconnectedUndo(); render(); toast('棋局已保存，但同步中断，请重新配对'); note(e.message); }
}
function receive(message) {
  try {
    if (!message || typeof message.type !== 'string') throw Error('消息格式无效');
    if (role === 1 && message.type === 'action') {
      expireUndoIfDue();
      if (message.id !== game.id || message.base !== game.revision || typeof message.request !== 'string') { link.send({ type: 'error', message: '棋局版本不同，已重新同步', request: message.request }); sendSnapshot(); return; }
      try { commit(transition(game, stampUndo(message.action, true), -1)); if (message.action.type === 'acceptRematch') startRematch(message.request); else sendSnapshot(message.request); }
      catch (e) { link.send({ type: 'error', message: e.message, request: message.request }); }
    } else if (role === -1 && message.type === 'rematch-start') {
      const next = validateRematch(game, message.previous, message.game, acceptSnapshot, unpackGame);
      clearPending(); commit(next); toast('新局开始，AI 次数已重置');
    } else if (role === -1 && message.type === 'snapshot') {
      const next = acceptSnapshot(game, message.game);
      const wasHint = pending?.id === message.request && pending.action.type === 'hint';
      if (pending?.id === message.request) clearPending();
      if (next.undoRequest && next.undoRequest.id !== game.undoRequest?.id) {
        const remaining = next.undoRequest.expiresAt - (Number.isSafeInteger(message.hostTime) ? message.hostTime : next.undoRequest.createdAt);
        guestUndoDeadline = performance.now() + Math.max(0, Math.min(UNDO_TIMEOUT_MS, remaining));
      }
      if (next.rematchOffer && next.rematchOffer.id !== game.rematchOffer?.id) {
        const remaining = next.rematchOffer.expiresAt - (Number.isSafeInteger(message.hostTime) ? message.hostTime : next.rematchOffer.createdAt);
        guestRematchDeadline = performance.now() + Math.max(0, Math.min(30000, remaining));
      }
      connected = true; commit(next);
      $('connect-status').textContent = game.phase === 'lobby' ? '连接成功！请关闭此面板，确认双方规则后开始。' : '棋谱核验通过，可以继续对局。';
      if (wasHint) startAnalysis();
    } else if (role === -1 && message.type === 'error') {
      if (pending?.id === message.request) clearPending();
      render(); toast(String(message.message).slice(0, 140));
    } else throw Error('收到不适用于当前角色的消息');
  } catch (e) {
    connected = false; link?.close(); clearPending(); cancelDisconnectedUndo(); render(); note(e.message); toast(`同步已暂停：${e.message}`);
  }
}
function newLink(method = 'manual') {
  signalParts = []; $('out-code').value = ''; $('signal-output').hidden = true;
  cancelDisconnectedUndo();
  link?.close(); connected = false; clearPending();
  const LinkClass = method === 'quick' ? QuickPeerLink : PeerLink;
  const nextLink = new LinkClass({
    onMessage: receive,
    onError: message => { $('connect-status').textContent = message; toast(message); },
    onStatus: status => {
      connectionState = status; note(`连接状态：${status}`);
      if (['disconnected', 'failed', 'closed', 'timeout', 'invalid'].includes(status)) {
        connected = false; clearPending(); cancelDisconnectedUndo(); finishAnalysis('连接中断，保留已有建议');
        $('connect-status').textContent = '连接尚未建立或已中断。棋谱已保留；请检查 Wi-Fi，重新交换连接码。'; render();
      }
    },
    onOpen: () => {
      connected = true;
      if (role === 1) { if (game.rematchAccepted) startRematch(); else sendSnapshot(); }
      $('connect-status').textContent = '连接成功！可以关闭此面板，确认规则后开始。';
      stopCamera();
      if (method === 'quick') $('connect-dialog').close();
      render(); toast('对方已连接');
    }
  });
  link = nextLink; return nextLink;
}
async function createOffer() {
  if (signalBusy) return;
  signalBusy = true; $('create-room').disabled = true; $('join-room').disabled = true;
  try {
    cancelAnalysis(); suggestion = null; role = 1; mode = 'network'; persist();
    const current = newLink(); render(); $('connect-status').textContent = '正在准备先手方连接码…';
    const code = await current.offer({ id: game.id, settings: game.settings, protocol: PROTOCOL, gameType: config.kind, phase: game.initialPhase });
    if (link !== current) return;
    showSignal(code); $('signal-input').hidden = false; $('in-code').value = ''; $('input-label').textContent = '第二步：读取后手方生成的回应码';
    $('connect-status').textContent = '第一步：请后手方扫描此码。对方生成回应码后，再用下方相机扫描回应码。';
    note(`先手方连接码已生成，${code.length} 字符`);
  } catch (e) { $('connect-status').textContent = e.message; toast(e.message); }
  finally { signalBusy = false; $('create-room').disabled = false; $('join-room').disabled = false; }
}
async function createQuickInvite() {
  if (signalBusy) return;
  signalBusy = true; $('quick-create').disabled = true; $('quick-join').disabled = true;
  let current;
  try {
    cancelAnalysis(); suggestion = null; role = 1; mode = 'network'; persist();
    current = newLink('quick'); render(); $('connect-status').textContent = '正在连接快捷配对服务，请保持联网…';
    const data = await current.host({ v: 1, id: game.id, settings: game.settings, protocol: PROTOCOL, gameType: config.kind,
      phase: game.initialPhase, secret: uid() });
    if (link !== current) return;
    showSignal(quickInviteURL(encodeQuickSignal(data), location.href)); $('signal-input').hidden = true;
    $('connect-status').textContent = '请对方扫描这一张二维码或打开复制的邀请链接。无需回传回应码；连接后会自动进入棋盘。';
  } catch (e) {
    if (current && link === current) { current.close(); connected = false; render(); }
    $('connect-status').textContent = e.message; toast(e.message);
  } finally { signalBusy = false; $('quick-create').disabled = false; $('quick-join').disabled = false; }
}
async function joinQuickInvite(data) {
  if (data.gameType !== config.kind) throw Error('连接码属于另一种棋，请打开相同的游戏');
  if (data.protocol !== PROTOCOL) throw Error('双方程序版本不同，请更新到同一版本后重新配对');
  if ((game.id !== data.id && game.moves.length || connected) && !await confirmAction('加入快捷对局？', '这会替换当前连接或棋局。需要保留时，请先取消并导出棋谱。')) return;
  cancelAnalysis(); suggestion = null;
  if (game.id !== data.id) game = createGame(data.settings, data.id, data.phase);
  else if (JSON.stringify(game.settings) !== JSON.stringify(data.settings) || game.initialPhase !== data.phase) throw Error('重连规则与原局不同');
  mode = 'network'; role = -1; flipped = true; selected = null;
  const current = newLink('quick'); persist(); render();
  $('signal-input').hidden = true; $('connect-status').textContent = '正在自动交换连接信息，无需回传二维码…';
  await current.join(data);
}
async function readSignal() {
  if (signalBusy) return;
  signalBusy = true; $('import-signal').disabled = true;
  try {
    const quick = decodeQuickSignal($('in-code').value);
    if (quick) { await joinQuickInvite(quick); return; }
    const data = await decodeSignal($('in-code').value);
    if ((data.gameType || 'xiangqi') !== config.kind) throw Error('连接码属于另一种棋，请打开相同的游戏');
    if (data.protocol !== PROTOCOL) throw Error('双方程序版本不同，请更新到同一版本后重新配对');
    if (data.description.type === 'answer') {
      if (role !== 1 || !link) throw Error('请先创建先手方连接码，再读取回应码');
      await link.accept(data, game.id); $('connect-status').textContent = '回应码已读取，正在尝试局域网直连…';
    } else {
      if (mode === 'network' && role === 1 && link) throw Error('创建方需要读取回应码。若要改为加入方，请先点击“加入对局”。');
      if (game.id !== data.id && game.moves.length && !await confirmAction('加入新的对局？', '这会替换本机当前棋局。需要保留时，请先取消并导出棋谱。')) return;
      cancelAnalysis(); suggestion = null;
      if (game.id !== data.id) game = createGame(data.settings, data.id, data.phase || 'lobby');
      else if (JSON.stringify(game.settings) !== JSON.stringify(data.settings)) throw Error('重连规则与原局不同');
      mode = 'network'; role = -1; flipped = true; selected = null;
      const current = newLink(); persist(); render();
      const code = await current.answer(data);
      if (link !== current) return;
      showSignal(code); $('signal-input').hidden = true;
      $('connect-status').textContent = '第二步：请先手方扫描此回应码。双方连接后，再确认规则开始。';
      note(`后手方回应码已生成，${code.length} 字符`);
    }
  } catch (e) { $('connect-status').textContent = `未能读取：${e.message}`; toast(e.message); }
  finally { signalBusy = false; $('import-signal').disabled = false; renderDiagnostics(); }
}
function showSignal(code) {
  $('out-code').value = code; $('signal-output').hidden = false;
  const count = Math.ceil(code.length / 900), group = uid().slice(0, 8);
  signalParts = count === 1 ? [code] : Array.from({ length: count }, (_, i) => `LXP1.${group}.${i + 1}.${count}.${code.slice(i * 900, (i + 1) * 900)}`);
  signalPage = 0; renderQR();
}
function renderQR() {
  const qr = qrcode(0, 'M'); qr.addData(signalParts[signalPage]); qr.make();
  $('qr-image').src = qr.createDataURL(5, 20);
  $('qr-pagination').hidden = signalParts.length === 1; $('qr-page').textContent = `第 ${signalPage + 1} / ${signalParts.length} 张 · 请全部扫描`;
  $('qr-prev').disabled = signalPage === 0; $('qr-next').disabled = signalPage === signalParts.length - 1;
}
function ingestQR(text) {
  if (text.startsWith('LX1.') || text.startsWith('LXQ1.') || /^https?:\/\/[^\s]+#join=/.test(text)) return text;
  const match = /^LXP1\.([\w-]{8})\.(\d+)\.(\d+)\.(.+)$/.exec(text);
  if (!match) return null;
  const [, group, page, total, chunk] = match, n = Number(page), count = Number(total);
  if (count < 1 || count > 50 || n < 1 || n > count || chunk.length > 1000) return null;
  const key = group + '.' + total;
  if (scanGroup !== key) { scanGroup = key; scanParts.clear(); }
  scanParts.set(n, chunk); $('scan-status').textContent = `已读取 ${scanParts.size} / ${count} 张，请对方翻到下一张`;
  if (scanParts.size === count) return Array.from({ length: count }, (_, i) => scanParts.get(i + 1)).join('');
  return null;
}
async function startCamera() {
  if (cameraStarting || cameraStream) return;
  const generation = ++cameraGeneration; cameraStarting = true;
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw Error('相机需要 HTTPS 或 localhost；也可以复制连接码');
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false });
    if (generation !== cameraGeneration || !$('connect-dialog').open) { stream.getTracks().forEach(t => t.stop()); return; }
    cameraStream = stream; $('camera-panel').hidden = false; $('camera').srcObject = stream; await $('camera').play();
    scanParts.clear(); scanGroup = null; $('scan-status').textContent = '请对准对方页面中的二维码';
    const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d', { willReadFrequently: true });
    let lastTime = 0;
    function frame(time) {
      if (!cameraStream) return;
      const video = $('camera');
      if (video.readyState >= 2 && time - lastTime > 180) {
        lastTime = time; canvas.width = Math.min(960, video.videoWidth); canvas.height = Math.round(canvas.width * video.videoHeight / video.videoWidth);
        if (canvas.width && canvas.height) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height), qr = jsQR(pixels.data, pixels.width, pixels.height, { inversionAttempts: 'dontInvert' });
          const code = qr ? ingestQR(qr.data) : null;
          if (code) { $('in-code').value = code; stopCamera(); readSignal(); return; }
        }
      }
      scanFrame = requestAnimationFrame(frame);
    }
    scanFrame = requestAnimationFrame(frame);
  } catch (e) { stopCamera(); toast(`无法打开相机：${e.message}。可改用复制连接码。`); }
  finally { cameraStarting = false; }
}
function stopCamera() { cameraGeneration++; cameraStream?.getTracks().forEach(t => t.stop()); cameraStream = null; cancelAnimationFrame(scanFrame); $('camera').srcObject = null; $('camera-panel').hidden = true; }
function renderDiagnostics() {
  $('diagnostics').textContent = `安全环境：${isSecureContext ? '是' : '否'}\nWebRTC：${globalThis.RTCPeerConnection ? '可用' : '不可用'}\n相机 API：${navigator.mediaDevices?.getUserMedia ? '可用' : '不可用'}\n连接码压缩：${globalThis.CompressionStream ? '可用' : '不可用'}\n通道状态：${link?.channel?.readyState || '未创建'}\nICE 状态：${link?.pc?.iceConnectionState || '未创建'}\n连接状态：${connectionState}\n模式：${link?.transport === 'quick' ? '联网快捷配对，棋步直连' : '离线互扫，棋步直连'}\n\n${log.join('\n')}`;
}
function cancelAnalysis() { worker?.terminate(); worker = null; clearTimeout(aiTimer); clearInterval(aiTicker); analysis = null; }
function finishAnalysis(reason) {
  if (!analysis) return;
  const old = analysis;
  if (old.ply === game.moves.length && old.side === game.turn && !game.result) suggestion = { ...old.best, ply: old.ply, reason };
  cancelAnalysis(); renderAI(); renderBoard();
}
function startAnalysis() {
  cancelAnalysis(); suggestion = null;
  const fallback = legalMoves(game.board, game.turn)[0];
  if (!fallback) return;
  const ticket = `${game.id}/${game.lastHint.revision}`;
  analysis = { ticket, ply: game.moves.length, side: game.turn, started: performance.now(), best: { move: fallback, depth: 0, nodes: 0, score: null } };
  // The watchdog returns the latest validated candidate even if a worker fails.
  aiTimer = setTimeout(() => finishAnalysis('时间预算已到，返回当前建议'), game.settings.seconds * 1000);
  aiTicker = setInterval(renderAI, 500);
  try {
    worker = new Worker(new URL('./ai-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      if (!analysis || data.ticket !== analysis.ticket) return;
      if (data.result?.move && legalMoves(game.board, game.turn, data.result.move.from).some(m => m.to === data.result.move.to)) analysis.best = data.result;
      if (data.type === 'done') finishAnalysis('限时搜索完成；蓝色标记为建议走法');
      else if (data.type === 'error') finishAnalysis('搜索中断，返回已准备好的合法候选');
      else renderAI();
    };
    worker.onerror = () => finishAnalysis('引擎不可用，返回已准备好的合法候选');
    worker.postMessage({ ticket, board: game.board, side: game.turn, milliseconds: Math.max(200, game.settings.seconds * 1000 - 600) });
  } catch { finishAnalysis('浏览器无法启动引擎，返回合法候选'); }
  renderAI();
}
document.addEventListener('visibilitychange', () => { if (document.hidden) { finishAnalysis('页面进入后台，已结束搜索并保留建议'); stopCamera(); persist(); } else { expireUndoIfDue(); renderUndo(); renderRematch(); } });
if ($('place-button')) $('place-button').onclick = () => { if (selected !== null) act({ type: 'move', from: -1, to: selected }); };
$('hint-button').onclick = () => act({ type: 'hint' });
$('ai-settings-button').onclick = () => {
  $('ai-provider').value = aiProvider || 'none'; openDialog('ai-settings-dialog');
};
$('save-ai-settings').onclick = () => {
  if (analysis || pending) { toast('请先结束分析或等待当前操作确认，再修改 AI 设置'); return; }
  const provider = $('ai-provider').value === 'local' ? 'local' : null;
  if (provider && typeof Worker !== 'function') { toast('此浏览器暂不支持本地 AI'); return; }
  try { localStorage.setItem(AI_STORE, JSON.stringify({ provider })); }
  catch { toast('无法保存 AI 配置，请检查浏览器存储权限'); return; }
  aiProvider = provider; suggestion = null; renderAI(); renderBoard(); $('ai-settings-dialog').close();
  toast(provider ? '已启用本机的本地 AI 引擎' : 'AI 已设为未配置');
};
$('stop-hint').onclick = () => finishAnalysis('已提前结束，返回当前建议');
$('apply-hint').onclick = () => { if (suggestion?.ply === game.moves.length) act({ type: 'move', ...suggestion.move }); };
$('flip-button').onclick = () => { flipped = !flipped; persist(); render(); };
$('ready-button').onclick = () => act({ type: 'ready' });
$('draw-button').onclick = () => act({ type: 'offerDraw' });
$('accept-draw').onclick = () => act({ type: 'acceptDraw' }, mode === 'local' ? -game.drawOffer : role);
$('reject-draw').onclick = () => act({ type: 'rejectDraw' }, mode === 'local' ? -game.drawOffer : role);
$('undo-button').onclick = () => {
  $('undo-side-field').hidden = mode !== 'local';
  $('undo-side').value = mode === 'local' ? game.moves.at(-1)?.side || 1 : role;
  previewUndo(); openDialog('undo-dialog');
};
$('undo-side').onchange = previewUndo;
$('request-undo').onclick = () => {
  if (game.revision !== undoPreviewRevision) { previewUndo(); toast('棋局已变化，请核对更新后的撤回范围再发送'); return; }
  const actor = mode === 'local' ? Number($('undo-side').value) : role;
  $('undo-dialog').close(); act({ type: 'requestUndo' }, actor);
};
for (const [id, type] of [['accept-undo', 'acceptUndo'], ['reject-undo', 'rejectUndo'], ['withdraw-undo', 'cancelUndo']]) {
  $(id).onclick = () => {
    const request = game.undoRequest; if (!request) return;
    const actor = mode === 'local' ? (type === 'cancelUndo' ? request.side : -request.side) : role;
    act({ type, requestId: request.id, ...(type === 'cancelUndo' ? { reason: 'withdraw' } : {}) }, actor);
  };
}
$('rematch-button').onclick = () => {
  if (!game.result) return;
  if (mode === 'local') { resetGame(game.settings, 'local'); toast('新局开始，AI 次数已重置'); }
  else act({ type: 'offerRematch' }, role);
};
for (const [id, type] of [['accept-rematch', 'acceptRematch'], ['reject-rematch', 'rejectRematch'], ['withdraw-rematch', 'cancelRematch']]) {
  $(id).onclick = () => {
    if (!game.rematchOffer) return;
    act({ type, requestId: game.rematchOffer.id, ...(type === 'cancelRematch' ? { reason: 'withdraw' } : {}) }, role);
  };
}
$('resign-button').onclick = async () => { const actor = actorSide(); if (await confirmAction(`${sideName(actor)}认输？`, '认输后将结束本局，可以导出棋谱留作复盘。')) act({ type: 'resign' }, actor); };
$('new-button').onclick = () => { $('settings-hints').value = game.settings.hints; $('settings-seconds').value = game.settings.seconds; openDialog('settings-dialog'); };
const settings = () => ({ hints: Number($('settings-hints').value), seconds: Number($('settings-seconds').value) });
$('start-local').onclick = () => { resetGame(settings(), 'local'); $('settings-dialog').close(); };
$('start-quick').onclick = () => { resetGame(settings(), 'network'); $('settings-dialog').close(); openDialog('connect-dialog'); createQuickInvite(); };
$('start-host').onclick = () => { resetGame(settings(), 'network'); $('settings-dialog').close(); openDialog('connect-dialog'); createOffer(); };
$('connect-button').onclick = () => { renderDiagnostics(); openDialog('connect-dialog'); };
$('connection-detail').onclick = () => openDialog('help-dialog'); $('help-button').onclick = () => openDialog('help-dialog');
$('quick-create').onclick = async () => {
  if (mode === 'network' && role === 1) {
    if (connected && !await confirmAction('重新配对？', '现有连接将断开，棋局保留。创建新邀请后让对方扫描一次即可重连。')) return;
    await createQuickInvite();
  } else { $('connect-dialog').close(); openDialog('settings-dialog'); }
};
$('quick-join').onclick = async () => {
  if (connected && !await confirmAction('加入其他对局？', '这会断开当前连接，棋局仍保存在本机。')) return;
  disconnect(); cancelAnalysis(); $('signal-input').hidden = false; $('in-code').value = '';
  $('input-label').textContent = '扫描或粘贴对方的快捷邀请';
  $('connect-status').textContent = '点“打开相机扫码”扫描对方的一张二维码，或粘贴邀请链接后读取。无需生成回应码。'; render();
};
$('create-room').onclick = async () => {
  if (mode === 'network' && role === 1) {
    if (connected && !await confirmAction('重新配对？', '现有连接将断开，棋局保留，需要重新交换连接码。')) return;
    await createOffer();
  } else { $('connect-dialog').close(); openDialog('settings-dialog'); }
};
$('join-room').onclick = async () => {
  if (connected && !await confirmAction('重新连接？', '这会断开当前连接，棋局仍保存在本机。')) return;
  disconnect(); cancelAnalysis(); $('signal-input').hidden = false; $('in-code').value = '';
  $('input-label').textContent = '第一步：读取先手方生成的连接码';
  $('connect-status').textContent = '请扫描或粘贴先手方的连接码。读取成功后会生成回应码。'; render();
};
$('import-signal').onclick = readSignal; $('scan-code').onclick = startCamera; $('stop-camera').onclick = stopCamera;
$('qr-prev').onclick = () => { if (signalPage > 0) { signalPage--; renderQR(); } };
$('qr-next').onclick = () => { if (signalPage < signalParts.length - 1) { signalPage++; renderQR(); } };
$('copy-code').onclick = async () => { try { await navigator.clipboard.writeText($('out-code').value); toast('连接码已复制'); } catch { $('out-code').select(); toast('请长按输入框，手动复制完整连接码'); } };
$('export-button').onclick = () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(packGame(game), null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = `${config.title}-${new Date().toISOString().slice(0, 10)}-${game.moves.length}手.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
};
$('import-game').onchange = async event => {
  const file = event.target.files[0]; if (!file) return;
  try {
    if (file.size > 220000) throw Error('棋谱文件过大');
    let imported = unpackGame(JSON.parse(await file.text()));
    if (imported.phase === 'lobby') imported = transition(imported, { type: 'ready' }, -1);
    disconnect(); cancelAnalysis(); suggestion = null; selected = null; game = imported; mode = 'local'; role = 1; flipped = false;
    cancelDisconnectedUndo(); persist(); render(); $('settings-dialog').close(); toast('棋谱已校验并恢复为同机对弈');
  } catch (e) { toast(`恢复失败：${e.message}`); }
  event.target.value = '';
};
async function offlineSetup() {
  if (!('serviceWorker' in navigator) || !isSecureContext) { $('offline').textContent = '离线缓存需要 HTTPS'; return; }
  try {
    navigator.serviceWorker.addEventListener('message', ({ data }) => {
      if (data.type === 'offline-status') { $('offline').textContent = data.ready ? '离线已就绪' : '离线资源尚未完整'; $('offline').classList.toggle('ready', data.ready); }
    });
    await navigator.serviceWorker.register('./sw.js');
    const registration = await navigator.serviceWorker.ready;
    registration.active?.postMessage('offline-status');
    navigator.serviceWorker.addEventListener('controllerchange', () => navigator.serviceWorker.controller?.postMessage('offline-status'));
    if (registration.waiting) toast('新版本已下载，关闭全部临席页面后重新打开即可更新');
  } catch { $('offline').textContent = '离线缓存未成功'; }
}
window.addEventListener('pagehide', persist);
cancelDisconnectedUndo(); syncUndoTimer(); render(); renderDiagnostics(); offlineSetup();

const initialInvite = new URLSearchParams(location.hash.slice(1)).get('join');
if (initialInvite) {
  history.replaceState(null, '', location.pathname + location.search);
  openDialog('connect-dialog'); $('in-code').value = initialInvite; readSignal();
}
