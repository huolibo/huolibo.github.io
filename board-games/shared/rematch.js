export const REMATCH_ACTIONS = ['offerRematch', 'acceptRematch', 'rejectRematch', 'cancelRematch'];

export function applyRematch(state, action, actor, next, normalized) {
  if (!state.result) throw Error('本局结束后才能再来一局');
  if (state.rematchAccepted) throw Error('双方已同意新局，请等待同步');
  if (action.type === 'offerRematch') {
    if (state.rematchOffer) throw Error('已有再来一局的邀请');
    if (state.events.length >= 1999) throw Error('对局记录已达上限，请新建对局');
    if (!Number.isSafeInteger(action.at) || action.at < 0 || action.at > Number.MAX_SAFE_INTEGER - 30000) throw Error('邀请时间无效');
    normalized.at = action.at;
    next.rematchOffer = { id: state.revision + 1, side: actor, createdAt: action.at, expiresAt: action.at + 30000 };
    return;
  }
  const offer = state.rematchOffer;
  if (!offer || action.requestId !== offer.id) throw Error('再来一局的邀请已失效');
  if (!Number.isSafeInteger(action.at) || action.at < offer.createdAt) throw Error('邀请响应时间无效');
  normalized.at = action.at; normalized.requestId = offer.id;
  if (action.type === 'cancelRematch') {
    if (!['timeout', 'disconnect', 'withdraw'].includes(action.reason)) throw Error('取消原因无效');
    if (action.reason === 'withdraw' && actor !== offer.side) throw Error('只能撤销自己的邀请');
    if (action.reason === 'disconnect' && actor !== 1) throw Error('断线取消由创建方同步');
    if (action.reason === 'timeout' && action.at < offer.expiresAt) throw Error('邀请尚未超时');
    normalized.reason = action.reason;
  } else {
    if (actor !== -offer.side) throw Error('需要对方同意再来一局');
    if (action.at >= offer.expiresAt) throw Error('邀请已超时');
    if (action.type === 'acceptRematch') next.rematchAccepted = true;
  }
  next.rematchOffer = null;
}

export function validateRematch(current, previousData, nextData, acceptSnapshot, unpackGame) {
  const previous = acceptSnapshot(current, previousData);
  if (!previous.result || !previous.rematchAccepted) throw Error('双方尚未同意再来一局');
  const next = unpackGame(nextData);
  if (next.id === previous.id || next.revision !== 0 || next.initialPhase !== 'playing' || JSON.stringify(next.settings) !== JSON.stringify(previous.settings)) throw Error('新局身份或规则无效');
  return next;
}
