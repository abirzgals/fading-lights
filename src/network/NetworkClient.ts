/**
 * NetworkClient — WebSocket connection to relay server.
 * Handles room management, message sending/receiving.
 *
 * Architecture: Host/Client model
 * - Host: generates world, spawns enemies, authoritative for game state
 * - Client: receives world state, sends own position/actions
 */
export class NetworkClient {
  private ws: WebSocket | null = null;
  private serverUrl: string;
  private roomCode: string = '';
  private playerName: string = '';
  private _peerId: string = '';
  private _isHost = false;
  private _connected = false;
  private listeners: Map<string, Array<(msg: any) => void>> = new Map();
  private sendQueue: any[] = [];
  private reconnectTimer: any = null;

  // Throttle state sync
  private lastStateSend = 0;
  private readonly STATE_INTERVAL = 50; // ms between position updates (20fps)

  constructor(serverUrl: string) {
    this.serverUrl = serverUrl;
  }

  get peerId(): string { return this._peerId; }
  get isHost(): boolean { return this._isHost; }
  get connected(): boolean { return this._connected; }
  get room(): string { return this.roomCode; }

  /** Connect to a room */
  connect(roomCode: string, playerName: string): Promise<void> {
    this.roomCode = roomCode;
    this.playerName = playerName;

    return new Promise((resolve, reject) => {
      const url = `${this.serverUrl}/ws?room=${roomCode}&name=${encodeURIComponent(playerName)}`;
      this.ws = new WebSocket(url);

      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
        this.ws?.close();
      }, 10000);

      this.ws.onopen = () => {
        clearTimeout(timeout);
        this._connected = true;
        console.log(`[Net] Connected to room ${roomCode}`);
        // Flush queued messages
        for (const msg of this.sendQueue) this.ws!.send(JSON.stringify(msg));
        this.sendQueue = [];
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.handleMessage(msg);
          if (msg.type === 'welcome') resolve();
        } catch (e) { /* ignore invalid JSON */ }
      };

      this.ws.onclose = () => {
        this._connected = false;
        console.log('[Net] Disconnected');
        this.emit('disconnected', {});
        // Auto-reconnect after 3s
        if (this.roomCode) {
          this.reconnectTimer = setTimeout(() => {
            console.log('[Net] Attempting reconnect...');
            this.connect(this.roomCode, this.playerName).catch(() => {});
          }, 3000);
        }
      };

      this.ws.onerror = () => {
        clearTimeout(timeout);
        reject(new Error('WebSocket error'));
      };
    });
  }

  disconnect(): void {
    this.roomCode = '';
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
    this._connected = false;
  }

  /** Send a message to all peers */
  send(msg: any): void {
    if (this._connected && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      this.sendQueue.push(msg);
    }
  }

  /** Send throttled state update (position, direction) */
  sendState(data: { x: number; y: number; dir: string; anim: string }): void {
    const now = performance.now();
    if (now - this.lastStateSend < this.STATE_INTERVAL) return;
    this.lastStateSend = now;
    this.send({ type: 's', ...data });
  }

  /** Listen for a message type */
  on(type: string, callback: (msg: any) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type)!.push(callback);
  }

  /** Remove listener */
  off(type: string, callback: (msg: any) => void): void {
    const list = this.listeners.get(type);
    if (list) {
      const idx = list.indexOf(callback);
      if (idx >= 0) list.splice(idx, 1);
    }
  }

  private emit(type: string, msg: any): void {
    const list = this.listeners.get(type);
    if (list) for (const cb of list) cb(msg);
  }

  private handleMessage(msg: any): void {
    switch (msg.type) {
      case 'welcome':
        this._peerId = msg.peerId;
        this._isHost = msg.isHost;
        console.log(`[Net] Welcome! peerId=${msg.peerId} isHost=${msg.isHost} peers=${msg.peers?.length}`);
        this.emit('welcome', msg);
        break;

      case 'peer_joined':
        console.log(`[Net] ${msg.name} joined (${msg.peerCount} players)`);
        this.emit('peer_joined', msg);
        break;

      case 'peer_left':
        console.log(`[Net] Peer ${msg.name} left (${msg.peerCount} players)`);
        this.emit('peer_left', msg);
        break;

      case 'you_are_host':
        this._isHost = true;
        console.log('[Net] You are now HOST');
        this.emit('you_are_host', msg);
        break;

      default:
        // Relay message to listeners
        this.emit(msg.type, msg);
        break;
    }
  }

  /** Generate a random 4-char room code */
  static generateRoomCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
  }
}
