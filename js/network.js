// ============================================================
// NETWORK MODULE — WebRTC P2P multiplayer via PeerJS (no custom server!)
// Uses free PeerJS cloud signaling: 0.peerjs.com
// Host = first player (authoritative for enemies, world, bonfires)
// Star topology: all clients connect to host, host relays
// ============================================================

const network = {
    // Connection state
    peerId: null,
    playerName: '',
    playerColor: 0x557755,
    peer: null,              // PeerJS instance
    peers: new Map(),        // peerId -> { name, color, conn, state }
    connected: false,
    roomCode: '',            // 4-char room code
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
    onFuelAdded: null,

    // Config
    ROOM_PREFIX: 'fading-light-',
    SYNC_RATE: 100,
    HOST_SYNC_RATE: 200,

    // Available tshirt colors
    TSHIRT_COLORS: [
        0x557755, 0x775555, 0x555577, 0x777755, 0x775577,
        0x557777, 0x996633, 0xFF6644, 0x66AAFF, 0xFF66AA,
    ],

    generateRoomCode() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars
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

    // Host: create room and wait for players
    createRoom(name, color) {
        this.playerName = name;
        this.playerColor = color;
        this.isHost = true;
        this.worldSeed = this.generateSeed();
        this.roomCode = this.generateRoomCode();

        const hostId = this.ROOM_PREFIX + this.roomCode;

        return new Promise((resolve, reject) => {
            this.peer = new Peer(hostId);

            const timeout = setTimeout(() => {
                console.warn('PeerJS connection timeout, playing solo.');
                resolve(false);
            }, 8000);

            this.peer.on('open', (id) => {
                clearTimeout(timeout);
                this.peerId = id;
                this.connected = true;
                console.log('HOST room created. Code:', this.roomCode, 'Seed:', this.worldSeed);

                // Listen for incoming connections
                this.peer.on('connection', (conn) => {
                    this._handleIncomingConnection(conn);
                });

                resolve(true);
            });

            this.peer.on('error', (err) => {
                clearTimeout(timeout);
                if (err.type === 'unavailable-id') {
                    // Room code collision — regenerate
                    this.peer.destroy();
                    this.roomCode = this.generateRoomCode();
                    this.createRoom(name, color).then(resolve).catch(reject);
                    return;
                }
                console.warn('PeerJS error:', err.type, err.message);
                resolve(false);
            });
        });
    },

    // Host: create room with a specific code
    _createRoomWithCode(name, color, code) {
        this.playerName = name;
        this.playerColor = color;
        this.isHost = true;
        this.worldSeed = this.generateSeed();
        this.roomCode = code;

        const hostId = this.ROOM_PREFIX + code;

        return new Promise((resolve) => {
            this.peer = new Peer(hostId);

            const timeout = setTimeout(() => {
                console.warn('PeerJS connection timeout, playing solo.');
                resolve(false);
            }, 8000);

            this.peer.on('open', (id) => {
                clearTimeout(timeout);
                this.peerId = id;
                this.connected = true;
                console.log('HOST room created. Code:', code, 'Seed:', this.worldSeed);

                this.peer.on('connection', (conn) => {
                    this._handleIncomingConnection(conn);
                });

                resolve(true);
            });

            this.peer.on('error', (err) => {
                clearTimeout(timeout);
                console.warn('PeerJS error:', err.type, err.message);
                resolve(false);
            });
        });
    },

    // Client: join existing room by code
    joinRoom(name, color, roomCode) {
        this.playerName = name;
        this.playerColor = color;
        this.isHost = false;
        this.roomCode = roomCode.toUpperCase();

        const hostId = this.ROOM_PREFIX + this.roomCode;

        return new Promise((resolve, reject) => {
            this.peer = new Peer(); // random ID

            const timeout = setTimeout(() => {
                console.warn('PeerJS connection timeout, playing solo.');
                this.isHost = true;
                this.worldSeed = this.generateSeed();
                resolve(false);
            }, 8000);

            this.peer.on('open', (id) => {
                this.peerId = id;

                // Connect to host
                const conn = this.peer.connect(hostId, {
                    metadata: { name, color },
                    reliable: true,
                });

                conn.on('open', () => {
                    clearTimeout(timeout);
                    this.connected = true;

                    // Send our intro
                    conn.send(JSON.stringify({
                        t: 'intro',
                        name: this.playerName,
                        color: this.playerColor,
                    }));

                    // Set up host connection
                    const peerData = {
                        name: 'Host',
                        color: 0x557755,
                        conn,
                        state: null,
                        lastUpdate: 0,
                        isHost: true,
                    };
                    this.peers.set(hostId, peerData);
                    this._setupConnection(conn, hostId);

                    console.log('Connected to host room:', this.roomCode);
                    resolve(true);
                });

                conn.on('error', (err) => {
                    clearTimeout(timeout);
                    console.warn('Connection to host failed:', err);
                    this.isHost = true;
                    this.worldSeed = this.generateSeed();
                    resolve(false);
                });
            });

            this.peer.on('error', (err) => {
                clearTimeout(timeout);
                console.warn('PeerJS error:', err.type, err.message);
                this.isHost = true;
                this.worldSeed = this.generateSeed();
                resolve(false);
            });
        });
    },

    // Backwards-compatible connect method (used by game.js)
    connect(name, color, roomId) {
        // If already connected (room was set up in menu), just resolve
        if (this.connected) {
            return Promise.resolve(true);
        }
        // Fallback: create a solo game
        this.isHost = true;
        this.worldSeed = this.generateSeed();
        return Promise.resolve(false);
    },

    _handleIncomingConnection(conn) {
        const peerId = conn.peer;
        const meta = conn.metadata || {};

        conn.on('open', () => {
            const peerData = {
                name: meta.name || 'Player',
                color: meta.color || this.getRandomColor(),
                conn,
                state: null,
                lastUpdate: 0,
            };
            this.peers.set(peerId, peerData);
            this._setupConnection(conn, peerId);

            // Send world state to new peer
            conn.send(JSON.stringify({
                t: 'w',
                seed: this.worldSeed,
                hostName: this.playerName,
                hostColor: this.playerColor,
            }));

            // Tell new peer about existing peers
            const peerList = [];
            for (const [id, p] of this.peers) {
                if (id !== peerId) {
                    peerList.push({ peerId: id, name: p.name, color: p.color });
                }
            }
            if (peerList.length > 0) {
                conn.send(JSON.stringify({ t: 'peer_list', peers: peerList }));
            }

            // Tell existing peers about new peer
            for (const [id, p] of this.peers) {
                if (id !== peerId && p.conn) {
                    try {
                        p.conn.send(JSON.stringify({
                            t: 'new_peer',
                            peerId,
                            name: peerData.name,
                            color: peerData.color,
                        }));
                    } catch {}
                }
            }

            // Notify game
            if (this.onPeerJoined) this.onPeerJoined(peerId, peerData.name, peerData.color);
            console.log(`${peerData.name} joined the game`);

            // Send full world state if getter registered
            if (this._getWorldState) {
                const worldState = this._getWorldState();
                conn.send(JSON.stringify({ t: 'w', ...worldState }));
            }
        });
    },

    _setupConnection(conn, peerId) {
        conn.on('data', (raw) => {
            const msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
            this._handlePeerMessage(peerId, msg);
        });

        conn.on('close', () => {
            this._removePeer(peerId);
        });

        conn.on('error', () => {
            this._removePeer(peerId);
        });
    },

    _handlePeerMessage(peerId, msg) {
        const peer = this.peers.get(peerId);
        if (!peer) return;

        switch (msg.t) {
            case 'intro':
                // Client sent their info
                peer.name = msg.name;
                peer.color = msg.color;
                break;

            case 's': // state update (position, facing, moving)
                peer.state = msg;
                peer.lastUpdate = Date.now();
                if (this.onPeerState) this.onPeerState(peerId, msg);
                // Host relays position to other clients
                if (this.isHost) {
                    const relay = JSON.stringify({ ...msg, from: peerId });
                    for (const [id, p] of this.peers) {
                        if (id !== peerId && p.conn && p.conn.open) {
                            try { p.conn.send(relay); } catch {}
                        }
                    }
                }
                break;

            case 's_relay': // relayed state from host (for client-to-client via host)
                if (this.onPeerState) this.onPeerState(msg.from, msg);
                break;

            case 'a': // attack
                if (this.onPeerAttack) this.onPeerAttack(peerId, msg);
                // Host relays attacks to other clients
                if (this.isHost) {
                    const relay = JSON.stringify({ ...msg, from: peerId });
                    for (const [id, p] of this.peers) {
                        if (id !== peerId && p.conn && p.conn.open) {
                            try { p.conn.send(relay); } catch {}
                        }
                    }
                }
                break;

            case 'w': // world sync from host
                this.worldSeed = msg.seed;
                // Update host peer info
                if (msg.hostName && peer.isHost) {
                    peer.name = msg.hostName;
                    peer.color = msg.hostColor || peer.color;
                    if (this.onPeerJoined) this.onPeerJoined(peerId, peer.name, peer.color);
                }
                if (this.onWorldSync) this.onWorldSync(msg);
                break;

            case 'e': // enemy sync from host
                if (this.onEnemySync) this.onEnemySync(msg.enemies);
                break;

            case 'r': // resource event from host
                if (this.onResourceEvent) this.onResourceEvent(msg);
                break;

            case 'b': // bonfire sync from host
                if (this.onBonfireSync) this.onBonfireSync(msg.bonfires);
                break;

            case 'k': // enemy damage (from client to host)
                if (this.isHost && this.onEnemyDamage) {
                    this.onEnemyDamage(msg.enemyId, msg.damage, peerId);
                }
                break;

            case 'd': // enemy died (host broadcasts)
                if (this.onEnemyDied) this.onEnemyDied(msg.enemyId);
                break;

            case 'f': // fuel added to bonfire
                if (this.onFuelAdded) this.onFuelAdded(msg.bonfireIdx, msg.amount);
                break;

            case 'new_peer': // host tells us about another peer
                if (this.onPeerJoined) this.onPeerJoined(msg.peerId, msg.name, msg.color);
                // Track them for state relay
                if (!this.peers.has(msg.peerId)) {
                    this.peers.set(msg.peerId, {
                        name: msg.name,
                        color: msg.color,
                        conn: null, // no direct connection, relayed through host
                        state: null,
                        lastUpdate: 0,
                    });
                }
                break;

            case 'peer_list': // host sends list of existing peers
                for (const p of msg.peers) {
                    if (!this.peers.has(p.peerId)) {
                        this.peers.set(p.peerId, {
                            name: p.name,
                            color: p.color,
                            conn: null,
                            state: null,
                            lastUpdate: 0,
                        });
                        if (this.onPeerJoined) this.onPeerJoined(p.peerId, p.name, p.color);
                    }
                }
                break;

            case 'peer_left': // host tells us a peer left
                this._removePeer(msg.peerId);
                break;
        }

        // Handle relayed state messages (host adds 'from' field)
        if (msg.from && msg.from !== peerId) {
            const fromPeer = this.peers.get(msg.from);
            if (fromPeer) {
                if (msg.t === 's') {
                    fromPeer.state = msg;
                    fromPeer.lastUpdate = Date.now();
                    if (this.onPeerState) this.onPeerState(msg.from, msg);
                } else if (msg.t === 'a') {
                    if (this.onPeerAttack) this.onPeerAttack(msg.from, msg);
                }
            }
        }
    },

    _removePeer(peerId) {
        const peer = this.peers.get(peerId);
        if (!peer) return;
        if (peer.conn) try { peer.conn.close(); } catch {}
        this.peers.delete(peerId);
        if (this.onPeerLeft) this.onPeerLeft(peerId);
        console.log(`Peer ${peer.name || peerId} disconnected`);

        // Host: notify other peers
        if (this.isHost) {
            for (const [id, p] of this.peers) {
                if (p.conn && p.conn.open) {
                    try {
                        p.conn.send(JSON.stringify({ t: 'peer_left', peerId }));
                    } catch {}
                }
            }
        }

        // Host migration: if host left and we're client
        if (!this.isHost && peer.isHost) {
            this.isHost = true;
            console.log('Host left — you are now the HOST');
        }
    },

    // Send to all peers (or to host who relays)
    broadcastState(state) {
        const msg = JSON.stringify({ t: 's', ...state });
        for (const [, peer] of this.peers) {
            if (peer.conn && peer.conn.open) {
                try { peer.conn.send(msg); } catch {}
            }
        }
    },

    broadcastAttack(data) {
        const msg = JSON.stringify({ t: 'a', ...data });
        for (const [, peer] of this.peers) {
            if (peer.conn && peer.conn.open) {
                try { peer.conn.send(msg); } catch {}
            }
        }
    },

    broadcastReliable(data) {
        const msg = JSON.stringify(data);
        for (const [, peer] of this.peers) {
            if (peer.conn && peer.conn.open) {
                try { peer.conn.send(msg); } catch {}
            }
        }
    },

    _sendReliable(peerId, data) {
        const peer = this.peers.get(peerId);
        if (peer && peer.conn && peer.conn.open) {
            try { peer.conn.send(JSON.stringify(data)); } catch {}
        }
    },

    broadcastEnemies(enemies) {
        if (!this.isHost) return;
        this.broadcastReliable({ t: 'e', enemies });
    },

    broadcastBonfires(bonfires) {
        if (!this.isHost) return;
        this.broadcastReliable({ t: 'b', bonfires });
    },

    broadcastResourceEvent(event) {
        if (!this.isHost) return;
        this.broadcastReliable({ t: 'r', ...event });
    },

    sendEnemyDamage(enemyId, damage) {
        if (this.isHost) return;
        this.broadcastReliable({ t: 'k', enemyId, damage });
    },

    broadcastEnemyDeath(enemyId) {
        if (!this.isHost) return;
        this.broadcastReliable({ t: 'd', enemyId });
    },

    setWorldStateGetter(fn) {
        this._getWorldState = fn;
    },

    disconnect() {
        for (const [id] of this.peers) {
            this._removePeer(id);
        }
        this.peers.clear();
        if (this.peer) {
            this.peer.destroy();
            this.peer = null;
        }
        this.connected = false;
    },

    get peerCount() {
        let count = 0;
        for (const [, peer] of this.peers) {
            if (peer.conn && peer.conn.open) count++;
        }
        return count;
    },
};
