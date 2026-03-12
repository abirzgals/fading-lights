// ============================================================
// NETWORK MODULE — WebSocket relay multiplayer (no WebRTC!)
// Connects to centralized relay server for 100% internet reliability
// Host = first player in room (authoritative for enemies, world)
// Star topology: server relays all messages
// ============================================================

const network = {
    // Connection state
    peerId: null,
    playerName: '',
    playerColor: 0x557755,
    ws: null,                // WebSocket connection
    peers: new Map(),        // peerId -> { name, color, state, lastUpdate, isHost }
    connected: false,
    roomCode: '',
    isHost: false,
    worldSeed: 0,

    // Callbacks set by game scene
    onPeerJoined: null,
    onPeerLeft: null,
    onPeerState: null,
    onPeerAttack: null,
    onWorldSync: null,
    onEnemySync: null,
    onResourceEvent: null,
    onBonfireSync: null,
    onEnemyDamage: null,
    onEnemyDied: null,
    onEnemySpawn: null,
    onFuelAdded: null,
    onDropPickup: null,
    onChat: null,
    onBuildingPlaced: null,
    onSecondCampLit: null,
    onRainSync: null,

    // Config
    SYNC_RATE: 100,
    HOST_SYNC_RATE: 200,

    // Relay server URL — change this after deploying to Render
    RELAY_URL: (() => {
        // Auto-detect: use localhost in dev, deployed URL in production
        if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
            return 'ws://localhost:9090';
        }
        // TODO: Replace with your Render deployment URL
        return 'wss://fading-light-relay.onrender.com';
    })(),

    // Available tshirt colors
    TSHIRT_COLORS: [
        0x557755, 0x775555, 0x555577, 0x777755, 0x775577,
        0x557777, 0x996633, 0xFF6644, 0x66AAFF, 0xFF66AA,
    ],

    generateRoomCode() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let code = '';
        for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
        return code;
    },

    getRandomColor() {
        return this.TSHIRT_COLORS[Math.floor(Math.random() * this.TSHIRT_COLORS.length)];
    },

    generateSeed() {
        return Math.floor(Math.random() * 2147483647);
    },

    seededRandom(seed) {
        let s = seed;
        return function() {
            s |= 0; s = s + 0x6D2B79F5 | 0;
            let t = Math.imul(s ^ s >>> 15, 1 | s);
            t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    },

    loadName() {
        return localStorage.getItem('fading_light_name') || '';
    },

    saveName(name) {
        localStorage.setItem('fading_light_name', name);
        this.playerName = name;
    },

    // Callback for wakeup progress: onWakeProgress(secondsElapsed, maxSeconds, attempt)
    // Set by menu before calling connect methods
    onWakeProgress: null,

    // Max time to wait for server wakeup (Render free tier: ~50s)
    WAKE_TIMEOUT: 50,
    // Single attempt timeout
    ATTEMPT_TIMEOUT: 6000,

    // Try a single WebSocket connection attempt
    _tryConnect(roomCode) {
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                if (this.ws) { this.ws.close(); this.ws = null; }
                resolve(false);
            }, this.ATTEMPT_TIMEOUT);

            try {
                this.ws = new WebSocket(this.RELAY_URL);
            } catch (e) {
                clearTimeout(timeout);
                resolve(false);
                return;
            }

            this.ws.onopen = () => {
                this.ws.send(JSON.stringify({
                    type: 'join',
                    roomCode: roomCode,
                    name: this.playerName,
                    color: this.playerColor,
                }));
            };

            this.ws.onmessage = (event) => {
                let msg;
                try { msg = JSON.parse(event.data); } catch { return; }

                if (msg.type === 'joined') {
                    clearTimeout(timeout);
                    this.peerId = msg.peerId;
                    this.isHost = msg.isHost;
                    this.roomCode = msg.roomCode;
                    this.connected = true;

                    if (this.isHost) {
                        this.worldSeed = this.generateSeed();
                    }

                    for (const p of msg.peers) {
                        this.peers.set(p.peerId, {
                            name: p.name,
                            color: p.color,
                            state: null,
                            lastUpdate: 0,
                            isHost: p.isHost,
                        });
                    }

                    console.log(`Connected to room ${msg.roomCode} as ${msg.isHost ? 'HOST' : 'CLIENT'}. Peers: ${msg.peers.length}`);
                    resolve(true);
                    return;
                }

                this._handleServerMessage(msg);
            };

            this.ws.onclose = () => {
                clearTimeout(timeout);
                if (!this.connected) { resolve(false); return; }
                console.log('WebSocket disconnected');
                this.connected = false;
            };

            this.ws.onerror = () => {
                clearTimeout(timeout);
                if (this.ws) { this.ws.close(); this.ws = null; }
                resolve(false);
            };
        });
    },

    // Connect with auto-retry and wakeup timer
    async _connectWS(roomCode) {
        // First attempt — fast path (server is already awake)
        const ok = await this._tryConnect(roomCode);
        if (ok) return true;

        // Server likely sleeping — start retry loop with countdown
        console.log('Server may be waking up, retrying...');
        const startTime = Date.now();
        let attempt = 1;

        // Start countdown timer (updates every second)
        let timerInterval = null;
        if (this.onWakeProgress) {
            this.onWakeProgress(0, this.WAKE_TIMEOUT, attempt);
            timerInterval = setInterval(() => {
                const elapsed = Math.floor((Date.now() - startTime) / 1000);
                if (this.onWakeProgress) this.onWakeProgress(elapsed, this.WAKE_TIMEOUT, attempt);
            }, 1000);
        }

        while ((Date.now() - startTime) < this.WAKE_TIMEOUT * 1000) {
            attempt++;
            // Wait 3 seconds between retries
            await new Promise(r => setTimeout(r, 3000));
            if ((Date.now() - startTime) >= this.WAKE_TIMEOUT * 1000) break;

            const result = await this._tryConnect(roomCode);
            if (result) {
                if (timerInterval) clearInterval(timerInterval);
                if (this.onWakeProgress) this.onWakeProgress(-1, this.WAKE_TIMEOUT, attempt); // -1 = success
                return true;
            }
        }

        if (timerInterval) clearInterval(timerInterval);
        if (this.onWakeProgress) this.onWakeProgress(this.WAKE_TIMEOUT, this.WAKE_TIMEOUT, attempt); // timed out
        return false;
    },

    _handleServerMessage(msg) {
        switch (msg.type) {
            case 'peer_joined': {
                const { peerId, name, color } = msg;
                this.peers.set(peerId, {
                    name,
                    color,
                    state: null,
                    lastUpdate: 0,
                    isHost: false,
                });
                if (this.onPeerJoined) this.onPeerJoined(peerId, name, color);
                console.log(`${name} joined the game`);

                // Host: send world state to new peer
                if (this.isHost && this._getWorldState) {
                    const worldState = this._getWorldState();
                    this._sendTo(peerId, {
                        t: 'w',
                        seed: this.worldSeed,
                        hostName: this.playerName,
                        hostColor: this.playerColor,
                        ...worldState,
                    });
                }
                break;
            }

            case 'peer_left': {
                this._removePeer(msg.peerId);
                break;
            }

            case 'host_changed': {
                const newHostId = msg.newHostId;
                if (newHostId === this.peerId) {
                    this.isHost = true;
                    console.log('You are now the HOST');
                }
                // Update peer host status
                for (const [id, peer] of this.peers) {
                    peer.isHost = (id === newHostId);
                }
                break;
            }

            case 'game': {
                // Game message relayed from another peer
                this._handleGameMessage(msg.from, msg.data);
                break;
            }
        }
    },

    _handleGameMessage(fromPeerId, msg) {
        const peer = this.peers.get(fromPeerId);
        if (!peer) return;

        switch (msg.t) {
            case 's': // state update (position, facing)
                peer.state = msg;
                peer.lastUpdate = Date.now();
                if (this.onPeerState) this.onPeerState(fromPeerId, msg);
                break;

            case 'a': // attack
                if (this.onPeerAttack) this.onPeerAttack(fromPeerId, msg);
                break;

            case 'w': // world sync from host
                this.worldSeed = msg.seed;
                if (msg.hostName && peer.isHost) {
                    peer.name = msg.hostName;
                    peer.color = msg.hostColor || peer.color;
                    if (this.onPeerJoined) this.onPeerJoined(fromPeerId, peer.name, peer.color);
                }
                if (this.onWorldSync) this.onWorldSync(msg);
                break;

            case 'e': // enemy sync from host
                if (this.onEnemySync) this.onEnemySync(msg.enemies);
                break;

            case 'r': // resource event
                if (this.onResourceEvent) this.onResourceEvent(msg);
                break;

            case 'rd': // resource destroyed
                if (this.onResourceEvent) this.onResourceEvent(msg);
                break;

            case 'es': // enemy spawn from host
                if (!this.isHost && this.onEnemySpawn) this.onEnemySpawn(msg);
                break;

            case 'b': // bonfire sync from host
                if (this.onBonfireSync) this.onBonfireSync(msg.bonfires);
                break;

            case 'k': // enemy damage (from client to host)
                if (this.isHost && this.onEnemyDamage) {
                    this.onEnemyDamage(msg.enemyId, msg.damage, fromPeerId);
                }
                break;

            case 'd': // enemy died (host broadcasts)
                if (this.onEnemyDied) this.onEnemyDied(msg.enemyId);
                break;

            case 'dp': // drop picked up
                if (this.onDropPickup) this.onDropPickup(msg.x, msg.y, msg.res);
                break;

            case 'f': // fuel added to bonfire
                if (this.onFuelAdded) this.onFuelAdded(msg.bonfireIdx, msg.amount);
                break;

            case 'bl': // building placed
                if (this.onBuildingPlaced) this.onBuildingPlaced(msg.bType, msg.x, msg.y);
                break;

            case 'sc': // second camp lit
                if (this.onSecondCampLit) this.onSecondCampLit(msg.x, msg.y);
                break;

            case 'rn': // rain sync
                if (this.onRainSync) this.onRainSync(msg.active, msg.dur);
                break;

            case 'c': // chat message
                if (this.onChat) this.onChat(fromPeerId, msg.text);
                break;
        }
    },

    // Host: create room and wait for players
    createRoom(name, color) {
        this.playerName = name;
        this.playerColor = color;
        this.roomCode = this.generateRoomCode();
        return this._connectWS(this.roomCode);
    },

    // Host: create room with specific code
    _createRoomWithCode(name, color, code) {
        this.playerName = name;
        this.playerColor = color;
        this.roomCode = code;
        return this._connectWS(code);
    },

    // Client: join existing room
    joinRoom(name, color, roomCode) {
        this.playerName = name;
        this.playerColor = color;
        this.roomCode = roomCode.toUpperCase();
        return this._connectWS(this.roomCode);
    },

    // Backwards-compatible connect (used by game.js _setupNetwork)
    connect(name, color, roomId) {
        if (this.connected) return Promise.resolve(true);
        // Fallback: solo game
        this.isHost = true;
        this.worldSeed = this.generateSeed();
        return Promise.resolve(false);
    },

    _removePeer(peerId) {
        const peer = this.peers.get(peerId);
        if (!peer) return;
        this.peers.delete(peerId);
        if (this.onPeerLeft) this.onPeerLeft(peerId);
        console.log(`Peer ${peer.name || peerId} disconnected`);
    },

    // Send game message to ALL other peers (via relay server)
    _broadcast(data) {
        if (!this.ws || this.ws.readyState !== 1) return;
        this.ws.send(JSON.stringify({ type: 'relay', data }));
    },

    // Send game message to ONE specific peer (via relay server)
    _sendTo(targetId, data) {
        if (!this.ws || this.ws.readyState !== 1) return;
        this.ws.send(JSON.stringify({ type: 'relay_to', targetId, data }));
    },

    // Public API (same interface as before)
    broadcastState(state) {
        this._broadcast({ t: 's', ...state });
    },

    broadcastAttack(data) {
        this._broadcast({ t: 'a', ...data });
    },

    broadcastReliable(data) {
        this._broadcast(data);
    },

    broadcastEnemies(enemies) {
        if (!this.isHost) return;
        this._broadcast({ t: 'e', enemies });
    },

    broadcastBonfires(bonfires) {
        if (!this.isHost) return;
        this._broadcast({ t: 'b', bonfires });
    },

    broadcastResourceEvent(event) {
        if (!this.isHost) return;
        this._broadcast({ t: 'r', ...event });
    },

    sendEnemyDamage(enemyId, damage) {
        if (this.isHost) return;
        this._broadcast({ t: 'k', enemyId, damage });
    },

    broadcastEnemyDeath(enemyId) {
        if (!this.isHost) return;
        this._broadcast({ t: 'd', enemyId });
    },

    setWorldStateGetter(fn) {
        this._getWorldState = fn;
    },

    disconnect() {
        this.peers.clear();
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.connected = false;
    },

    get peerCount() {
        return this.peers.size;
    },
};
