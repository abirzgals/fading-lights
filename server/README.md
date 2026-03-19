# Fading Light — Relay Server

WebSocket relay server on Cloudflare Workers + Durable Objects.

## Setup

1. Install Wrangler CLI:
```bash
npm install -g wrangler
```

2. Login to Cloudflare:
```bash
wrangler login
```

3. Deploy:
```bash
cd server
wrangler deploy
```

4. Your server will be at: `https://fading-light-relay.<your-subdomain>.workers.dev`

## How it works

- Each game room is a **Durable Object** instance (isolated, stateful)
- Players connect via WebSocket: `wss://your-worker.workers.dev/ws?room=XXXX&name=PlayerName`
- First player becomes **host** (authoritative for world state)
- All messages are **relayed** to other players in the room
- If host disconnects, next player becomes host automatically

## Protocol

Connect: `wss://host/ws?room=ABCD&name=Dev`

Server sends on connect:
```json
{ "type": "welcome", "peerId": "1", "isHost": true, "peers": [...] }
```

Client sends any JSON message — server adds `from` and relays to all peers:
```json
{ "type": "s", "x": 100, "y": 200, "dir": "south" }
```

## Message Types (planned)

| Type | Description |
|------|-------------|
| `s` | State sync (position, direction) |
| `a` | Attack action |
| `w` | World sync (host → clients) |
| `e` | Enemy list sync |
| `k` | Enemy damage |
| `d` | Enemy died |
| `r` | Resource harvested |
| `b` | Building placed |
| `c` | Chat message |

## Cost

Cloudflare Workers free tier:
- 100,000 requests/day
- Durable Objects: 1M requests/month free
- WebSocket messages: unlimited within request limits
