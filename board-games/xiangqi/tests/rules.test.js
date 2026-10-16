import test from 'node:test';
import assert from 'node:assert/strict';
import { initialBoard, pseudoMoves, legalMoves, moved, inCheck } from '../src/rules.js';
import { createGame, transition, packGame, unpackGame, acceptSnapshot } from '../src/game.js';
import { search } from '../src/engine.js';
const board = pieces => { const b = Array(90).fill(0); for (const [i, p] of pieces) b[i] = p; return b; };
test('initial position has 32 pieces and 44 legal moves per side', () => {
  const b = initialBoard(); assert.equal(b.filter(Boolean).length, 32);
  assert.equal(legalMoves(b, 1).length, 44); assert.equal(legalMoves(b, -1).length, 44);
  assert.equal(inCheck(b, 1), false); assert.equal(inCheck(b, -1), false);
});
test('horse leg blocks both corresponding destinations', () => {
  let b = board([[40, 4], [41, 7]]);
  assert(!pseudoMoves(b, 40).includes(33)); assert(!pseudoMoves(b, 40).includes(51));
  b[41] = 0; assert(pseudoMoves(b, 40).includes(33)); assert(pseudoMoves(b, 40).includes(51));
});
test('elephants cannot cross river or jump through elephant eye', () => {
  const b = board([[58, 3], [66, 7]]);
  assert(!pseudoMoves(b, 58).includes(38)); assert(!pseudoMoves(b, 58).includes(74));
  assert(pseudoMoves(b, 58).includes(78));
});
test('cannon captures over exactly one screen; cannot land on the screen', () => {
  const b = board([[40, 6], [41, 7], [43, -5], [44, -7]]);
  assert(pseudoMoves(b, 40).includes(43)); assert(!pseudoMoves(b, 40).includes(41));
  assert(!pseudoMoves(b, 40).includes(42)); assert(!pseudoMoves(b, 40).includes(44));
  b[41] = 0; assert(!pseudoMoves(b, 40).includes(43));
});
test('pawns move sideways only after crossing, never backwards', () => {
  const b = board([[58, 7], [40, 7], [49, -7]]);
  assert.deepEqual(pseudoMoves(b, 58), [49]);
  assert.deepEqual(pseudoMoves(b, 40), [31, 39, 41]);
  assert.deepEqual(pseudoMoves(b, 49), [58, 48, 50]);
});
test('advisors and kings stay in palace', () => {
  const b = board([[84, 2], [66, 1], [4, -1]]);
  assert.deepEqual(pseudoMoves(b, 84), [76]);
  assert(pseudoMoves(b, 66).every(i => i % 9 >= 3 && i % 9 <= 5 && Math.floor(i / 9) >= 7));
});
test('facing generals and exposing own king are illegal', () => {
  const b = board([[4, -1], [85, 1], [49, 5]]);
  assert.equal(inCheck(b, 1), false);
  assert(!legalMoves(b, 1, 49).some(m => m.to === 48));
  b[49] = 0; assert(inCheck(b, 1)); assert(inCheck(b, -1));
});
test('a checked side must resolve check', () => {
  const b = board([[4, -1], [85, 1], [76, -5], [81, 5]]);
  assert(inCheck(b, 1)); assert(!legalMoves(b, 1).some(m => m.from === 81 && m.to === 72));
  for (const move of legalMoves(b, 1)) assert(!inCheck(moved(b, move), 1));
});
test('turns, AI quotas and replay survive serialization', () => {
  let s = createGame({ hints: 1, seconds: 3 });
  assert.throws(() => transition(s, { type: 'move', from: 54, to: 45 }, -1));
  s = transition(s, { type: 'hint' }, 1);
  assert.throws(() => transition(s, { type: 'hint' }, 1));
  s = transition(s, { type: 'move', from: 54, to: 45 }, 1);
  s = transition(s, { type: 'move', from: 27, to: 36 }, -1);
  assert.throws(() => transition(s, { type: 'hint' }, 1));
  assert.deepEqual(unpackGame(JSON.parse(JSON.stringify(packGame(s)))), s);
});
test('a peer cannot change settings, roll back or rewrite history', () => {
  const initial = createGame(), s = transition(initial, { type: 'move', from: 54, to: 45 }, 1);
  assert.throws(() => acceptSnapshot(s, packGame(initial)));
  const other = transition(initial, { type: 'move', from: 56, to: 47 }, 1);
  assert.throws(() => acceptSnapshot(s, packGame(other)));
  assert.throws(() => acceptSnapshot(initial, { ...packGame(s), settings: { hints: 10, seconds: 30 } }));
  assert.deepEqual(acceptSnapshot(initial, packGame(s)), s);
});
test('only black can confirm lobby rules; game cannot start twice', () => {
  let s = createGame({}, 'match', 'lobby');
  assert.throws(() => transition(s, { type: 'move', from: 54, to: 45 }, 1));
  assert.throws(() => transition(s, { type: 'ready' }, 1));
  s = transition(s, { type: 'ready' }, -1); assert.equal(s.phase, 'playing');
  assert.throws(() => transition(s, { type: 'ready' }, -1));
});
test('threefold repetition is a draw under the documented casual rules', () => {
  let s = createGame();
  for (let n = 0; n < 2; n++) for (const [from, to, side] of [[82, 65, 1], [1, 20, -1], [65, 82, 1], [20, 1, -1]]) s = transition(s, { type: 'move', from, to }, side);
  assert.equal(s.result.winner, 0); assert.match(s.result.reason, /第三次/);
});
test('draw offers need the other player and resignation is final', () => {
  let s = transition(createGame(), { type: 'offerDraw' }, 1);
  assert.throws(() => transition(s, { type: 'acceptDraw' }, 1));
  s = transition(s, { type: 'acceptDraw' }, -1); assert.equal(s.result.winner, 0);
  assert.throws(() => transition(s, { type: 'hint' }, 1));
  s = transition(createGame(), { type: 'resign' }, -1); assert.equal(s.result.winner, 1);
});
test('checkmate and stalemate both lose in Xiangqi', () => {
  let s = createGame();
  s.board = board([[4, -1], [85, 1], [49, 7], [12, 5], [14, 5], [22, 5]]);
  s = transition(s, { type: 'move', from: 22, to: 13 }, 1);
  assert.deepEqual(s.result, { winner: 1, reason: '将死' });
  s = createGame();
  s.board = board([[4, -1], [85, 1], [49, 7], [12, 5], [14, 5], [54, 7]]);
  s = transition(s, { type: 'move', from: 54, to: 45 }, 1);
  assert.deepEqual(s.result, { winner: 1, reason: '困毙' });
});
test('engine supplies a legal fallback even on a tiny time budget', () => {
  const b = initialBoard(); let tick = 0; const progress = [];
  const result = search(b, 1, { milliseconds: 1, now: () => tick++, onProgress: p => progress.push(p) });
  assert(legalMoves(b, 1).some(m => m.from === result.move.from && m.to === result.move.to));
  assert.equal(result.depth, 0); assert(progress.length >= 1);
});
test('engine finds a hanging rook and returns within a bounded budget', () => {
  const b = board([[4, -1], [85, 1], [49, 7], [81, 5], [72, -5]]);
  const result = search(b, 1, { milliseconds: 150, maxDepth: 2 });
  assert.deepEqual(result.move, { from: 81, to: 72 }); assert(result.depth >= 1); assert(result.elapsed < 2000);
});
test('random legal play never leaves the moving side in check and replays exactly', () => {
  let s = createGame(); let seed = 19;
  for (let i = 0; i < 80 && !s.result; i++) {
    const moves = legalMoves(s.board, s.turn); seed = (seed * 1664525 + 1013904223) >>> 0;
    const side = s.turn, move = moves[seed % moves.length];
    s = transition(s, { type: 'move', ...move }, side); assert(!inCheck(s.board, side));
  }
  assert.deepEqual(unpackGame(packGame(s)), s);
});
