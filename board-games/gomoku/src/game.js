import { REMATCH_ACTIONS, applyRematch } from '../../shared/rematch.js';
import { initialBoard, legalMoves, winningLine, positionKey, moveLabel, sideName } from './rules.js';
export const PROTOCOL = 2;
export const UNDO_TIMEOUT_MS = 30000;
export function undoCount(state, actor) {
  if (![1, -1].includes(actor)) return 0;
  const index = state.moves.findLastIndex(move => move.side === actor);
  const count = state.moves.length - index;
  return index >= 0 && count <= 2 ? count : 0;
}
export function createGame(settings = {}, id = 'local', phase = 'playing') {
  const hints = Number(settings.hints ?? 3), seconds = Number(settings.seconds ?? 10);
  if (!Number.isInteger(hints) || hints < 0 || hints > 10 || ![3, 5, 10, 20, 30].includes(seconds)) throw Error('对局设置无效');
  if (!['lobby', 'playing'].includes(phase) || typeof id !== 'string' || id.length > 80) throw Error('对局信息无效');
  const board = initialBoard();
  return { id, settings: { hints, seconds }, initialPhase: phase, phase, board, turn: 1, used: { 1: 0, '-1': 0 }, moves: [], events: [], positions: [positionKey(board, 1)], result: null, winning: [], drawOffer: null, rematchOffer: null, rematchAccepted: false, undoRequest: null, lastHint: null, revision: 0 };
}
export function transition(state, action, actor) {
  if (![1, -1].includes(actor) || !action || typeof action.type !== 'string') throw Error('操作无效');
  if (state.events.length >= 2000) throw Error('对局记录已达上限，请导出棋谱');
  if (state.result && !REMATCH_ACTIONS.includes(action.type)) throw Error('对局已经结束');
  if (state.phase === 'lobby' && action.type !== 'ready') throw Error('等待双方确认规则');
  if (state.undoRequest && !['acceptUndo', 'rejectUndo', 'cancelUndo'].includes(action.type)) throw Error('请先处理悔棋请求');
  const next = structuredClone(state), a = { type: action.type };
  if (REMATCH_ACTIONS.includes(a.type)) {
    applyRematch(state, action, actor, next, a);
  } else if (a.type === 'requestUndo') {
    if (state.events.length >= 1999) throw Error('对局记录不足以完成悔棋，请导出棋谱');
    if (state.drawOffer) throw Error('请先处理和棋请求');
    const count = undoCount(state, actor);
    if (!count) throw Error('还没有自己可撤回的棋步');
    if (!Number.isSafeInteger(action.at) || action.at < 0 || action.at > Number.MAX_SAFE_INTEGER - UNDO_TIMEOUT_MS) throw Error('悔棋请求时间无效');
    a.at = action.at;
    next.undoRequest = { id: state.revision + 1, side: actor, count, targetPly: state.moves.length - count, createdAt: a.at, expiresAt: a.at + UNDO_TIMEOUT_MS };
  } else if (['acceptUndo', 'rejectUndo', 'cancelUndo'].includes(a.type)) {
    const request = state.undoRequest;
    if (!request || action.requestId !== request.id) throw Error('悔棋请求已失效');
    if (!Number.isSafeInteger(action.at) || action.at < request.createdAt) throw Error('悔棋响应时间无效');
    a.at = action.at; a.requestId = request.id;
    if (a.type === 'cancelUndo') {
      if (!['timeout', 'disconnect', 'withdraw'].includes(action.reason)) throw Error('取消原因无效');
      if (action.reason === 'withdraw' && actor !== request.side) throw Error('只能撤销自己的悔棋申请');
      if (action.reason === 'disconnect' && actor !== 1) throw Error('断线取消由创建方同步');
      if (action.reason === 'timeout' && a.at < request.expiresAt) throw Error('悔棋请求尚未超时');
      a.reason = action.reason;
    } else {
      if (actor !== -request.side) throw Error('悔棋必须由对方确认');
      if (a.at >= request.expiresAt) throw Error('悔棋请求已超时');
      if (a.type === 'acceptUndo') {
        const removed = next.moves.splice(request.targetPly);
        for (const move of removed) next.board[move.to] = 0;
        next.winning = [];
        next.turn = request.side;
        next.positions = next.positions.slice(0, request.targetPly + 1);
        next.lastHint = null; next.drawOffer = null;
        // Keep the append-only event log and AI usage. Only the active line rewinds.
      }
    }
    next.undoRequest = null;
  } else if (a.type === 'ready') {
    if (state.phase !== 'lobby' || actor !== -1) throw Error('无法重复开始');
    next.phase = 'playing';
  } else if (a.type === 'move') {
    if (actor !== state.turn) throw Error('还没有轮到你');
    if (!Number.isInteger(action.from) || !Number.isInteger(action.to)) throw Error('走法无效');
    const move = legalMoves(state.board, actor, action.from).find(m => m.to === action.to);
    if (!move) throw Error('请选择棋盘上的空交叉点');
    Object.assign(a, move);
    next.moves.push({ ...move, side: actor, label: moveLabel(state.board, move), captured: state.board[move.to] });
    next.board[move.to] = actor; next.turn = -actor; next.drawOffer = null; next.lastHint = null;
    next.positions.push(positionKey(next.board, next.turn));
    next.winning = winningLine(next.board, move.to, actor);
    if (next.winning.length) next.result = { winner: actor, reason: '五子连线' };
    else if (next.moves.length === 225) next.result = { winner: 0, reason: '棋盘已满，和棋' };
  } else if (a.type === 'hint') {
    if (actor !== state.turn) throw Error('只能在自己的回合分析');
    if (state.used[actor] >= state.settings.hints) throw Error('本局 AI 次数已用完');
    if (state.lastHint?.ply === state.moves.length) throw Error('这一回合已经使用过 AI');
    next.used[actor]++; next.lastHint = { side: actor, ply: state.moves.length, revision: state.revision + 1 };
  } else if (a.type === 'resign') next.result = { winner: -actor, reason: `${sideName(actor)}认输` };
  else if (a.type === 'offerDraw') {
    if (state.drawOffer) throw Error('已有待处理的和棋请求');
    next.drawOffer = actor;
  } else if (a.type === 'acceptDraw' || a.type === 'rejectDraw') {
    if (state.drawOffer !== -actor) throw Error('没有对方的和棋请求');
    next.drawOffer = null;
    if (a.type === 'acceptDraw') next.result = { winner: 0, reason: '双方同意和棋' };
  } else throw Error('未知操作');
  next.revision++; next.events.push({ actor, action: a });
  return next;
}
export const packGame = state => ({ kind: 'gomoku', protocol: PROTOCOL, id: state.id, settings: state.settings, phase: state.initialPhase, events: state.events });
export function unpackGame(data) {
  if (!data || data.kind !== 'gomoku' || ![1, PROTOCOL].includes(data.protocol) || !Array.isArray(data.events) || data.events.length > 2000) throw Error('棋谱版本或格式无效');
  let state = createGame(data.settings, data.id, data.phase);
  for (const e of data.events) state = transition(state, e.action, e.actor);
  return state;
}
export function acceptSnapshot(current, data) {
  const next = unpackGame(data);
  if (next.id !== current.id || JSON.stringify(next.settings) !== JSON.stringify(current.settings) || next.initialPhase !== current.initialPhase) throw Error('对局身份或规则不一致');
  if (next.revision < current.revision || JSON.stringify(next.events.slice(0, current.revision)) !== JSON.stringify(current.events)) throw Error('双方棋谱冲突，已暂停同步');
  return next;
}
