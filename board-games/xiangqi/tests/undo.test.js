import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, transition, packGame, unpackGame, acceptSnapshot, undoCount, UNDO_TIMEOUT_MS } from '../src/game.js';
const move = (s, from, to) => transition(s, { type: 'move', from, to }, s.turn);
const request = (s, side = 1) => transition(s, { type: 'requestUndo', at: 1000 }, side);
const respond = (s, type, side = -s.undoRequest.side, extra = {}) => transition(s, { type, requestId: s.undoRequest.id, at: 2000, ...extra }, side);

test('one-ply undo requires opponent consent, retains quota and replays exactly', () => {
  const initial = createGame();
  let s = transition(initial, { type: 'hint' }, 1);
  s = move(s, 54, 45); const before = s;
  s = request(s);
  assert.equal(s.undoRequest.count, 1); assert.deepEqual(s.board, before.board);
  assert.throws(() => respond(s, 'acceptUndo', 1), /对方确认/);
  for (const action of [{ type: 'move', from: 27, to: 36 }, { type: 'hint' }, { type: 'offerDraw' }, { type: 'resign' }, { type: 'requestUndo', at: 1000 }]) {
    assert.throws(() => transition(s, action, -1), /先处理悔棋/);
  }
  s = respond(s, 'acceptUndo');
  assert.deepEqual(s.board, initial.board); assert.equal(s.turn, 1);
  assert.equal(s.moves.length, 0); assert.equal(s.used[1], 1);
  assert.equal(s.lastHint, null); assert.deepEqual(s.positions, initial.positions);
  assert.deepEqual(acceptSnapshot(before, packGame(s)), s);
  s = move(s, 56, 47);
  assert.deepEqual(unpackGame(packGame(s)), s);
  assert.equal(s.events.filter(e => e.action.type === 'move').length, 2);
});

test('two-ply rollback restores captured pieces and whose turn it is', () => {
  let s = move(createGame(), 54, 45);
  s = move(s, 27, 36); const before = s;
  s = move(s, 45, 36); // red captures black pawn
  s = move(s, 0, 36); // black rook captures that red pawn
  assert.equal(undoCount(s, 1), 2); assert.equal(undoCount(s, -1), 1);
  s = respond(request(s), 'acceptUndo');
  assert.deepEqual(s.board, before.board); assert.deepEqual(s.moves, before.moves);
  assert.deepEqual(s.positions, before.positions); assert.equal(s.turn, before.turn);
  assert.deepEqual(unpackGame(packGame(s)), s);
});

test('black may request one or two plies and cannot approve its own request', () => {
  let s = move(move(createGame(), 54, 45), 27, 36);
  const one = request(s, -1); assert.equal(one.undoRequest.count, 1);
  assert.throws(() => respond(one, 'acceptUndo', -1));
  const back = respond(one, 'acceptUndo', 1); assert.equal(back.turn, -1); assert.equal(back.moves.length, 1);
  s = move(s, 56, 47);
  const two = request(s, -1); assert.equal(two.undoRequest.count, 2);
  assert.deepEqual(respond(two, 'acceptUndo').board, back.board);
});

test('reject, withdraw, timeout and disconnect preserve board, moves and quota', () => {
  let before = move(createGame(), 54, 45);
  before = transition(before, { type: 'hint' }, -1);
  for (const [type, actor, extra] of [['rejectUndo', -1, {}], ['cancelUndo', 1, { reason: 'withdraw' }], ['cancelUndo', 1, { reason: 'disconnect' }], ['cancelUndo', 1, { reason: 'timeout', at: 1000 + UNDO_TIMEOUT_MS }]]) {
    const s = respond(request(before), type, actor, extra);
    for (const key of ['board', 'moves', 'used', 'lastHint', 'positions', 'turn']) assert.deepEqual(s[key], before[key]);
    assert.equal(s.undoRequest, null); assert.deepEqual(unpackGame(packGame(s)), s);
  }
});

test('late and stale responses cannot accept a different or expired request', () => {
  const s = request(move(createGame(), 54, 45));
  assert.throws(() => respond(s, 'acceptUndo', -1, { at: 31000 }), /超时/);
  assert.throws(() => respond(s, 'cancelUndo', 1, { reason: 'timeout', at: 30999 }), /尚未超时/);
  assert.throws(() => respond(s, 'cancelUndo', -1, { reason: 'disconnect' }));
  assert.throws(() => respond(s, 'cancelUndo', -1, { reason: 'withdraw' }));
  assert.throws(() => respond(s, 'acceptUndo', -1, { requestId: 999 }), /失效/);
  const next = request(respond(s, 'rejectUndo'));
  assert.throws(() => respond(next, 'acceptUndo', -1, { requestId: s.undoRequest.id }), /失效/);
  assert.throws(() => respond(s, 'acceptUndo', -1, { at: 0 }));
});

test('undo is unavailable before a move, during draw negotiation or after result; old saves load', () => {
  const initial = createGame(); assert.equal(undoCount(initial, 1), 0);
  assert.throws(() => request(initial));
  const s = move(initial, 54, 45); assert.throws(() => request(s, -1));
  assert.throws(() => request(transition(s, { type: 'offerDraw' }, -1)));
  assert.throws(() => request(transition(s, { type: 'resign' }, -1)));
  assert.deepEqual(unpackGame({ ...packGame(s), protocol: 1 }), s);
  assert.throws(() => request({ ...s, events: Array(1999).fill(s.events[0]) }), /不足/);
});
