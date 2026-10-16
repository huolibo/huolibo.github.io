import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeQuickSignal, decodeQuickSignal, quickInviteURL } from '../quick-code.js';
const invitation={v:1,gameType:'gomoku',protocol:2,id:'match',peer:'linxi-12345678-1234-1234-1234-123456789012',secret:'12345678-1234-1234-1234-123456789012',phase:'lobby',settings:{hints:3,seconds:10}};
test('quick invitations round-trip as one short URL with credentials only in fragment',()=>{
  const code=encodeQuickSignal(invitation),url=quickInviteURL(code,'https://huolibo.github.io/gomoku/?old=1');
  assert.equal(new URL(url).search,'');assert(url.length<900);
  assert.deepEqual(decodeQuickSignal(code),invitation);assert.deepEqual(decodeQuickSignal(url),invitation);
});
test('malformed or oversized quick invitations are rejected, manual codes remain separate',()=>{
  assert.equal(decodeQuickSignal('LX1.some-manual-code'),null);
  for(const data of [{...invitation,secret:'short'},{...invitation,peer:'../other'},{...invitation,gameType:'other'},{...invitation,settings:{hints:999,seconds:10}},{...invitation,phase:'bad'}]) assert.throws(()=>encodeQuickSignal(data));
  assert.throws(()=>decodeQuickSignal('LXQ1.invalid'));assert.throws(()=>decodeQuickSignal('LXQ1.'+'a'.repeat(2000)));
});
