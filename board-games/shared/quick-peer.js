import { Peer } from 'peerjs';
import { MAX_MESSAGE } from './peer.js';

export class QuickPeerLink {
  constructor({ onMessage, onStatus, onOpen, onError }) {
    this.onMessage = onMessage; this.onStatus = onStatus; this.onOpen = onOpen; this.onError = onError;
    this.closed = false; this.connection = null; this.meta = null; this.transport = 'quick';
    // Production uses a fixed service. Local browser tests use a local PeerServer.
    const test = ['localhost', '127.0.0.1'].includes(location.hostname) ? globalThis.__LINXI_SIGNAL_SERVER__ : null;
    const options = { host: '0.peerjs.com', port: 443, path: '/', secure: true, key: 'peerjs',
      ...(test || {}), config: { iceServers: [] }, debug: 0 };
    this.peer = new Peer('linxi-' + crypto.randomUUID(), options);
    this.ready = new Promise((resolve, reject) => { this.resolveReady = resolve; this.rejectReady = reject; });
    // A handler is attached immediately, including when a user cancels mid-connect.
    this.ready.catch(() => {});
    this.timer = setTimeout(() => this.fail('快捷配对服务连接超时，请改用离线互扫或稍后重试'), 20000);
    this.peer.on('open', id => { clearTimeout(this.timer); this.resolveReady?.(id); this.resolveReady = null; this.rejectReady = null; });
    this.peer.on('connection', connection => {
      const data = connection.metadata;
      if (this.closed || this.connection || !this.meta || data?.id !== this.meta.id || data?.gameType !== this.meta.gameType
        || data?.protocol !== this.meta.protocol || data?.secret !== this.meta.secret) { connection.close(); return; }
      this.attach(connection);
    });
    this.peer.on('error', () => { if (!this.isOpen) this.fail('快捷配对暂不可用，邀请可能已失效。请重新创建或使用离线互扫'); });
    this.peer.on('disconnected', () => { if (!this.closed && !this.isOpen) this.fail('快捷配对服务已断开，请重新创建或使用离线互扫'); });
  }
  async host(meta) { const id = await this.ready; if (this.closed) throw Error('连接已取消'); this.meta = { ...meta, peer: id }; return this.meta; }
  async join(meta) {
    await this.ready; if (this.closed) throw Error('连接已取消');
    this.attach(this.peer.connect(meta.peer, { reliable: true, serialization: 'json', label: 'linxi',
      metadata: { id: meta.id, gameType: meta.gameType, protocol: meta.protocol, secret: meta.secret } }));
  }
  attach(connection) {
    this.connection = connection;
    clearTimeout(this.timer); this.timer = setTimeout(() => this.fail('双方直连超时，请检查同一 Wi-Fi 或热点后重试'), 20000);
    connection.on('open', () => {
      if (this.closed) return;
      clearTimeout(this.timer); this.onStatus('connected'); this.onOpen();
      // Once connected, moves flow through the DataChannel and no longer need the broker.
      this.peer.disconnect();
    });
    connection.on('data', data => {
      if (this.closed) return;
      if (!data || typeof data !== 'object' || JSON.stringify(data).length > MAX_MESSAGE) { this.fail('收到无效的同步数据'); return; }
      this.onMessage(data);
    });
    connection.on('close', () => { if (!this.closed) this.onStatus('disconnected'); });
    connection.on('error', () => { if (!this.closed) this.onStatus('failed'); });
    this.pc?.addEventListener('connectionstatechange', () => {
      if (!this.closed && ['disconnected', 'failed', 'closed'].includes(this.pc.connectionState)) this.onStatus(this.pc.connectionState);
    });
  }
  fail(message) {
    if (this.closed) return;
    this.rejectReady?.(Error(message)); this.rejectReady = null; this.resolveReady = null;
    this.close(); this.onStatus('failed'); this.onError?.(message);
  }
  get pc() { return this.connection?.peerConnection; }
  get channel() { return this.connection?.dataChannel; }
  get isOpen() { return !this.closed && this.connection?.open === true; }
  send(data) {
    if (!this.isOpen) throw Error('连接已断开，请重新配对');
    if (JSON.stringify(data).length > MAX_MESSAGE || this.channel?.bufferedAmount > MAX_MESSAGE * 2) throw Error('同步数据过大或连接繁忙');
    this.connection.send(data);
  }
  close() { this.closed = true; clearTimeout(this.timer); this.rejectReady?.(Error('连接已取消')); this.rejectReady = null; this.peer.destroy(); }
}
