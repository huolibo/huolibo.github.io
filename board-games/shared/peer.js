export const MAX_MESSAGE = 220000;
export async function encodeSignal(data) {
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  const zipped = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  return 'LX1.' + btoa(String.fromCharCode(...zipped)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
export async function decodeSignal(raw) {
  const text = raw.trim();
  if (text.length > 40000 || !/^LX1\.[A-Za-z0-9_-]+$/.test(text)) throw Error('不是有效的临席连接码，请完整复制');
  const bytes = Uint8Array.from(atob(text.slice(4).replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  let length = 0, chunks = [];
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    length += value.length;
    if (length > 100000) { await reader.cancel(); throw Error('连接码过大'); }
    chunks.push(value);
  }
  const d = JSON.parse(await new Blob(chunks).text());
  if (d.v !== 1 || !d.description || !['offer', 'answer'].includes(d.description.type) || typeof d.description.sdp !== 'string' || typeof d.id !== 'string' || d.id.length > 80) throw Error('连接码内容或版本不兼容');
  return d;
}
export class PeerLink {
  constructor({ onMessage, onStatus, onOpen }) {
    if (!globalThis.RTCPeerConnection) throw Error('此浏览器不支持 WebRTC，请使用 Safari 或 Chrome');
    this.pc = new RTCPeerConnection({ iceServers: [] });
    this.onMessage = onMessage; this.onStatus = onStatus; this.onOpen = onOpen;
    this.closed = false; this.channel = null;
    this.pc.onconnectionstatechange = () => {
      if (this.closed) return;
      onStatus(this.pc.connectionState);
      if (this.pc.connectionState === 'connected') clearTimeout(this.timer);
    };
    this.pc.ondatachannel = e => this.attach(e.channel);
  }
  attach(channel) {
    if (this.channel) { channel.close(); return; }
    this.channel = channel;
    channel.onopen = () => { if (this.closed) return; clearTimeout(this.timer); this.onStatus('connected'); this.onOpen(); };
    channel.onclose = () => { if (!this.closed) this.onStatus('disconnected'); };
    channel.onerror = () => { if (!this.closed) this.onStatus('failed'); };
    channel.onmessage = e => {
      if (this.closed) return;
      if (typeof e.data !== 'string' || e.data.length > MAX_MESSAGE) { this.onStatus('invalid'); return; }
      try { this.onMessage(JSON.parse(e.data)); } catch { this.onStatus('invalid'); }
    };
  }
  async gather(description) {
    await this.pc.setLocalDescription(description);
    if (this.pc.iceGatheringState !== 'complete') await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pc.removeEventListener('icegatheringstatechange', change); reject(Error('收集连接信息超时，请检查 Wi-Fi 后重试')); }, 12000);
      const change = () => { if (this.pc.iceGatheringState === 'complete') { clearTimeout(timer); this.pc.removeEventListener('icegatheringstatechange', change); resolve(); } };
      this.pc.addEventListener('icegatheringstatechange', change); change();
    });
    const local = this.pc.localDescription.toJSON();
    if (!local.sdp.includes('a=candidate:')) throw Error('浏览器未提供局域网连接地址。请换用普通 Wi-Fi 或其他浏览器，并查看连接诊断');
    return local;
  }
  async offer(meta) {
    this.attach(this.pc.createDataChannel('linxi', { ordered: true }));
    const description = await this.gather(await this.pc.createOffer());
    return encodeSignal({ v: 1, ...meta, description });
  }
  async answer(offer) {
    await this.pc.setRemoteDescription(offer.description);
    const description = await this.gather(await this.pc.createAnswer());
    this.waitConnection();
    return encodeSignal({ v: 1, protocol: offer.protocol, gameType: offer.gameType, id: offer.id, description });
  }
  async accept(answer, id) {
    if (answer.id !== id || answer.description.type !== 'answer') throw Error('回应码不属于当前对局');
    await this.pc.setRemoteDescription(answer.description); this.waitConnection();
  }
  waitConnection() { clearTimeout(this.timer); this.timer = setTimeout(() => { if (!this.isOpen) this.onStatus('timeout'); }, 20000); }
  get isOpen() { return this.channel?.readyState === 'open'; }
  send(data) {
    if (!this.isOpen) throw Error('连接已断开，请重新配对');
    const text = JSON.stringify(data);
    if (text.length > MAX_MESSAGE || this.channel.bufferedAmount > MAX_MESSAGE * 2) throw Error('同步数据过大或连接繁忙');
    this.channel.send(text);
  }
  close() { this.closed = true; clearTimeout(this.timer); this.channel?.close(); this.pc.close(); }
}
