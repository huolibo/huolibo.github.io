import test from 'node:test';
import assert from 'node:assert/strict';
import * as xiangqi from '../../xiangqi/src/game.js';
import * as gomoku from '../../gomoku/src/game.js';
import { validateRematch } from '../rematch.js';

for (const [kind, api] of [['xiangqi', xiangqi], ['gomoku', gomoku]]) {
  const { createGame, transition, packGame, unpackGame, acceptSnapshot } = api;
  const ended = () => transition(transition(createGame({hints:1}), {type:'hint'},1),{type:'resign'},1);
  const offer = (s, actor=1) => transition(s,{type:'offerRematch',at:1000},actor);
  const answer = (s,type,actor=-s.rematchOffer.side,extra={}) => transition(s,{type,requestId:s.rematchOffer.id,at:1001,...extra},actor);
  test(`${kind}: both sides must agree after result; new ID and quotas reset`, () => {
    assert.throws(()=>offer(createGame()),/结束后/);
    for(const actor of [1,-1]) {
      let s=offer(ended(),actor); const requested=s;
      assert.throws(()=>answer(s,'acceptRematch',actor),/对方同意/);
      s=answer(s,'acceptRematch');assert.equal(s.rematchAccepted,true);assert.equal(s.used[1],1);
      assert.deepEqual(unpackGame(packGame(s)),s);
      const next=createGame(s.settings,'next','playing');
      assert.deepEqual(validateRematch(requested,packGame(s),packGame(next),acceptSnapshot,unpackGame),next);
      assert.equal(next.used[1],0);assert.equal(next.used[-1],0);
      assert.throws(()=>offer(s),/已同意/);
    }
  });
  test(`${kind}: reject, timeout, withdrawal and disconnect leave finished board intact`, () => {
    const before=ended();
    for(const [type,actor,extra] of [['rejectRematch',-1,{}],['cancelRematch',1,{reason:'withdraw'}],['cancelRematch',1,{reason:'timeout',at:31000}],['cancelRematch',1,{reason:'disconnect'}]]) {
      const s=answer(offer(before),type,actor,extra);
      assert.equal(s.rematchOffer,null);assert.equal(s.rematchAccepted,false);
      for(const key of ['board','moves','used','result']) assert.deepEqual(s[key],before[key]);
      assert.deepEqual(unpackGame(packGame(s)),s);
    }
  });
  test(`${kind}: stale and late invites cannot replace the match or change settings`, () => {
    const requested=offer(ended());
    assert.throws(()=>answer(requested,'acceptRematch',-1,{at:31000}),/超时/);
    assert.throws(()=>answer(requested,'acceptRematch',-1,{requestId:99}),/失效/);
    assert.throws(()=>answer(requested,'cancelRematch',1,{reason:'timeout'}),/尚未超时/);
    const accepted=answer(requested,'acceptRematch'),fresh=createGame(accepted.settings,'fresh');
    assert.throws(()=>validateRematch(requested,packGame(requested),packGame(fresh),acceptSnapshot,unpackGame),/尚未同意/);
    assert.throws(()=>validateRematch(requested,packGame(accepted),packGame(createGame({hints:10},'fresh')),acceptSnapshot,unpackGame),/规则无效/);
    assert.throws(()=>validateRematch(requested,packGame(accepted),packGame(createGame(accepted.settings,accepted.id)),acceptSnapshot,unpackGame));
    assert.throws(()=>validateRematch(requested,packGame(accepted),packGame(createGame(accepted.settings,'fresh','lobby')),acceptSnapshot,unpackGame));
  });
}
