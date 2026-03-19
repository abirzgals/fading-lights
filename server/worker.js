/**
 * Fading Light — WebSocket Relay Server
 * Cloudflare Worker + Durable Object
 *
 * Deploy: wrangler deploy
 * Each game room is a Durable Object instance.
 * Players connect via WebSocket, messages are relayed to all peers in the room.
 *
 * Protocol:
 *   Connect: wss://your-worker.workers.dev/ws?room=XXXX&name=PlayerName
 *   Messages: JSON { type, ...data }
 *   Server adds 'from' field (sender peerId) to all relayed messages
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Health check
    if (url.pathname === '/') {
      return new Response('Fading Light Relay Server OK', { status: 200 });
    }

    // WebSocket endpoint
    if (url.pathname === '/ws') {
      const room = url.searchParams.get('room') || 'default';
      const name = url.searchParams.get('name') || 'Unknown';

      // Route to Durable Object by room code
      const roomId = env.GAME_ROOM.idFromName(room);
      const roomObj = env.GAME_ROOM.get(roomId);

      // Forward the request to the Durable Object
      const newUrl = new URL(request.url);
      newUrl.searchParams.set('name', name);
      return roomObj.fetch(new Request(newUrl, request));
    }

    // Room info
    if (url.pathname === '/rooms') {
      return new Response(JSON.stringify({ info: 'Room state is managed per Durable Object' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not found', { status: 404 });
  },
};

/**
 * GameRoom Durable Object — one instance per room code.
 * Manages WebSocket connections and relays messages.
 */
export class GameRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.peers = new Map(); // peerId -> { ws, name, isHost }
    this.nextPeerId = 1;
    this.hostId = null;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const name = url.searchParams.get('name') || 'Unknown';

    // Upgrade to WebSocket
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    const peerId = String(this.nextPeerId++);

    // Accept the WebSocket
    server.accept();

    // First player becomes host
    const isHost = this.peers.size === 0;
    this.peers.set(peerId, { ws: server, name, isHost });
    if (isHost) this.hostId = peerId;

    // Send welcome message
    server.send(JSON.stringify({
      type: 'welcome',
      peerId,
      isHost,
      peers: Array.from(this.peers.entries()).map(([id, p]) => ({
        id, name: p.name, isHost: p.isHost,
      })),
    }));

    // Notify all peers about new player
    this.broadcast({
      type: 'peer_joined',
      peerId,
      name,
      isHost,
      peerCount: this.peers.size,
    }, peerId);

    // Handle messages
    server.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data);
        msg.from = peerId;
        msg.fromName = name;

        // Relay to all other peers
        this.broadcast(msg, peerId);
      } catch (e) {
        // Invalid JSON — ignore
      }
    });

    // Handle disconnect
    server.addEventListener('close', () => {
      this.peers.delete(peerId);

      // If host left, elect new host
      if (peerId === this.hostId && this.peers.size > 0) {
        const newHostId = this.peers.keys().next().value;
        const newHost = this.peers.get(newHostId);
        if (newHost) {
          newHost.isHost = true;
          this.hostId = newHostId;
          // Notify new host
          newHost.ws.send(JSON.stringify({ type: 'you_are_host' }));
        }
      }

      // Notify remaining peers
      this.broadcast({
        type: 'peer_left',
        peerId,
        name,
        peerCount: this.peers.size,
        newHostId: this.hostId,
      });
    });

    server.addEventListener('error', () => {
      this.peers.delete(peerId);
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  broadcast(msg, excludePeerId) {
    const data = JSON.stringify(msg);
    for (const [id, peer] of this.peers) {
      if (id === excludePeerId) continue;
      try {
        peer.ws.send(data);
      } catch (e) {
        // Connection dead — will be cleaned up on close event
      }
    }
  }
}
