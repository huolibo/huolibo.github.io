const PREFIX = 'LXQ1.';
export function encodeQuickSignal(data) {
  validate(data);
  return PREFIX + btoa(JSON.stringify(data)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
export function decodeQuickSignal(raw) {
  let code = String(raw).trim();
  if (/^https?:\/\//.test(code)) {
    try { code = new URLSearchParams(new URL(code).hash.slice(1)).get('join') || ''; }
    catch { throw Error('快捷邀请链接无效'); }
  }
  if (!code.startsWith(PREFIX)) return null;
  if (code.length > 1800 || !/^LXQ1\.[A-Za-z0-9_-]+$/.test(code)) throw Error('快捷邀请格式无效');
  let data;
  try { data = JSON.parse(atob(code.slice(PREFIX.length).replaceAll('-', '+').replaceAll('_', '/'))); }
  catch { throw Error('快捷邀请无法读取'); }
  validate(data); return data;
}
function validate(data) {
  if (!data || data.v !== 1 || !['xiangqi', 'gomoku'].includes(data.gameType) || !Number.isInteger(data.protocol)
    || typeof data.id !== 'string' || !data.id.length || data.id.length > 80
    || !/^linxi-[a-f0-9-]{36}$/.test(data.peer || '') || !/^[A-Za-z0-9_-]{20,80}$/.test(data.secret || '')
    || !['lobby', 'playing'].includes(data.phase) || !data.settings || !Number.isInteger(data.settings.hints)
    || data.settings.hints < 0 || data.settings.hints > 10 || ![3,5,10,20,30].includes(data.settings.seconds)) throw Error('快捷邀请内容无效');
}
export function quickInviteURL(code, pageURL) {
  const url = new URL(pageURL); url.search = ''; url.hash = new URLSearchParams({ join: code }).toString(); return url.href;
}
