/**
 * Fading Light — WebSocket Relay Server
 * Cloudflare Worker + Durable Object
 *
 * Features:
 * - Auto-matchmaking: GET /find-room → returns active room or creates new
 * - Room listing: GET /rooms → lists active rooms
 * - WebSocket: /ws?room=XXXX&name=PlayerName
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS headers for all responses
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Health check
    if (url.pathname === '/') {
      return new Response('Fading Light Relay Server OK', { status: 200, headers: corsHeaders });
    }

    // Find or create a room — auto-matchmaking
    if (url.pathname === '/find-room') {
      // Get list of active rooms from KV
      const roomList = await env.ROOMS_KV.get('active_rooms', 'json') || [];
      const now = Date.now();

      // Find a room that's not full and not stale (updated within 60s)
      const maxPlayers = 4;
      let bestRoom = null;
      const activeRooms = [];

      for (const room of roomList) {
        if (now - room.lastUpdate > 60000) continue; // stale
        activeRooms.push(room);
        if (room.players < maxPlayers && !bestRoom) {
          bestRoom = room;
        }
      }

      if (bestRoom) {
        return new Response(JSON.stringify({
          action: 'join',
          room: bestRoom.code,
          players: bestRoom.players,
        }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      }

      // No room available — create new
      const code = generateRoomCode();
      const newRoom = { code, players: 0, lastUpdate: now };
      activeRooms.push(newRoom);
      await env.ROOMS_KV.put('active_rooms', JSON.stringify(activeRooms), { expirationTtl: 300 });

      return new Response(JSON.stringify({
        action: 'create',
        room: code,
        players: 0,
      }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    }

    // List active rooms
    if (url.pathname === '/rooms') {
      const roomList = await env.ROOMS_KV.get('active_rooms', 'json') || [];
      const now = Date.now();
      const active = roomList.filter(r => now - r.lastUpdate < 60000);
      return new Response(JSON.stringify({ rooms: active }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // WebSocket endpoint
    if (url.pathname === '/ws') {
      const room = url.searchParams.get('room') || 'default';
      const name = url.searchParams.get('name') || 'Unknown';

      const roomId = env.GAME_ROOM.idFromName(room);
      const roomObj = env.GAME_ROOM.get(roomId);

      const newUrl = new URL(request.url);
      newUrl.searchParams.set('name', name);
      newUrl.searchParams.set('_room_code', room);
      return roomObj.fetch(new Request(newUrl, request));
    }

    return new Response('Not found', { status: 404, headers: corsHeaders });
  },
};

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

/**
 * GameRoom Durable Object
 */
export class GameRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.peers = new Map();
    this.nextPeerId = 1;
    this.hostId = null;
    this.roomCode = '';
  }

  async fetch(request) {
    const url = new URL(request.url);
    const name = url.searchParams.get('name') || 'Unknown';
    this.roomCode = url.searchParams.get('_room_code') || '';

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const peerId = String(this.nextPeerId++);

    server.accept();

    const isHost = this.peers.size === 0;
    this.peers.set(peerId, { ws: server, name, isHost });
    if (isHost) this.hostId = peerId;

    // Update room listing in KV
    this.updateRoomListing();

    server.send(JSON.stringify({
      type: 'welcome',
      peerId,
      isHost,
      peers: Array.from(this.peers.entries()).map(([id, p]) => ({
        id, name: p.name, isHost: p.isHost,
      })),
    }));

    this.broadcast({
      type: 'peer_joined',
      peerId, name, isHost,
      peerCount: this.peers.size,
    }, peerId);

    server.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data);
        msg.from = peerId;
        msg.fromName = name;
        this.broadcast(msg, peerId);
      } catch (e) {}
    });

    server.addEventListener('close', () => {
      this.peers.delete(peerId);

      if (peerId === this.hostId && this.peers.size > 0) {
        const newHostId = this.peers.keys().next().value;
        const newHost = this.peers.get(newHostId);
        if (newHost) {
          newHost.isHost = true;
          this.hostId = newHostId;
          newHost.ws.send(JSON.stringify({ type: 'you_are_host' }));
        }
      }

      this.broadcast({
        type: 'peer_left',
        peerId, name,
        peerCount: this.peers.size,
        newHostId: this.hostId,
      });

      this.updateRoomListing();
    });

    server.addEventListener('error', () => {
      this.peers.delete(peerId);
      this.updateRoomListing();
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  broadcast(msg, excludePeerId) {
    const data = JSON.stringify(msg);
    for (const [id, peer] of this.peers) {
      if (id === excludePeerId) continue;
      try { peer.ws.send(data); } catch (e) {}
    }
  }

  async updateRoomListing() {
    try {
      const roomList = await this.env.ROOMS_KV.get('active_rooms', 'json') || [];
      const now = Date.now();
      // Remove stale + update this room
      const active = roomList.filter(r => r.code !== this.roomCode && now - r.lastUpdate < 60000);
      if (this.peers.size > 0) {
        active.push({ code: this.roomCode, players: this.peers.size, lastUpdate: now });
      }
      await this.env.ROOMS_KV.put('active_rooms', JSON.stringify(active), { expirationTtl: 300 });
    } catch (e) {}
  }
}
