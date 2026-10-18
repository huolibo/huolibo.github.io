import { Peer } from 'peerjs';
import { MAX_MESSAGE } from './peer.js';

export const QUICK_CONNECTION_VERSION = '2026-10-18.1';

export class QuickPeerLink {
  constructor({ onMessage, onStatus, onOpen, onError, onProgress }) {
    this.onMessage = onMessage; this.onStatus = onStatus; this.onOpen = onOpen; this.onError = onError; this.onProgress = onProgress;
    this.closed = false; this.connection = null; this.meta = null; this.transport = 'quick';
    this.stage = '连接配对服务'; this.brokerState = 'connecting'; this.errorType = ''; this.iceErrorCode = ''; this.opened = false;
    // Production uses a fixed service. Local browser tests use a local PeerServer.
    const test = ['localhost', '127.0.0.1'].includes(location.hostname) ? globalThis.__LINXI_SIGNAL_SERVER__ : null;
    const options = { host: '0.peerjs.com', port: 443, path: '/', secure: true, key: 'peerjs',
      ...(test || {}), config: test?.config || { iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }] }, debug: 0 };
    this.peer = new Peer('linxi-' + crypto.randomUUID(), options);
    this.ready = new Promise((resolve, reject) => { this.resolveReady = resolve; this.rejectReady = reject; });
    // A handler is attached immediately, including when a user cancels mid-connect.
    this.ready.catch(() => {});
    this.timer = setTimeout(() => this.fail('快捷配对服务连接超时：双方需要能访问互联网。请检查网络，或改用离线互扫。'), 20000);
    this.peer.on('open', id => {
      if (this.closed) return;
      clearTimeout(this.timer); this.brokerState = 'connected';
      this.progress('配对服务已连接', '配对服务已连接，正在准备双方连接信息…');
      this.resolveReady?.(id); this.resolveReady = null; this.rejectReady = null;
    });
    this.peer.on('connection', connection => {
      const data = connection.metadata;
      if (this.closed || this.connection || !this.meta || data?.id !== this.meta.id || data?.gameType !== this.meta.gameType
        || data?.protocol !== this.meta.protocol || data?.secret !== this.meta.secret) { connection.close(); return; }
      this.attach(connection);
    });
    this.peer.on('error', error => {
      if (this.closed || this.isOpen) return;
      this.errorType = error?.type || 'unknown';
      if (this.errorType === 'peer-unavailable') this.fail('邀请已失效，或创建方已离开页面。请对方重新创建快捷邀请。');
      else if (['browser-incompatible', 'webrtc'].includes(this.errorType)) this.fail('浏览器未能建立 WebRTC 连接，请更新 Safari 后重试，或使用离线互扫。');
      else this.fail('快捷配对暂不可用：无法连接公共配对服务。请检查双方互联网连接，或使用离线互扫。');
    });
    this.peer.on('disconnected', () => {
      this.brokerState = 'disconnected';
      if (!this.closed && !this.isOpen) this.fail('快捷配对服务已断开，请保持双方页面在前台，并重新创建邀请。');
      else this.onProgress?.();
    });
  }
  progress(stage, message) {
    if (this.closed || this.opened) return;
    if (this.stage !== stage) { this.stage = stage; this.onProgress?.(message); }
  }
  async host(meta) {
    const id = await this.ready; if (this.closed) throw Error('连接已取消'); this.meta = { ...meta, peer: id };
    this.progress('等待对方加入', '邀请已就绪，等待对方扫描。请保持本页面在前台。'); return this.meta;
  }
  async join(meta) {
    await this.ready; if (this.closed) throw Error('连接已取消');
    this.attach(this.peer.connect(meta.peer, { reliable: true, serialization: 'json', label: 'linxi',
      metadata: { id: meta.id, gameType: meta.gameType, protocol: meta.protocol, secret: meta.secret } }));
  }
  attach(connection) {
    this.connection = connection;
    this.rtc = connection.peerConnection;
    this.progress('交换双方连接信息', '配对服务已连接，正在发送连接请求并自动交换连接信息…');
    clearTimeout(this.timer); this.timer = setTimeout(() => this.fail(this.directFailure()), 20000);
    connection.on('open', () => {
      if (this.closed) return;
      clearTimeout(this.timer); this.opened = true; this.stage = '数据通道已建立'; this.onStatus('connected'); this.onOpen();
      // Once connected, moves flow through the DataChannel and no longer need the broker.
      this.peer.disconnect();
    });
    connection.on('data', data => {
      if (this.closed) return;
      if (!data || typeof data !== 'object' || JSON.stringify(data).length > MAX_MESSAGE) { this.fail('收到无效的同步数据'); return; }
      this.onMessage(data);
    });
    connection.on('close', () => {
      if (this.closed) return;
      if (!this.opened) this.fail(this.directFailure()); else this.onStatus('disconnected');
    });
    connection.on('error', error => {
      if (this.closed) return;
      this.errorType = error?.type || 'data-channel';
      this.fail(this.opened ? '对战连接已中断，棋谱已保存。请重新配对。' : this.directFailure());
    });
    const pc = this.pc;
    pc?.addEventListener('signalingstatechange', () => {
      if (pc.remoteDescription && !this.closed) this.progress('建立双方直连', '已收到对方连接信息，正在尝试建立直连…请保持双方页面在前台。');
      this.onProgress?.();
    });
    pc?.addEventListener('icecandidate', () => { if (!this.closed) this.onProgress?.(); });
    pc?.addEventListener('icecandidateerror', event => {
      if (!this.closed) { this.iceErrorCode = String(event.errorCode); this.onProgress?.(); }
    });
    pc?.addEventListener('connectionstatechange', () => {
      if (this.closed) return;
      if (pc.connectionState === 'failed') this.fail(this.directFailure());
      else if (['disconnected', 'closed'].includes(pc.connectionState)) this.onStatus(pc.connectionState);
      this.onProgress?.();
    });
  }
  directFailure() {
    if (!this.pc?.remoteDescription) return '尚未收到对方连接信息：请确认创建方页面仍在前台，双方均能联网，然后重新创建邀请。';
    if (!this.pc?.localDescription?.sdp.includes('a=candidate:')) return '浏览器未提供可用的连接地址：请检查 Safari 的本地网络访问设置，或换一个 Wi-Fi 后重试。';
    return '双方连接信息已交换，但直连失败：请确认使用同一 Wi-Fi 或热点，允许本地网络访问，并避免访客网络或设备隔离。当前没有 TURN 中继。';
  }
  get diagnostics() {
    const sdp = this.pc?.localDescription?.sdp || '';
    const counts = ['host', 'srflx', 'relay'].map(type => `${type} ${(sdp.match(new RegExp(`^a=candidate:.* typ ${type}(?: |\\r?$)`, 'gm')) || []).length}`).join(' / ');
    // Counts and protocol states only: never copy SDP, network addresses or invitation secrets.
    return `配对阶段：${this.stage}\n配对服务：${this.brokerState}\n已收到对方描述：${this.pc?.remoteDescription ? '是' : '否'}\n本机候选地址数量：${counts}\n配对错误类型：${this.errorType || '无'}\n地址探测错误码：${this.iceErrorCode || '无'}`;
  }
  fail(message) {
    if (this.closed) return;
    this.rejectReady?.(Error(message)); this.rejectReady = null; this.resolveReady = null;
    this.close(); this.onStatus('failed'); this.onError?.(message);
  }
  get pc() { return this.rtc || this.connection?.peerConnection; }
  get channel() { return this.connection?.dataChannel; }
  get isOpen() { return !this.closed && this.connection?.open === true; }
  send(data) {
    if (!this.isOpen) throw Error('连接已断开，请重新配对');
    if (JSON.stringify(data).length > MAX_MESSAGE || this.channel?.bufferedAmount > MAX_MESSAGE * 2) throw Error('同步数据过大或连接繁忙');
    this.connection.send(data);
  }
  close() { this.closed = true; clearTimeout(this.timer); this.rejectReady?.(Error('连接已取消')); this.rejectReady = null; this.peer.destroy(); }
}
