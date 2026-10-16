import test from 'node:test';
import assert from 'node:assert/strict';
import { initialBoard, winningLine, legalMoves } from '../src/rules.js';
import { createGame, transition, packGame, unpackGame, acceptSnapshot } from '../src/game.js';
import { unpackGame as unpackXiangqi } from '../../xiangqi/src/game.js';
import { search } from '../src/engine.js';
const play = (s, to) => transition(s, { type: 'move', from: -1, to }, s.turn);

test('15×15 empty board, black starts; occupied and out-of-board moves are rejected', () => {
  let s = createGame(); assert.equal(s.board.length, 225); assert.equal(s.turn, 1);
  assert.equal(legalMoves(s.board, 1).length, 225);
  assert.throws(() => transition(s, { type: 'move', from: -1, to: 112 }, -1));
  s = play(s, 112); assert.equal(s.board[112], 1);
  for (const to of [-1, 225, 112, 1.5, NaN]) assert.throws(() => play(s, to));
  assert.throws(() => transition(s, { type: 'move', from: 112, to: 113 }, -1));
});
test('five in all four directions wins, overlines allowed and row wrapping forbidden', () => {
  for (const [start, step] of [[0,1], [0,15], [0,16], [14,14]]) {
    const b = initialBoard(); for (let i = 0; i < 5; i++) b[start+i*step] = -1;
    assert.equal(winningLine(b, start+2*step, -1).length, 5);
  }
  const b = initialBoard(); for (let i = 0; i < 6; i++) b[105+i] = 1;
  assert.equal(winningLine(b, 108, 1).length, 6);
  const edge = initialBoard(); for (const i of [13,14,15,16,17]) edge[i] = 1;
  assert.equal(winningLine(edge, 15, 1).length, 0);
});
test('a winning game highlights the line and rejects all later moves', () => {
  let s = createGame(); for (const to of [105,0,106,2,107,4,108,6,109]) s = play(s, to);
  assert.equal(s.result.winner, 1); assert.equal(s.winning.length, 5);
  assert.throws(() => play(s, 110)); assert.throws(() => transition(s, { type: 'requestUndo', at: 1 }, 1));
  assert.deepEqual(unpackGame(packGame(s)), s);
});
test('full board without five is a draw and its complete history replays', () => {
  let s = createGame(); const points = {1:[], '-1':[]};
  for (let i=0;i<225;i++) points[(Math.floor(i%15/2)+Math.floor(i/15))%2 === 0 ? 1 : -1].push(i);
  for (let i=0;i<225;i++) s=play(s,points[s.turn].shift());
  assert.equal(s.result.winner,0); assert.match(s.result.reason,/棋盘已满/);
  assert.deepEqual(unpackGame(packGame(s)),s);
});
test('agreed two-ply undo retains quotas and validates history on the other peer', () => {
  let s = transition(createGame({ hints:1 }), { type:'hint' },1);
  s=play(s,112); s=play(s,113); const before=s;
  s=transition(s,{type:'requestUndo',at:1000},1);
  assert.equal(s.undoRequest.count,2);
  assert.throws(()=>transition(s,{type:'hint'},1));
  assert.throws(()=>transition(s,{type:'acceptUndo',requestId:s.undoRequest.id,at:1001},1));
  s=transition(s,{type:'acceptUndo',requestId:s.undoRequest.id,at:1001},-1);
  assert.deepEqual(s.board,initialBoard()); assert.equal(s.used[1],1); assert.equal(s.turn,1);
  assert.deepEqual(acceptSnapshot(before,packGame(s)),s);
  assert.deepEqual(unpackGame(packGame(play(s,111))),play(s,111));
  assert.throws(()=>acceptSnapshot(s,packGame(before)));
});
test('late undo is rejected; timeout, refusal and disconnect keep all stones', () => {
  const before=play(createGame(),112), request=transition(before,{type:'requestUndo',at:1000},1);
  const id=request.undoRequest.id;
  assert.throws(()=>transition(request,{type:'acceptUndo',requestId:id,at:31000},-1));
  for(const action of [{type:'rejectUndo',requestId:id,at:1001},{type:'cancelUndo',reason:'timeout',requestId:id,at:31000},{type:'cancelUndo',reason:'disconnect',requestId:id,at:1001}]) {
    const s=transition(request,action,action.type==='rejectUndo'?-1:1);
    assert.deepEqual(s.board,before.board); assert.equal(s.undoRequest,null);
    assert.deepEqual(unpackGame(packGame(s)),s);
  }
});
test('game identity prevents importing Xiangqi saves in either direction', () => {
  const data=packGame(createGame()); assert.throws(()=>unpackXiangqi(data));
  assert.throws(()=>unpackGame({...data,kind:'xiangqi'}));
  assert.throws(()=>unpackGame({...data,kind:undefined}));
});
test('AI takes an immediate win before blocking and blocks a single winning threat', () => {
  const b=initialBoard(); for(const i of [108,109,110,111]) b[i]=1;
  for(const i of [32,33,34,35]) b[i]=-1;
  const result=search(b,1,{milliseconds:100,maxDepth:3}); b[result.move.to]=1;
  assert(winningLine(b,result.move.to,1).length>=5);
  const defense=initialBoard(); defense[105]=1; for(const i of [106,107,108,109]) defense[i]=-1;
  assert.equal(search(defense,1,{milliseconds:100,maxDepth:2}).move.to,110);
});
test('AI detects broken fours, has a legal tiny-budget fallback and leaves input untouched', () => {
  const b=initialBoard(); for(const i of [105,106,108,109]) b[i]=1;
  assert.equal(search(b,1,{milliseconds:100,maxDepth:2}).move.to,107);
  const copy=[...b]; let tick=0;
  const tiny=search(b,-1,{milliseconds:1,now:()=>tick++});
  assert.equal(b[tiny.move.to],0); assert.deepEqual(b,copy);
  const normal=search(b,-1,{milliseconds:40,maxDepth:6});
  assert.equal(b[normal.move.to],0); assert.deepEqual(b,copy); assert(normal.elapsed<1500);
});
