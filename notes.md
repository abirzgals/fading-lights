# Fading Lights — Project Notes

---

## 2026-03-19 — v2.6.81: GitHub Pages deployment — Vite build pipeline + fullscreen button

### Summary
Wired up a proper Vite build pipeline for GitHub Pages deployment and added a fullscreen toggle button to the game toolbar. The game is now published at https://abirzgals.github.io/fading-lights/.

### Changes Made
- `vite.config.ts`: Set `base` to `/fading-lights/` so all asset paths resolve correctly under the GitHub Pages subdirectory.
- `.github/workflows/pages.yml`: Replaced the raw file upload with a full build step — installs dependencies with `npm ci`, runs `npx vite build`, and deploys the `dist/` directory instead of the repo root. Also enabled `cancel-in-progress` for the concurrency group to avoid stale deployments.
- `src/scenes/GameScene.ts`: Added a `[ ]` fullscreen button to the bottom toolbar. Clicking it calls `document.documentElement.requestFullscreen()` or `document.exitFullscreen()` depending on current state.

### Rationale
Without a base path, all Vite-bundled assets would 404 under a subdirectory deployment. The CI pipeline previously uploaded raw source files, which would not work with TypeScript sources and ES module imports that require bundling. The fullscreen button improves the player experience on desktop, especially for maze gameplay.

### Next Steps
- Verify the Pages deployment completes successfully and the game loads at the published URL.
- Consider adding a fullscreen icon in place of the `[ ]` text label.

---

## 2026-03-19 — v2.6.80: Auto-matchmaking — server KV rooms + client room discovery

### Summary
Server-side auto-matchmaking via Cloudflare Workers KV: the worker tracks active rooms with player counts and timestamps, expiring stale rooms after 60 seconds. The client now discovers or creates a room automatically on startup, updates the URL with the room code for easy sharing, and falls back to solo play if matchmaking fails.

### Changes Made
- `server/worker.js`:
  - `GET /find-room` — returns an active room that has space, or creates a new one if none exist.
  - `GET /rooms` — lists all active rooms with player count and age metadata.
  - ROOMS_KV binding used to persist room state (player count + last-updated timestamp).
  - Rooms expire automatically after 60 seconds of inactivity.
  - CORS headers added to all responses to support cross-origin fetch from the client.
  - Room listing refreshed on every player join and leave event.
- `server/wrangler.toml`:
  - Added `ROOMS_KV` KV namespace binding for the worker.
- `src/scenes/GameScene.ts`:
  - On scene start: if `?room=XXXX` is present in the URL, join that room directly.
  - Otherwise, fetch `/find-room` and join the returned room (existing or newly created).
  - URL updated with the room code after joining so the session is shareable.
  - Graceful fallback to solo play if matchmaking request fails.

### Rationale
With the networking foundation and full state sync in place (v2.6.78–79), the missing piece was automatic room discovery. Players previously had to manually share room codes. This release wires the Cloudflare KV store as a lightweight matchmaking layer: the server tracks which rooms are alive and how many players are in them, the client picks one up (or creates a fresh one) without any manual input, and the URL becomes the share link. The 60-second expiry keeps the KV store clean without requiring explicit room deletion.

### Next Steps
- Cap rooms at a maximum player count server-side.
- Surface active room count in a lobby or menu screen.
- Add host migration if the host disconnects.

---

## 2026-03-19 — v2.6.79: Full multiplayer synchronization

### Summary
Complete rewrite of NetworkSync.ts to deliver authoritative host-to-client state sync across all game systems: player positions, enemies, resources, bonfires, resource pools, and buildings. GameScene wired up to drive all sync callbacks and enforce host-only enemy spawning. Multiplayer spec added under tests/.

### Changes Made
- `src/network/NetworkSync.ts` (rewrite):
  - Player position sync with 50ms throttle and smooth interpolation on the receiving end.
  - Enemy batch sync from host to clients every 200ms — positions, HP, and dying state.
  - Enemy spawn broadcast (host to clients) with `netId` for cross-network tracking.
  - Enemy kill broadcast — clients call `playDeath` on the matching enemy.
  - Resource destruction broadcast — clients find and destroy the nearest matching resource.
  - Bonfire state sync (host to clients, 1s cadence) — fuel, campLevel, campFuelAdded.
  - Resource pool sync (host to clients, 1s cadence) — wood, stone, metal, gold.
  - Building placement broadcast.
  - Typed callbacks for all events so GameScene can react cleanly.
  - Remote player rendering: sprites with name labels, smooth interpolation.
  - `registerEnemy()` assigns a `netId` for stable cross-network identity.
- `src/scenes/GameScene.ts` (modified):
  - Enemy spawning now gated to host only; host assigns `netId` and broadcasts.
  - Starter enemies each receive a `netId` on scene init.
  - Enemy death broadcasts the `netId` so clients know which enemy to remove.
  - Network init wires up all sync callbacks (enemySpawned, enemyKilled, resource, bonfire, building).
  - `updateNetwork` sends game state (fuel + resources) periodically.
  - Clients receive bonfire and resource pool state from host, overriding local values.
- `tests/multiplayer.spec.ts` (new): Playwright spec covering multiplayer scenarios.

### Rationale
The initial networking foundation (v2.6.78) established connections and basic player-position sync. This release extends the authority model to cover every stateful system in the game: enemies (spawn, AI, death), resources (wood, stone, metal, gold pools and destructible objects), bonfires, and buildings. All state changes originate on the host and flow through typed NetworkSync callbacks, keeping clients as pure renderers with no state ownership. The `netId` scheme gives every enemy a stable identity that survives across the network boundary, which is the key prerequisite for reliable kill and death sync.

### Architecture
- Host: generates the world, spawns enemies, runs AI, broadcasts all state.
- Client: renders remote players, receives and applies enemy/resource/building/bonfire updates.
- State flow: GameScene event → NetworkSync.send* method → relay → NetworkSync callback → GameScene handler.

### Next Steps
- Latency compensation / lag-tolerant enemy interpolation on clients.
- Conflict resolution if client and host disagree on resource counts.
- Disconnect/reconnect handling that restores full state from host snapshot.

---

## 2026-03-19 — v2.6.78: Multiplayer networking foundation

### Summary
Added a WebSocket-based multiplayer networking layer. Two new modules handle client communication and game state synchronisation. GameScene gains Host/Join UI, a room-code HUD overlay, and hooks throughout the update loop to broadcast and receive player positions, enemy state, and world events.

### Changes Made
- `src/network/NetworkClient.ts` (new): WebSocket client wrapping the relay server. Handles room creation/joining, auto-reconnect on disconnect, throttled outbound state sync at 20 fps, and an event listener system for routing inbound messages by type.
- `src/network/NetworkSync.ts` (new): High-level game sync logic. Renders remote players as sprites with name labels above them, interpolates received positions for smooth movement, lets the host broadcast authoritative enemy positions, and relays resource destruction and building events to peers.
- `src/scenes/GameScene.ts` (modified):
  - Auto-connects to a room when `?room=XXXX` is present in the URL.
  - Host and Join buttons added at bottom-left alongside Debug/AI checkboxes.
  - HUD displays room code, host/client role, and live player count.
  - `onPreUpdate` loop sends local player state and, when host, enemy positions.
  - Resource destruction events are broadcast over the network.
  - `onDeactivate` cleanly disconnects the network client.

### Rationale
First-pass networking infrastructure to support co-op play. The host-authoritative model keeps enemy and world state consistent without a dedicated server. Throttled sync at 20 fps keeps bandwidth low while position interpolation hides latency on the client side. The room-code flow (Host button generates a code; Join input accepts one; `?room=` URL shares it directly) lets two players connect with minimal friction.

### How to Use
1. Player 1 clicks "Host" — a four-letter room code appears in the HUD.
2. Player 2 types the code into the Join input and clicks "Join", or opens the shared `?room=ABCD` URL.
3. Both players see each other's characters with smooth position interpolation.
4. The host is authoritative for enemy movement and world events.

### Next Steps
- Add latency display to the HUD.
- Sync player health and death events.
- Persist room membership across page refreshes.
- Add a spectator/reconnect flow for mid-game joins.

---

## 2026-03-19 — v2.6.77: Controls overhaul — AI checkbox, mouse, mobile touch

### Summary
Replaced the backtick-key AI toggle with a proper AI checkbox in the UI, sitting next to the existing Debug checkbox at the bottom-left. Added full mouse input support (left click = attack, right click = interact, context menu suppressed on canvas). Standardised keyboard layout to WASD + arrow keys for movement, Space for attack, E for interact. Added auto-detected mobile touch controls: a virtual joystick at the bottom-left for movement and an ATK button at the bottom-right for attacking, both only rendered on genuine touch devices.

### Changes Made
- `src/scenes/GameScene.ts`:
  - Added `mouseLeftPressed` / `mouseRightPressed` state fields.
  - Added `mobileJoystick`, `mobileAttackPressed`, and `mobileControlsEl` state fields.
  - `createDebugCheckbox()` refactored to render both Debug and AI checkboxes in a shared flex wrapper; AI checkbox drives `this.botEnabled` directly.
  - New `setupMouseControls(engine)` — attaches `mousedown` and `contextmenu` listeners to the canvas.
  - New `setupMobileControls()` — builds joystick + ATK button DOM, attaches touch event listeners, clamps joystick vector to unit length, and animates knob position.
  - Human input branch in `onPreUpdate` extended to consume mouse and mobile inputs alongside keyboard.
  - `onDeactivate()` now removes `mobileControlsEl` on scene teardown.

### Rationale
The backtick key was not discoverable and unavailable on many keyboard layouts. A visible checkbox matches the existing Debug toggle pattern and makes AI mode obvious to anyone playtesting. Mouse support is the minimum expected interaction on desktop. Mobile touch controls were already partially designed; this commit wires them up fully with visual feedback on the joystick knob.

### Next Steps
- Persist AI and Debug checkbox states across scene restarts (localStorage).
- Add a visual indicator on the ATK button when it fires (brief colour flash).
- Consider a dedicated interact button for mobile (for bonfire feeding).

---

## 2026-03-19 — v2.6.76: Configure Cloudflare Worker deployment

### Summary
Updated `server/wrangler.toml` with two changes required to successfully deploy on the Cloudflare free plan: added `account_id` and changed `new_classes` to `new_sqlite_classes` under the migrations block. The worker is now live at https://fading-light-relay.arturs-birzgals.workers.dev.

### Changes Made
- `server/wrangler.toml`: Added `account_id = "d48bc9e5446343f511168879211b6392"`. Changed `new_classes` to `new_sqlite_classes` under `[[migrations]]` — Cloudflare free plan requires SQLite-backed Durable Objects.

### Rationale
The `new_classes` key causes a deploy error on Cloudflare free accounts; `new_sqlite_classes` is the correct key for free-tier Durable Objects which use SQLite storage. The `account_id` field is required by Wrangler when deploying non-interactively.

### Next Steps
- Wire client-side multiplayer code to connect to `wss://fading-light-relay.arturs-birzgals.workers.dev`.
- Implement reconnect logic on the client for dropped WebSocket connections.
- Add room code generation UI to the game lobby/menu.

---

## 2026-03-19 — feat: Cloudflare Workers multiplayer relay server

### Summary
Added a new `server/` directory containing a complete WebSocket relay server built on Cloudflare Workers and Durable Objects. Each game room runs as an isolated Durable Object instance. Players connect via `?room=XXXX` query parameter; the first player to connect becomes the authoritative host. When the host disconnects, the server automatically elects the next connected player as the new host. All relayed messages have a `from` field (sender peerId) injected by the server.

### Changes Made
- `server/worker.js`: Cloudflare Worker entry point + `GameRoom` Durable Object class. Handles WebSocket upgrade, room routing, welcome/join/leave notifications, message broadcasting, and auto host election.
- `server/wrangler.toml`: Wrangler configuration — worker name `fading-light-relay`, Durable Objects binding for `GAME_ROOM`, migration tag `v1`.
- `server/README.md`: Setup instructions (Wrangler install, login, deploy), protocol documentation (connect URL format, message schema, server-side fields, system message types).

### Rationale
Multiplayer requires a lightweight server-side relay so peers can exchange game state without direct browser-to-browser WebRTC negotiation. Cloudflare Durable Objects provide per-room state isolation with no cold-start latency, and Workers deploy globally with zero infrastructure management.

### Next Steps
- Wire the client-side multiplayer code to connect to the deployed worker URL.
- Implement reconnect logic on the client for dropped WebSocket connections.
- Add room code generation UI to the game lobby/menu.
- Consider rate-limiting or message-size validation in the worker for production hardening.

---

## 2026-03-19 — v2.6.75: BotAI — all enemy targeting uses wave distance instead of straight-line distance

### Summary
Replaced straight-line distance scoring with wave (BFS flood-fill) distance across all enemy targeting logic in BotAI. A shared `getWaveDist()` helper computes the tile distance through walkable paths rather than air distance, so enemies behind walls of rocks score correctly. The helper was also repositioned to appear before any usage, resolving a prior compile error.

### Changes Made
- `src/ai/BotAI.ts`: Added `getWaveDist()` helper (BFS wave distance, Infinity if unreachable) before all enemy scoring code.
- `src/ai/BotAI.ts`: `bestEnemy` scoring now uses `walkDist = wd * 32` rather than `p.pos.distance(e.pos)` — enemies behind obstacles score much lower than those with clear paths.
- `src/ai/BotAI.ts`: `enemyNearCamp` validated against wave immediately after wave computation (moved earlier than before).
- `src/ai/BotAI.ts`: `projectileAttacker` validated against wave using the shared helper; old duplicate `isEnemyReachable()` helper removed.

### Rationale
Bots were previously chasing enemies that were physically close by air distance but blocked by rocks or walls, causing them to path endlessly around impassable terrain. Using wave distance ensures scoring reflects actual walking cost, so a clear-path enemy at 150px beats a wall-blocked enemy at 50px.

### Next Steps
- Observe whether sight-range cutoff (`walkDist > SIGHT_RANGE * 2`) needs tuning relative to the old straight-line `SIGHT_RANGE` threshold.
- Consider factoring wave distance into resource scoring as well for consistency.

---

## 2026-03-19 — v2.6.74: Fix BotAI — walk directly toward target when PathFollower arrives too far away

### Summary
When PathFollower reported "arrived" but the bot was still outside attack range (>50px for resources, >ATTACK_REACH for enemies), the bot was previously setting `goalAge=999` and giving up entirely. The fix changes that branch to instead walk the bot directly toward the target using a normalized direction vector. Grid collision handles wall sliding, so the bot will slide along rocks and close the remaining gap rather than abandoning the goal.

### Changes Made
- `src/ai/BotAI.ts`: Kill goal — replaced `goalAge = 999` on `arrived && dist >= ATTACK_REACH` with a direct-walk vector toward the enemy.
- `src/ai/BotAI.ts`: Chop/mine goal — restructured `arrived` branch: when `distToTarget < 50` attack as before; otherwise walk directly toward the resource instead of giving up.

### Rationale
The target was genuinely reachable — the bot just needed a small amount of direct movement to close the last few pixels that A* pathing left unresolved (e.g., bot stopped one tile short of a resource node). Abandoning the goal in that case caused the bot to stall repeatedly without ever attacking.

### Next Steps
- Monitor whether the direct-walk fallback causes any cases where the bot loops forever against a truly wall-blocked target (the `unreachable` flag should catch those, but worth observing).
- Consider a short timeout on the direct-walk phase to self-abort if no progress is made.

---

## 2026-03-19 — v2.6.73: Validate all enemy targets against wave reachability in BotAI

### Summary
Extended wave flood-fill reachability checks to cover all three enemy targets used in bot decision-making — not just `bestEnemy`. A new `isEnemyReachable()` helper checks the enemy's tile plus all 8 neighbors against the computed wave set, accounting for enemies standing just off a walkable tile. `enemyNearCamp` and `projectileAttacker` are now nulled out when unreachable, preventing Defend Camp and Counter-Attack behaviors from triggering on enemies the bot physically cannot path to.

### Changes Made
- `src/ai/BotAI.ts`: Added `isEnemyReachable()` helper (tile + 8-neighbor check against wave). Applied post-wave validation to `enemyNearCamp` and `projectileAttacker`.

### Rationale
The bot was getting stuck trying to fight enemies positioned behind solid rock walls. Only `bestEnemy` had reachability validation; the other two target variables did not, causing defense and counter-attack logic to fire against unreachable foes and lock the bot into a non-productive loop.

### Next Steps
- Monitor whether any additional target variables (e.g. future "heal ally" or "retreat" triggers) need the same reachability gate.
- Consider centralizing reachability into a shared utility so future code paths get it automatically.

---

## 2026-03-19 — v2.6.72: Scale tree stumps to 25% — 32x32 textures render at ~8x8px

### Summary
Tree stump actors now render at 25% of their native texture size. The stump textures are 32x32 px but were previously rendering at full size, appearing far too large relative to the map scale. Setting `scale = ex.vec(0.25, 0.25)` brings them down to approximately 8x8 px, matching the intended visual footprint.

### Changes Made
- `src/scenes/GameScene.ts`: Added `stump.scale = ex.vec(0.25, 0.25)` immediately after selecting the random stump variant, before the sprite is applied.

### Rationale
Full-size 32x32 stumps were visually oversized on the tilemap. Scaling them down to 25% keeps them proportionate to the environment and other decorative objects without requiring resized texture assets.

### Next Steps
- Verify stump collision body (if any) is also appropriately sized, or is disabled for purely decorative stumps.
- Consider whether other decorative props need similar scale corrections.

---

## 2026-03-19 — v2.6.71: Better projectile dodging — bot reacts earlier

### Summary
Improved bot evasion responsiveness across three axes: the urgency threshold for committing to a full dodge was lowered so the bot reacts before a projectile is nearly on top of it; the evasion blending while chasing is now more aggressive so the bot weaves rather than walking in a straight line; and the projectile detection radius was extended so the bot has more reaction time overall.

### Changes Made
- `src/ai/BotAI.ts`: Full-dodge urgency threshold 2.5 -> 1.8. Evasion-while-chasing urgency threshold 1.5 -> 1.0, blend factor 0.2 -> 0.3, blend cap 0.3 -> 0.5. Projectile detection radius 100px -> 150px.

### Rationale
The bot was dying to projectiles it had already "seen" because the urgency thresholds were tuned too conservatively. Lowering them — and widening the detection radius — gives the bot meaningful lead time to sidestep rather than absorbing a hit before the dodge logic fires.

### Next Steps
- Observe whether the more aggressive evasion blend causes the bot to stall on its chase path when urgency is moderate; tune the 1.0 threshold up slightly if so.
- Consider a separate urgency band (e.g. 0.5-1.0) for lighter perpendicular nudges that don't redirect the bot at all.

---

## 2026-03-19 — v2.6.70: Heal player near bonfire — 5 HP/sec within 30% light radius

### Summary
Added gradual player healing when standing near the bonfire. The player recovers 5 HP per second when within 30% of the bonfire's base light radius. Healing is applied fractionally each frame via `dt` using the existing `HealthComponent.heal()` method. This gives low-HP players a tactical reason to retreat to camp between encounters.

### Changes Made
- `src/scenes/GameScene.ts`: In the main update loop, checks distance from the first bonfire to the player each frame. If within `CONFIG.BONFIRE_BASE_RADIUS * 0.3`, applies `hp.heal(5 * dt)` as long as HP is below max.

### Rationale
Without a recovery mechanic, players had no way to regain health outside of items. The bonfire as a healing anchor reinforces the camp-and-explore loop: push into the maze, retreat to safety when hurt, then push again.

### Next Steps
- Consider visual feedback (glow pulse, particle effect, or HUD indicator) when healing is active.
- Optionally scale heal rate with bonfire level / camp upgrades.

---

## 2026-03-19 — v2.6.69: Fix HP display — HUD reads HealthComponent directly

### Summary
Critical bug fix: the HUD always showed 1000 HP regardless of damage taken. GameScene had a stale `private hp: number = 1000` field that was never connected to the player's HealthComponent. Enemies dealt damage to HealthComponent, but the HUD read the dead field. Also corrected player starting HP from the hardcoded 1000 to CONFIG.PLAYER_MAX_HP.

### Changes Made
- `src/entities/EntityFactory.ts`: HealthComponent now initialized with `CONFIG.PLAYER_MAX_HP` instead of hardcoded `1000`.
- `src/scenes/GameScene.ts`: Removed `private hp: number = 1000`. `updateHUD()` now reads `hp` and `maxHp` directly from the player's HealthComponent and displays them in `HP/maxHP` format. HP bar scales correctly relative to max HP.

### Rationale
The stale field made it impossible to see actual health during combat. Any damage dealt by enemies was invisible to the player in the HUD. Reading from the single source of truth (HealthComponent) eliminates the sync problem entirely. Displaying `HP/maxHP` gives the player clearer feedback than a raw number.

### Next Steps
- Verify HUD updates correctly at runtime during combat playtest.

---

## 2026-03-19 — v2.6.68: Fix bot resource attack range using pixel distance

### Summary
Fixed BotAI attacking resources from tile-adjacency positions that were actually too far in pixel space. Replaced the tile-based dx/dy neighbor check with a direct pixel distance comparison matching the 52px damage range used in GameScene.

### Changes Made
- `src/ai/BotAI.ts`: Replaced tile-adjacency check (`dx<=1 && dy<=1`) with pixel distance check (`< 50px`) for resource attack trigger
- `src/ai/BotAI.ts`: Updated "arrived but too far" guard to use the same 50px threshold instead of tile adjacency
- `src/ai/BotAI.ts`: When arrived at approach tile, bot now nudges toward resource instead of standing still (small directional velocity)

### Rationale
Tile adjacency allowed the bot to believe it was in attack range when the pixel distance was ~60px — outside the 52px damage radius in GameScene. The bot would swing but deal no damage. Now both checks are based on actual pixel distance, consistent with the engine's damage logic.

### Next Steps
- Monitor if 50px threshold needs tuning relative to bot movement speed and resource hitbox sizes

---

## 2026-03-19 — v2.6.67: Stump sprite variants, speed rebalance, extended melee range, PathFollower AI movement

### Summary
Added 3 stump sprite variants that are randomly selected when a tree is chopped. Rebalanced movement speeds across player and all enemy types to make combat feel more deliberate. Extended player melee range from 32px to 48px so melee can more reliably reach ranged enemies. Refactored all enemy movement behaviours (flee, orbit, wander) to use PathFollower so they pathfind to calculated target points rather than moving in straight lines.

### Changes Made
- `public/assets/pixelart/stump1.png`, `stump2.png`, `stump3.png` — New 32x32 pixel art stump sprites (3 visual variants, generated via PixelLab MCP).
- `src/engine/AssetLoader.ts` — Registers all 3 stump texture variants.
- `src/scenes/GameScene.ts` — `spawnStump()` randomly selects one of the 3 stump textures when placing a stump after a tree is chopped.
- `src/config.ts` — Speed rebalance: Player 160→110; Wisp 104→72, Stalker 76→56, Beast 52→40, Lord 44→36; Archer 62→42, Mage 48→35; Crawler 60→44.
- `src/entities/EntityFactory.ts` — Player melee attack range increased from 32px to 48px.
- `src/ai/EnemyBrainSystem.ts` — Flee, orbit, and wander behaviours now calculate a target point (flee point 120px away, perpendicular orbit point, random wander point 80px away) and use PathFollower to pathfind there. Paths stored for debug rendering.

### Rationale
The original speeds made enemies too easy to kite and the player felt too fast relative to the maze. Slowing everything down adds weight and tension to encounters. Extending melee range addresses the frustration of being unable to hit ranged enemies before they reposition. Routing all AI movement through PathFollower eliminates cases where enemies would phase through walls or get stuck on corners during flee/orbit/wander states.

### Next Steps
- Playtest the new speeds and tune further if combat still feels off.
- Verify PathFollower flee/orbit/wander paths are being recalculated at appropriate intervals (not every frame).
- Consider adding a brief stump-appear animation when the stump spawns.

---

## 2026-03-19 — v2.0.1: Custom loading screen with ember particles and fade-out

### Summary
Replaced Excalibur's default loading UI with a fully custom themed overlay injected directly into the DOM in `src/main.ts`. The screen matches the game's visual identity and transitions out cleanly once assets are ready.

### Changes Made
- `src/main.ts`
  - Custom `div` overlay injected at the start of the file, before the engine is created.
  - "THE FADING LIGHT" title rendered at 48px with pulsing `text-shadow` animation (`titlePulse` keyframe).
  - "SURVIVE THE DARKNESS" subtitle beneath the title in muted orange.
  - Orange gradient progress bar (300px wide, 4px tall) wired to a 200ms polling interval tracking `loadedCount / totalCount`.
  - Floating ember particle system: `spawnEmber()` called every 150ms via `setInterval`, each ember rises via `emberRise` keyframe and self-removes after its duration.
  - Injected `<style>` tag hides `.excalibur-loader` and `#excalibur-play` via `display: none !important`, defines `titlePulse` and `emberRise` keyframes.
  - On `game.start(loader).then(...)`: intervals cleared, bar snapped to 100%, status text set to "Ready", overlay fades out over 0.8s then is removed from the DOM along with the style tag.
  - Removed the stale "skip intro/menu for testing" comment from the `goToScene` call.
- `src/config.ts` — `GAME_VERSION` bumped from `2.0.0` to `2.0.1`.

### Rationale
Excalibur's default loader has no visual connection to the game's dark, ember-lit aesthetic. Replacing it with a custom overlay that uses the same colour palette (`#020105` background, `#ff8844` orange) and atmospheric particle effect sets the mood before the first frame renders, creating a cohesive first impression.

### Next Steps
- Consider tying `loadedCount` directly to Excalibur's loader events for a more accurate progress value rather than the polling interval.
- Evaluate whether the ember particle count/speed needs tuning on lower-end devices.

---

## 2026-03-19 — v2.6.66: Debug mode off by default in GameScene

### Summary
`GameScene.debugMode` is now initialized to `false` instead of `true`, so debug overlays and actor visuals are hidden on startup. The debug checkbox in the UI can still toggle it on at runtime.

### Changes Made
- `src/scenes/GameScene.ts` — `private debugMode = true` changed to `private debugMode = false`.
- `package.json` — Version bumped to 2.6.66.

### Rationale
Debug mode was left enabled, causing debug visuals to appear for all players by default. Setting the default to `false` ensures a clean production experience without requiring the player to manually disable it.

### Next Steps
- Verify debug checkbox toggle still works correctly at runtime.

---

## 2026-03-19 — v2.6.65: Freeze units during attack animation; ranged enemies shoot while fleeing

### Summary
All units (player and enemies) are now frozen in place for the duration of their attack animation — velocity is zeroed and movement logic is skipped until the animation completes. Ranged enemies also gain the ability to fire back while fleeing, with roughly a 10% chance per second, making retreating ranged foes more dangerous and tactically interesting.

### Changes Made
- `src/ai/EnemyBrainSystem.ts`
  - After state resolution, reads `AnimatedSpriteComponent.isAttacking`; if true, sets `e.vel` to zero and issues `continue` to skip all movement logic for that frame.
  - In the `flee` case, added a probabilistic ranged attack: `if (ai.isRanged && Math.random() < 0.1 * dt)` calls `doRangedAttack`, giving fleeing ranged enemies an occasional parting shot.
- `src/scenes/GameScene.ts`
  - After input is resolved, reads `playerAnim.isAttacking`; if true, forces `vx = 0; vy = 0` before passing velocity to grid collision and movement logic.
- `package.json` — Version bumped to 2.6.65.

### Rationale
Without the freeze, units could slide or drift during attack animations because movement velocity was still being applied every frame. Zeroing velocity and skipping movement logic ensures the attack animation plays as a rooted action. The flee-and-shoot mechanic for ranged enemies addresses the safe-retreat exploit where players could chase a fleeing ranged enemy with no risk — now fleeing is threatening rather than purely defensive.

### Next Steps
- Verify that melee enemies do not stutter at the start of attack animations due to the velocity zero-out.
- Consider whether a short root duration (e.g. first 60% of animation) is preferable to full-animation locking for fast enemies.
- Tune the 10% flee-shoot probability based on playtesting — may want to scale with enemy tier.

---

## 2026-03-19 — v2.6.64: Fix player facing direction during bot attacks

### Summary
Player sprite now correctly faces the target when the bot AI issues an attack command. Previously, `vx=vy=0` during an attack meant `AnimatedSpriteComponent` had no directional input and the sprite stayed frozen in whatever direction it was last walking. A tiny velocity (0.01) is now applied in the direction of the target (enemy or resource) to drive the facing update without causing any visible movement.

### Changes Made
- `src/ai/BotAI.ts` — Kill action (enemy attack): replaced `vx=0; vy=0` with a 0.01-magnitude vector toward the enemy using `dirTo`
- `src/ai/BotAI.ts` — Gather action (chop/mine): same fix applied when the player is a direct neighbor of the resource

### Rationale
`AnimatedSpriteComponent` derives facing from velocity. Zero velocity means no facing update, so the last walk direction was retained during the attack animation. The 0.01 scalar is large enough to set direction but small enough to produce no perceptible movement.

### Next Steps
- Verify facing works correctly for all eight directions on both enemy and resource targets
- Consider whether the same pattern applies to any other zero-velocity attack states

---

## 2026-03-19 — v2.6.63: Spawn Shadow Archer + Void Mage near bonfire on level init for ranged combat testing

### Summary
Two starter ranged enemies (Shadow Archer and Void Mage) are now spawned near the first bonfire when a level initializes. This provides an immediate target for testing ranged enemy AI and combat mechanics without manual setup.

### Changes Made
- `src/scenes/GameScene.ts`
  - After `initBuildSpots()`, added a spawn block that iterates over `['SHADOW_ARCHER', 'VOID_MAGE']`.
  - For each type, picks a random angle and a distance of 180–260 units from the bonfire, finds the nearest walkable tile via `grid.findWalkableNear`, creates the enemy with `EntityFactory.createEnemy`, and pushes it into `level.enemies`.
- `package.json` — Version bumped to 2.6.63.

### Rationale
Manually placing ranged enemies to test combat was tedious. Spawning them automatically at level start gives a consistent baseline for verifying projectile firing, aggro range, and BotAI dodge behaviour against ranged foes from the first game frame.

### Next Steps
- Remove or gate behind a debug flag once ranged combat is stable.
- Consider spawning at fixed positions rather than random angles if reproducibility is needed for regression tests.

---

## 2026-03-19 — v2.6.62: Fix bot rapid goal cycling — add 0.3s minimum hold time for reactive goals

### Summary
The bot no longer rapidly cycles between Retreating, Dodging, and Fighting every frame. Reactive goals (flee, dodge, kite, kill) now enforce a 0.3s minimum hold time before they can be interrupted by another reactive goal. Previously these goals had zero hold time and could interrupt each other every single frame, causing the bot to stand still while its goal status flickered.

### Changes Made
- `src/ai/BotAI.ts`
  - `shouldSwitchGoal`: added `if (this.goalAge < 0.3) return false` guard at the top of the reactive-goal interrupt block. Any reactive goal now runs for at least 0.3s before it can yield to another reactive goal.
  - Updated comment above the guard to document the rationale.
- `package.json` — Version bumped to 2.6.62.

### Rationale
Without a minimum hold time, reactive goals (all with zero hold time configured) could interrupt each other on every tick. The result was the bot never moving — each new goal would push a velocity for one frame then be immediately replaced, leaving net movement near zero. A 0.3s floor is long enough to produce visible displacement without making the bot feel unresponsive to genuine new threats.

### Next Steps
- Consider per-goal minimum hold times if 0.3s feels too long for fast dodge reactions.
- Monitor whether 0.3s is sufficient against very fast enemies or if further tuning is needed.

---

## 2026-03-19 — v2.6.61: Fix bot oscillation between Fighting and Dodging vs ranged enemies

### Summary
The bot no longer oscillates between Fighting and Dodging states when attacked by ranged enemies. The full dodge interrupt threshold was raised so only very imminent projectiles break the current goal, and the evasion blend while approaching was reduced so the bot keeps charging forward with only a slight sideways nudge instead of stopping or slowing down.

### Changes Made
- `src/ai/BotAI.ts`
  - Dodge Projectile check: threshold raised from `urgency > 1.5` to `urgency > 2.5`. Medium-range projectiles no longer trigger a full goal interrupt; they are handled by evasion blending inside the kill goal instead.
  - Kill goal approach evasion: blend factor reduced from `0.4` to `0.2`, max blend cap reduced from `0.6` to `0.3`. Evasion trigger threshold raised from `urgency > 1.0` to `urgency > 1.5`.
  - Condensed two redundant multi-line path bail-out blocks into single-line guards (no logic change).
- `package.json` — Version bumped to 2.6.61.

### Rationale
At the old threshold (1.5), nearly every ranged shot caused a full Dodge Projectile goal to activate, interrupting the kill approach and making the bot appear to stop and strafe repeatedly. By reserving the full dodge for urgency > 2.5 and keeping lower-urgency evasion as a small positional nudge within the kill goal, the bot visibly charges toward ranged enemies while still weaving slightly to avoid projectiles.

### Next Steps
- Tune urgency thresholds further if bot still oscillates against fast-projectile enemies.
- Consider separate thresholds per enemy type once projectile speed data is available per-entity.

## 2026-03-19 — v2.6.60: Fix pickup goal — bot walks directly to nearest drop each frame

### Summary
The bot pickup goal no longer uses A* pathfinding to reach drops. Instead it finds the nearest drop from the current player position on every frame and walks directly toward it. The goal coordinates are also updated each frame for the debug intent line. If no drops remain the goal is immediately abandoned and re-evaluated.

### Changes Made
- `src/ai/BotAI.ts`
  - `case 'pickup'`: replaced `moveToWithPathfinding(goal.x!, goal.y!)` with a direct per-frame nearest-drop search using the current player position.
  - Bot iterates `this.gameState.drops`, finds the closest by Euclidean distance, and sets `vx`/`vy` to the normalised direction vector when further than 4 px.
  - `goal.x` and `goal.y` are updated to the closest drop position every tick so the debug intent line stays accurate.
  - Removed the stale `hasDropNearby` check (which tested proximity to the old cached goal coordinates) and replaced it with a simple `!closestDrop` guard.
- `package.json` — Version bumped to 2.6.60.

### Rationale
`moveToWithPathfinding` could report `arrived` or `unreachable` for drops that were nearby but not exactly on a pathfinding node, causing the bot to stall or bail out of the goal prematurely. Drops always land on walkable tiles, so no obstacle avoidance is necessary — a direct walk vector is both simpler and more reliable.

### Next Steps
- Monitor whether the 4 px arrival threshold is sufficient for the bot to actually collect the drop via the existing pickup trigger radius.
- Consider a similar direct-walk approach for any other goal types targeting objects known to be on walkable tiles.

## 2026-03-19 — v2.6.59: Filter unreachable enemies via wave flood-fill in BotAI

### Summary
Enemy selection in the bot AI now uses the same wave flood-fill reachability check that was already applied to resources. Enemies that cannot be reached by the pathfinder are excluded before scoring. Kill goal execution also gains two bail-out conditions: path declared unreachable, or arrived but still outside attack range. The flood-fill itself was moved earlier in the context builder so both the enemy pass and the resource pass share one computation.

### Changes Made
- `src/ai/BotAI.ts`
  - Wave flood-fill (`grid.floodFill`) relocated to run before the `bestEnemy` loop instead of just before the resource loop, eliminating duplicate BFS work.
  - `bestEnemy` loop: after sight-range check, tests whether the enemy tile (or any non-blocked adjacent tile) is present in the reachable wave set; enemies that fail are skipped with `continue`.
  - Kill goal `case 'kill'`: added `isDying` guard alongside `isKilled` at entry. After calling `moveToWithPathfinding`, two new bail-outs force `goalAge = 999` to abandon the goal — `pathFollower.unreachable` (no path exists at all) and `pathFollower.arrived && dist >= ATTACK_REACH` (arrived at closest navigable point but enemy is still out of reach).
  - Removed two stale inline comments that were no longer accurate.
- `package.json` — Version bumped to 2.6.59.

### Rationale
Bots were pathing toward enemies behind walls or across impassable terrain, wasting goal budget and producing visually broken behaviour (bot stands at a wall perpetually). Reusing the existing wave result for enemy filtering mirrors how resources are already handled and keeps the reachability logic consistent. The kill-goal bail-outs prevent the bot from getting stuck in an infinite approach loop when geometry means it literally cannot reach the target.

### Next Steps
- Verify the adjacent-tile reachability check (1-tile neighbourhood) does not create false negatives for enemies standing on wall-edge tiles with only diagonal exits.
- Consider exposing a dedicated `canReach(pos)` helper on the grid/pathfinder to centralise this pattern rather than repeating tile-neighbourhood logic at each call site.

## 2026-03-19 — v2.6.58: Stronger hit effects — bigger tree shake and 3-phase stone/metal flash

### Summary
Amplified both hit-feedback modes in `HitEffectComponent` for much clearer visual impact. Tree shake rotation amplitude doubled and duration extended. Stone/metal flash replaced with a 3-phase impact sequence — scale burst, bounce-back dim, settle — that is dramatically more visible than the previous subtle two-pulse pattern.

### Changes Made
- `src/components/HitEffectComponent.ts` — Shake mode: rotation amplitude increased from 0.08 to 0.15 rad (~8.5 degrees), duration extended from 300ms to 400ms, oscillation frequency slowed via `phase * 0.025` multiplier. Flash mode: replaced two-pulse blink with a 3-phase sequence over 150ms — impact (t < 0.2): scale 1.2x + opacity 2.0 (over-bright push); bounce (t < 0.5): scale lerps 1.2 → 0.95 + opacity 0.5; settle (t ≥ 0.5): scale lerps back to 1.0 + opacity lerps back to 1.0. Reset to scale 1 / opacity 1 on timer expiry.
- `package.json` — Version bumped to 2.6.58.

### Rationale
Playtesting with dense resource clusters showed the previous effects were too subtle — players were unsure whether their attacks were registering. The doubled shake amplitude makes tree hits unmistakable. The 3-phase flash sequence for stone/metal is modeled on physical impact: sudden expansion, rebound undershooting, then settling, which reads as a clear "hit" response and is more perceptible than the prior symmetric two-pulse.

### Next Steps
- Monitor whether the over-bright opacity (2.0) renders correctly across different screen brightness settings — may need to cap at 1.5 if it looks blown out on bright monitors.
- Consider applying the same 3-phase flash to player/enemy melee hits now that the pattern is validated on resources.

---

## 2026-03-19 — v2.6.57: Fix bot stopping 2 tiles from target (BotAI adjacency check)

### Summary
BotAI for chop/mine tasks now verifies true adjacency after `PathFollower.arrived`. If the pathfinder reports arrival at an approach tile that is not a direct neighbor of the resource (dx > 1 or dy > 1), the bot forces `goalAge = 999` to trigger re-evaluation and selection of a closer or more reachable resource tile.

### Changes Made
- `src/ai/BotAI.ts` — In the chop/mine arrived branch, added an `isDirectNeighbor` guard. If arrived but not adjacent, sets `goalAge = 999` and breaks out of the action loop, forcing goal re-evaluation on the next tick instead of standing frozen at the approach tile.
- `package.json` — Version bumped to 2.6.57.

### Rationale
`PathFollower.arrived` fires when the bot reaches the end of its computed path, but the path endpoint can be the tile adjacent to an obstacle rather than the tile adjacent to the resource. Previously the bot would interpret arrival as task completion and idle indefinitely. The adjacency check catches this mismatch and recovers gracefully by discarding the current goal rather than looping forever on an unreachable target.

### Next Steps
- Monitor whether goalAge reset causes thrashing on maps with genuinely unreachable resources — may need a backoff counter or a cooldown before re-evaluating the same resource.
- PathFollower temp log confirmed already removed prior to this commit.

---

## 2026-03-19 — v2.6.56: Improve HitEffectComponent — rotation shake + scale/opacity flash

### Summary
Overhauled the two hit-feedback modes in `HitEffectComponent`. Tree shake now rotates around the anchor point (trunk base) for natural leaf sway instead of shifting `pos.x`. Stone/metal flash replaces the broken white-tint approach with a two-pulse scale + opacity blink.

### Changes Made
- `src/components/HitEffectComponent.ts` — Shake mode: oscillates `actor.rotation` with decaying amplitude (±4.5 degrees over 300ms); rotation pivots at the trunk base because the sprite anchor is (0.5, 0.8), so the crown sways naturally. Flash mode: replaced `g.tint = ex.Color.White` (which had no visible effect because Excalibur tints multiply, and White = no change) with a two-pulse pattern — grow to 1.12x scale + dim to 0.6 opacity, then a smaller 1.05x pulse, resetting fully after 150ms. Internal timer/phase state consolidated from four fields down to two.
- `package.json` — Version bumped to 2.6.56.

### Rationale
The original `pos.x` shake was jarring and left the entity displaced if the frame budget was missed. Rotation around the trunk base is physically correct for a tree and matches how Excalibur's anchor system works. The white-tint flash was silently broken since day one — multiplying by White is a no-op in Excalibur's rendering pipeline. The scale+opacity approach is engine-agnostic and clearly perceptible without being disruptive.

### Next Steps
- The 30px facing bonus in `GameScene` targeting may need tuning once the improved shake is playtested with dense tree clusters.
- Consider adding a separate flash variant for player/enemy melee hits now that the pattern is proven.

---

## 2026-03-19 — v2.6.55: HitEffectComponent — shake/flash on resource hit + facing-priority targeting

### Summary
Added a new `HitEffectComponent` that provides visual feedback when resource entities take damage. Removed all inline hit-effect logic from `GameScene`. Also improved resource attack targeting to prefer objects in the player's facing direction.

### Changes Made
- `src/components/HitEffectComponent.ts` (new) — Component attached to damageable resource entities. Auto-detects HP change each frame by comparing against the previous HP value. Two modes: `'shake'` applies a 200ms horizontal oscillation with fading intensity (used for trees); `'flash'` applies a 100ms white tint (used for stones and metals). Follows the standard component pattern — zero game logic lives in the scene.
- `src/entities/EntityFactory.ts` — Trees receive `HitEffectComponent('shake')`, stones and metals receive `HitEffectComponent('flash')`.
- `src/scenes/GameScene.ts` — Removed inline hit-effect calls from `damageResource()`. Resource attack targeting now uses a scored sort: `score = distance - (dot(toTarget, facingDir) * 30)`. This gives a 30px effective advantage to resources in the player's facing direction, making attacks feel intentional when multiple resources are nearby.
- `package.json` — Version bumped to 2.6.55.

### Rationale
The inline effects in `damageResource()` were a violation of the component architecture — visual feedback should be owned by the entity, not the scene. `HitEffectComponent` makes the effect portable and removes hidden coupling. The facing-direction targeting fix addresses player frustration when attacking resources: clicking attack near a resource cluster previously hit whichever was mathematically closest, which often wasn't the one the player was looking at.

### Next Steps
- Consider expanding `HitEffectComponent` to support player/enemy entities for melee hit feedback.
- The 30px facing bonus is a tunable constant — may need adjustment once playtested with dense resource clusters.

---

## 2026-03-19 — v2.6.54: Fix bot stuck on "Picking up" after drop already collected

### Summary
Fixed a bot AI bug where the bot would remain in the "Picking up" goal indefinitely after the targeted drop had already been collected by another player or itself.

### Root Cause
The pickup goal stored only x/y coordinates rather than a direct entity reference. This meant `shouldSwitchGoal` had no way to detect when the drop was gone — it could not compare against `null` or check entity liveness. The bot would walk to the position forever with no drop to collect.

### Changes Made
- `src/ai/BotAI.ts` — Added a proximity check in the `pickup` case of the goal update loop. Each frame, `gameState.drops` is searched for any drop within 40px of the goal's target position. If none is found, `goalAge` is set to 999 to force immediate re-evaluation on the next tick.
- `package.json` — Version bumped to 2.6.54.

### Rationale
The fix is minimal and non-invasive: it does not require changing the goal data structure or storing entity references (which could become stale references anyway). The 40px threshold matches the visual pickup radius so re-evaluation triggers exactly when the drop is no longer reachable.

### Next Steps
- Consider refactoring pickup goals to store a drop entity ID so staleness can be detected more robustly without a positional scan.

---

## 2026-03-19 — v2.6.53: Refactor resource attack — extract damageResource() method

### Summary
Cleaned up the resource damage logic in `GameScene.ts` by extracting it into a dedicated private method. Behavior is unchanged: attacking hits the nearest resource entity within 52px.

### Changes Made
- `src/scenes/GameScene.ts` — Extracted inline resource damage block from the attack callback into a new `private damageResource(entity: GameEntity): void` method. The method handles HP damage, hit sparks, drop spawning, floating text, stump spawning, and entity kill in one place. The attack callback now filters + sorts for the nearest resource within 52px, then delegates to `damageResource()`.
- `package.json` — Version bumped to 2.6.53.

### Rationale
The previous inline block was ~20 lines of interleaved logic sitting inside a nested callback. Extracting it to a named method makes the callback readable at a glance and gives the damage logic a single, testable home. No functional change was introduced.

### Next Steps
- `damageResource()` could later be extended to support variable damage values (e.g., weapon stats) without touching the call site.

---

## 2026-03-19 — v2.6.52: Fix attack animation stuck in attacking state forever

### Summary
Resolved a permanent state-machine lockup in `AnimatedSpriteComponent` where the attack state never resolved, blocking all future attacks indefinitely.

### Root Cause
When `playAttack()` was called before spritesheets were extracted (so `attackAnim` was null) or when the frame array for the current direction was empty, the `if (currentAnim === 'attack' && this.attackAnim)` block was skipped entirely. This left `currentAnim` stuck at `'attack'` forever, causing `isAttacking` to return true permanently and preventing any subsequent attack from registering.

### Changes Made
- `src/components/AnimatedSpriteComponent.ts` — Two guard clauses added to the update state machine:
  1. If `currentAnim === 'attack'` and `attackAnim` is null: fire the callback immediately, reset `currentAnim` to `'idle'`, clear `attackCallback`.
  2. If the attack frames array for the current direction is empty (length 0): reset to idle. The existing check for `frames.length` coverage was updated to include the empty-array case explicitly.
- `package.json` — Version bumped to 2.6.52.

### Rationale
The state machine must guarantee that every state it enters is eventually exited. The previous code had an implicit assumption that `attackAnim` would always be available when the attack state was entered, which was not upheld during rapid or early-game attacks. The fix enforces a hard invariant: the attack state always resolves on the same frame it is detected as unresolvable.

### Next Steps
- Monitor attack responsiveness in the MazeScene and GameScene to confirm no attack lockups occur.
- Consider adding a defensive assertion or warning log if `playAttack()` is called before spritesheets are ready, to surface the timing issue earlier in development.

---

## 2026-03-19 — v2.6.51: Fix bot chop range + floodFill cardinal-only

### Summary
Two targeted fixes addressing bot attack stalling and flood-fill connectivity accuracy.

### Changes Made
- `src/ai/BotAI.ts` — Chop attack neighbor check changed from cardinal-only (`dx+dy<=1`) to all 8 neighbors (`dx<=1 && dy<=1`). The bot was reaching a diagonal neighbor, failing the cardinal check, and stalling instead of attacking.
- `src/engine/GridCollisionSystem.ts` — `floodFill` direction set reduced from 8 (cardinal + diagonal) to 4 (cardinal only). Diagonal spread overstated walkable connectivity — two blocked tiles that share only a corner cannot physically be walked between.
- `package.json` — Version bumped to 2.6.51.

### Rationale
The chop-range fix is the direct consequence of the coordinate investigation enabled by the v2.6.50 debug overlay: the bot was consistently one diagonal tile away and the old check excluded that. The floodFill fix ensures the reachability calculation used for pathfinding validity matches the real movement model (no diagonal movement through corner gaps).

### Next Steps
- Monitor bot combat in the MazeScene to confirm the diagonal-neighbor stall is gone.
- Consider removing the debug overlay tile highlights (v2.6.50) once the coordinate system is verified stable.

---

## 2026-03-19 — v2.6.50: Debug overlay — player tile (blue) + bot target tile (yellow)

### Summary
Added two tile highlight overlays to the debug view in `GameScene`. A blue semi-transparent rectangle marks the tile the player currently occupies, and a yellow one marks the tile of the bot's current harvest target (tree or stone). Both are managed through `debugActors` and cleared/redrawn each debug refresh cycle.

### Changes Made
- `src/scenes/GameScene.ts` — Two new blocks in the debug overlay section: one computes the player's tile from `player.pos` and renders a blue actor at z=8001; the other reads `botAI.currentGoal.target.pos`, computes its tile, and renders a yellow actor at z=8001. Both push to `debugActors` for cleanup.
- `package.json` — Version bumped to 2.6.50.

### Rationale
Recent bot interaction bugs involve the tile coordinate the bot is targeting being off by one compared to the tile the player stands on. Visualising both in-game lets a developer see the mismatch in real time without adding logging noise.

### Next Steps
- Use the overlay to confirm tile alignment once the coordinate mismatch is identified and patched.
- Remove or gate behind a debug flag once the coordinate system is verified correct.

---

## 2026-03-19 — v2.6.49: Fix bot tree-switching — commit to one chop target until destroyed

### Summary
Bots previously abandoned the tree they were chopping every 1.5 seconds and picked a different "best" tree due to minor position changes affecting the scoring heuristic. The bot now locks onto a chop or mine target until that target is dead. Only reactive goals (flee, dodge, kite, kill), an affordability check for build goals, or actual target death can interrupt the current harvest goal.

### Changes Made
- `src/ai/BotAI.ts` — `shouldSwitchGoal()`: added an early-return guard that returns `false` when the current goal type is `chop` or `mine` and the target is still alive (`!target.isKilled()`). This fires before the `goalMinTime` hold-time check, so the lock holds for the full lifetime of the target regardless of re-evaluation cycles.
- `package.json` — Version bumped to 2.6.49.

### Rationale
The 1.5s `goalMinTime` hold was the only protection against goal thrashing, but once it expired the bot re-evaluated from scratch. Tiny position deltas shifted scores enough to select a different tree on each cycle, producing zig-zag behavior between two nearby trees. Committing to the target until death is the correct model: there is no benefit to switching trees mid-chop.

### Next Steps
- Confirm bots fully chop one tree before moving to the next during automated playtests.
- Consider applying the same lock to the `mine` goal path if ore-switching is observed.

---

## 2026-03-19 — v2.6.48: Fix bot resource attack range — tile adjacency only

### Summary
Replaced a pixel-distance threshold (dist < 56px) with a Manhattan tile-distance check. Bots now only attack a resource when occupying the same tile or a directly adjacent tile horizontally or vertically (dx + dy <= 1). Diagonal adjacency does not qualify — the bot must path around to get in position.

### Changes Made
- `src/ai/BotAI.ts` — Harvest goal handler: compute tile coords for both bot and target, derive `dx` and `dy`, and attack only when `dx + dy <= 1`. Removed the previous `pos.distance()` pixel check.
- `package.json` — Version bumped to 2.6.48.

### Rationale
The old 56px check treated diagonal-corner proximity as "in range," which allowed bots to attack resources on the other side of a wall corner. The new tile-based check mirrors the actual movement model: only cardinal neighbors are reachable in one step, so attack range now aligns exactly with movement reachability.

### Next Steps
- Verify bots navigate around corners successfully before attacking, not stalling at diagonal adjacency waiting for a path.

---

## 2026-03-19 — v2.6.47: Fix bot re-pathing away from reachable resource

### Summary
Bot was arriving at a tree, attacking for 1 frame, then abandoning its goal and marking the resource unreachable. Root cause: `findPath` returns an empty path when the bot is already standing on the approach tile (distance to self = 0), which `PathFollower` interpreted as unreachable.

### Changes Made
- `src/ai/BotAI.ts` — Added distance guard before pathfinding in the harvest goal handler. If the bot is within 56 px of the target, it attacks directly and skips `moveToWithPathfinding` entirely. Also removed temporary debug logging added during diagnosis.

### Rationale
The wave algorithm already guarantees reachability at goal-selection time, so there is no need to re-verify via the pathfinder when the bot is already adjacent. The 56 px threshold (roughly 1.75 tiles) is safely inside attack range and safely above the rounding noise that could cause the bot to land exactly on the approach tile. This eliminates the one-frame attack + immediate goal-abandon loop without changing any pathfinding logic.

### Next Steps
- Watch for edge cases where a bot stalls at 55 px from a target that is partially blocked; if observed, consider widening the threshold slightly.

---

## 2026-03-19 — v2.6.46: A* best-side selection, flood-fill wave distance, bot walk-distance scoring

### Summary
Three tightly coupled improvements that make pathfinding and resource scoring aware of actual walk geometry rather than straight-line geometry. Bots will no longer target the wrong side of a blocked resource, and resources behind walls are correctly penalised during goal selection.

### Changes Made
- `src/engine/PathFollower.ts` — Best approach side for a blocked target now runs `grid.findPath` to each walkable neighbor and picks the one that returns the shortest actual A* path. Previously the nearest neighbor by straight-line distance was chosen, which could point through a wall. The selection is folded into the existing repath block (every 0.8–1.2 s) so there is no per-frame cost.
- `src/engine/GridCollisionSystem.ts` — `floodFill` now returns `Map<string, number>` (tile key → BFS wave distance in tiles) instead of `Set<string>`. All callers that previously used `.has(key)` now use `.get(key) !== undefined`; the numeric distance value is available for scoring.
- `src/ai/BotAI.ts` — Resource scoring replaces straight-line `pos.distance()` with wave distance (`waveDist * 32` px). Resources that are close by air but far by walking (e.g., on the far side of a wall) receive a higher score and are deprioritised. Unreachable resources (`waveDist === Infinity`) are still skipped entirely.

### Rationale
The old PathFollower side-selection picked the geometrically nearest neighbor tile of a blocked target. On maps with tight corridors this often chose a side that required the path to loop around an obstacle, while a slightly farther tile would have been a shorter real path. Running A* to each candidate side costs a few milliseconds per repath but is invisible at 0.8–1.2 s intervals. The flood-fill Map upgrade is a prerequisite for the BotAI change and adds zero overhead to the BFS itself. The bot scoring fix closes the last case where a resource "close by air" could attract the bot into a long wall-hugging detour.

### Next Steps
- Monitor bot behavior on dense-wall maps to confirm repath frequency stays acceptable.
- Consider caching the best-side result per (target tile, source tile region) if profiling shows cost during many simultaneous bots.

## 2026-03-19 — v2.6.45: Stricter resource reachability + debug mode on by default

### Summary
Three tightly related correctness fixes: the wave-based reachability check now verifies that neighboring tiles are both walkable and in the reachable set before accepting a resource as reachable; debugMode is enabled by default so the overlay is visible on first load; and all remaining fallback paths (direct-walk, partial paths) have been removed so failures surface cleanly rather than producing silent wrong behavior.

### Changes Made
- `src/ai/BotAI.ts` — Rewrote resource reachability check. Previously any neighbor tile found in the reachable set was accepted, even if that tile was walled off from the resource. Now each neighbor must pass `!grid.isBlocked(nx, ny) && reachable.has(...)`. The resource tile itself is still checked directly first. Unreachable resources are skipped entirely.
- `src/scenes/GameScene.ts` — `debugMode` initialised to `true`. The debug toggle checkbox now sets `cb.checked = this.debugMode` on creation so the UI reflects the real state. Player can uncheck to hide the overlay.

### Rationale
The old neighbor check could return `isReachable = true` for a resource surrounded by walls if the wave happened to tag a same-row/column tile on the far side of the wall. The strict walkable-AND-reachable check closes that gap. Debug mode on by default removes a step during active development. Removing all fallbacks means broken pathing is immediately visible rather than degrading silently into wall-walking.

### Next Steps
- Verify bot behavior on maps where many resources cluster near walls; confirm rapid goal-cycling does not occur.
- Re-evaluate whether debug mode should be toggled off for any production/release build step.

---

## 2026-03-19 — v2.6.44: PathFollower arrived/unreachable states, no direct fallback

### Summary
PathFollower now exposes explicit `arrived` and `unreachable` boolean flags instead of relying on callers to infer state from a zero direction vector. The direct-direction fallback (walking straight toward a target when A* finds no path) has been removed entirely. BotAI chop/mine goals now act on `unreachable` to abandon and re-evaluate the goal rather than standing still or walking into walls.

### Changes Made
- `src/engine/PathFollower.ts` — Added public `arrived` and `unreachable` flags. Both reset to false at the start of every `moveTo` call. `arrived=true` is set when the entity is within 4px of target or after exhausting all waypoints. `unreachable=true` is set (and (0,0) returned) when A* finds no path — replaces the old direct-direction fallback.
- `src/ai/BotAI.ts` (chop/mine state) — Replaced the `dir.x === 0 && dir.y === 0` arrived-heuristic with `pathFollower.arrived`. Added an `unreachable` check before the arrived check: if the path cannot be found, `goalAge` is set to 999 to force goal re-evaluation on the next frame, so the bot picks a different, reachable resource.

### Rationale
The previous (0,0) heuristic was ambiguous — it could mean "arrived" or "no path found." Distinguishing the two states eliminates the scenario where bots stood motionless in front of walled-off resources. The three clear states (moving, arrived, unreachable) make caller logic unambiguous and easier to extend.

### Next Steps
- Verify bot behavior on maps with heavily clustered obstacles where many resources may be unreachable simultaneously (rapid goalAge cycling).
- Consider adding a short cooldown before a resource is re-evaluated as unreachable to avoid per-frame thrashing.

---

## 2026-03-19 — v2.6.43: Fix bot getting stuck near obstacles — PathFollower + BotAI

### Summary
Two targeted fixes eliminating scenarios where the bot would move into walls or attack through solid obstacles instead of properly navigating around them.

### Changes Made
- `src/engine/PathFollower.ts` — Removed "direct movement if < 32px" shortcut. Now ALWAYS routes through A* regardless of distance. Returns (0,0) only when truly at target (< 4px). Previously a 30px straight-line distance through a wall would bypass A* and drive the bot directly into the obstacle.
- `src/ai/BotAI.ts` (chop/mine) — Removed `dist < 48` fallback from the attack range check. Now relies exclusively on PathFollower's arrived signal (returns 0,0 when the bot reaches the nearest walkable side of the target). Previously a bot at 40px straight-line range would stop and attack even with a wall of rocks between it and the tree.

### Rationale
Both shortcuts were well-intentioned performance/convenience heuristics that broke down when obstacles existed between the bot and its target. Straight-line distance is meaningless in a tiled world with walls — only pathfinding-confirmed proximity should trigger movement stop or attack.

### Next Steps
- Monitor bot behavior on maps with dense obstacle clusters to confirm no new edge cases arise.
- Consider whether the 4px "at target" threshold in PathFollower needs tuning for larger entities.

---

## 2026-03-19 — v2.6.42: BFS wave algorithm for bot reachable-resource detection

### Summary
Replaced the old "top-5 candidates + individual findPath" resource selection in BotAI with a single BFS flood-fill (wave algorithm) run once per frame from the player's position. Resources behind impassable terrain are now completely invisible to the bot — it will always target something it can actually walk to.

### Changes Made
- `src/engine/GridCollisionSystem.ts` — Added `floodFill(wx, wy, maxTiles)` method:
  - BFS expands 8-directionally from the player's world position.
  - Skips blocked tiles via the existing `isBlocked` check.
  - Caps expansion at 300 tiles for consistent per-frame performance.
  - Returns a `Set<string>` of reachable tile keys in `"tx,ty"` format.
- `src/ai/BotAI.ts` — Resource selection rewritten:
  - `floodFill` called once per frame; result reused across all resource candidates.
  - Each resource is checked against the reachable set (own tile + 8 adjacent tiles); unreachable resources are skipped entirely.
  - Replaced the redundant nearest-resource score recomputation with a tracked `bestOverallScore` variable.

### Rationale
The previous approach ran pathfinding on up to 5 candidate resources per frame to detect unreachable ones — O(N * pathfinding). The BFS wave is O(N) and naturally encodes reachability for all resources in a single pass. Trees and ore nodes walled off by rocks no longer confuse the bot into selecting a target it can never reach.

### Next Steps
- Tune `maxTiles` cap (currently 300) based on observed map sizes; larger maps may need a higher value.
- Consider caching the reachable set across frames and only re-running BFS when the player moves more than one tile.

---

## 2026-03-19 — v2.6.41: Fix bot stuck chopping trees through obstacles

### Summary
Rewrote the chop/mine goal logic in BotAI so the bot no longer gets stuck trying to attack a resource through an obstacle. The root cause was a distance-only check (< 56px) that triggered "attack in place" even when a rock or wall separated the bot from the tree — PathFollower was never given a chance to route around the blocker.

### Changes Made
- `src/ai/BotAI.ts` — Chop/mine case rewritten:
  - `moveToWithPathfinding()` is always called first (one call, no duplication).
  - PathFollower signals arrival by returning `(0, 0)` when the bot reaches the nearest walkable side of the target.
  - Bot attacks and stands still if `arrived` (PathFollower returned zero vector) OR raw distance < 48px.
  - Otherwise the returned direction vector drives movement — no separate "can I reach" check needed.

### Rationale
The previous logic ran `moveToWithPathfinding()` only in the `else` branch, meaning the pathfinder was never invoked when the bot was within 56px. If an obstacle sat between the bot and the tree at that range, the bot would spam attacks at the air and never reposition. Calling PathFollower unconditionally lets it navigate around the obstacle while the distance guard (< 48px) still handles the trivial open-field case.

### Next Steps
- Verify the `(0, 0)` arrival signal is consistent across all PathFollower code paths (direct-move bypass included).
- Consider a unified "arrived at target" predicate on PathFollower to avoid re-implementing the zero-vector check at each call site.

---

## 2026-03-19 — v2.6.40: Extract PathFollower — universal A* class for all AI

### Summary
Introduced `src/engine/PathFollower.ts` as a shared, self-contained pathfinding unit. All A* state previously scattered across BotAI and EnemyBrainSystem has been consolidated into this class. Both AI systems now hold a PathFollower instance and delegate movement routing entirely to it.

### Changes Made
- `src/engine/PathFollower.ts` (NEW) — Universal A* helper with:
  - `moveTo(fromX, fromY, toX, toY)` returning a normalised direction vector
  - Nearest-side approach: when the target tile is blocked, tests all 8 adjacent tiles and routes to the closest one to the entity
  - Auto-repath on a 0.8–1.2 s jittered timer or when the target moves more than 60 px
  - Direct movement bypass for distances under 32 px
  - `tick(dt)`, `clearPath()`, `getPath()`, `getPathIdx()` for lifecycle management and debug access
- `src/ai/BotAI.ts` — Removed `path`, `pathIdx`, `repathTimer`, `pathTarget` fields; replaced with a single `PathFollower` instance. `moveToWithPathfinding()` is now a one-liner delegation. Chop/mine attack range raised from ~40 px to 56 px. Orbit-into-wall behaviour removed: the bot stands still while chopping instead of circling.
- `src/ai/EnemyBrainSystem.ts` — Replaced inline `chaseWithPathfinding()` logic with a `Map<entity, PathFollower>`. Debug properties `_aiPath` and `_aiPathIdx` are still written for overlay rendering.
- `src/scenes/GameScene.ts` — Debug overlay now draws a cyan intent line when no A* path is active, visualising the bot's direct-movement target vector.

### Rationale
The old approach duplicated repath logic in two separate AI systems and made it easy for them to drift out of sync. Extracting PathFollower gives a single, tested implementation with consistent nearest-side routing and jittered repath timing. Raising the chop range to 56 px and dropping orbit behaviour fixes bots getting wedged into walls during resource gathering.

### Next Steps
- Add unit tests for PathFollower nearest-side selection edge cases.
- Consider exposing PathFollower repath interval as a constructor parameter for tuning different AI speeds.

---

## 2026-03-19 — v2.6.39: Fix BotAI direct-move threshold 100px -> 32px

### Summary
Reduced the distance threshold that bypasses A* pathfinding from 100px down to 32px (one tile). Bots were walking straight into walls and getting stuck whenever an obstacle sat between them and their target at close range.

### Root Cause
`moveToWithPathfinding()` had a short-circuit: if the straight-line distance was under 100px it skipped A* and moved directly. At that range the bot can easily be separated from its target by a wall or object, resulting in it pressing into the obstacle indefinitely.

### Changes Made
- `src/ai/BotAI.ts` — Direct-move threshold lowered from `< 100` to `< 32`. A* is now used for any distance beyond the same tile.

### Rationale
32px is one tile width, meaning the bot and target are in the same grid cell. At that scale there is no room for an obstacle to intervene, so skipping A* is safe. Anything farther should route properly.

### Next Steps
- Monitor whether any edge cases remain where 32px still allows wall-clipping at tile boundaries.

---

## 2026-03-19 — v2.6.38: Fix bot pathfinding to approach blocked tiles from nearest side

### Summary
Bots were always pathfinding to the exact center of a target tile, which for blocked tiles (trees, bonfires, buildings) caused A* to either fail or route the bot all the way around to an arbitrary walkable tile — usually top-left. The bot now checks all 8 adjacent tiles and picks the walkable one closest to the player's current position as the A* goal.

### Root Cause
`moveToWithPathfinding()` passed `tx, ty` (the raw target world position) directly to `grid.findPath()`. When the target tile is blocked, A* would struggle to find a path to it and could settle on a distant walkable cell rather than the nearest side.

### Changes Made
- `src/ai/BotAI.ts` — Before invoking A*, the bot converts `tx, ty` to grid coordinates and checks if the tile is blocked. If so, it scans all 8 neighbours, finds the one with the shortest Euclidean distance to the player, and uses that tile centre as `goalX, goalY` for both `findPath()` and `pathTarget`.

### Rationale
Players can interact with resources and buildings from any adjacent tile, so the bot only needs to reach any side, not the exact centre. Picking the nearest side produces natural, direct movement and avoids the "bot runs the long way around" behaviour.

### Next Steps
- If diagonal neighbours are ever blocked by the map layout, extend the fallback to cardinal neighbours only.
- Consider caching the chosen approach tile per target to avoid recalculating every repath cycle.

---

## 2026-03-19 — fix: skip A* for distances < 100px in BotAI pathfinding

### Summary
Bot was invoking A* pathfinding even for very short distances (60-100px), causing it to take long roundabout routes to nearby targets such as the bonfire. `moveToWithPathfinding()` now returns a direct movement vector for distances under 100px and only runs A* for distances >= 100px where obstacle navigation is genuinely needed.

### Root Cause
No minimum distance guard existed before the A* repath block. Any target within the same room would still trigger full grid pathfinding, and the resulting path could loop around the grid rather than head straight.

### Changes Made
- `src/ai/BotAI.ts` — Added an early-return in `moveToWithPathfinding()`: if `Math.hypot(tx - p.pos.x, ty - p.pos.y) < 100`, return `this.dirTo(p.pos, tx, ty)` directly. Wall sliding for short-range movement is handled by grid collision in GameScene.

### Rationale
A* is unnecessary at close range and can produce worse paths than a straight vector when the bot and target share a clear line of movement. The 100px threshold was chosen to cover the typical gap between adjacent tiles while leaving room for actual obstacle navigation on longer paths.

### Next Steps
- Tune the 100px threshold if bots clip through thin walls at close range.
- Consider a line-of-sight pre-check to use direct movement at any distance when there are no obstacles in the way.

---

## 2026-03-19 — v2.6.37: Fix tree position/collider mismatch in LevelScript

### Summary
Root cause fix for the long-running tree visual/collider mismatch. The sprite was being positioned at `ty*T + T/2 - T` (one tile up from the grid row), while the collider was registered at a separate `colTy` offset. This created a persistent disconnect between what the player sees and what blocks movement.

### Root Cause
The `-T` offset applied to the tree Y position was the original source of the mismatch. All subsequent `colTy` offset logic (ty-1, ty-2) was compensating for this wrong anchor point rather than fixing it.

### Changes Made
- `src/world/LevelScript.ts` — Removed `-T` from tree Y position. Tree is now placed at `(tx*T+T/2, ty*T+T/2)`, the true tile center. Collider registered at the same `(tx, ty)` — no offset needed. Loop start reverted to `ty = 2`. All `colTy` offset logic removed.

### Rationale
With the tree anchor set to `(0.5, 0.8)`, the sprite draws with 80% of its height above the position point and 20% below — the crown extends upward naturally, and the trunk base sits at the tile position. No manual Y offset is required; the anchor handles the visual framing. Collider and visual are now at the same tile.

### Next Steps
- Confirm forest boundaries and road edges look correct in-game.
- Verify gap-fill tile assignment uses the corrected `treeByTile` key (`tx,ty`).

---

## 2026-03-19 — v2.6.36: Move tree collider from ty-1 to ty-2 for better trunk alignment

### Summary
Shifted the tree collider up one additional tile (from `ty-1` to `ty-2`) to better match the visual center of the trunk. Loop start guard updated from `ty >= 3` to `ty >= 4` to keep the collider tile index in bounds.

### Changes Made
- `src/world/LevelScript.ts` — `colTy` changed from `ty - 1` to `ty - 2`. Loop start changed from `ty = 3` to `ty = 4`. Skip check now tests `isPath(tx, colTy) || isClearing(tx, colTy)` using the updated `colTy`.

### Rationale
After v2.6.35 placed the collider at `ty-1`, in-game testing showed the collision boundary still felt slightly low relative to the rendered trunk center. Moving to `ty-2` aligns the walkable collision with the middle of the visible trunk sprite.

### Next Steps
- Test forest/road boundary areas to confirm no phantom collisions or missed gaps.
- Verify gap-fill tile assignment with the updated `treeByTile` key.

---

## 2026-03-19 — v2.6.35: Fix tree collider position — collider at trunk level (ty-1)

### Summary
Tree colliders were being registered one tile below the trunk, overlapping roads and clearings. The collider is now placed at ty-1, matching the trunk's actual visual position. The previous wrong-direction buffer zone (ty+1/ty+2) is removed.

### Root Cause
Tree visuals are drawn at `ty * T - T` (one tile above the grid row). The collider was registered at `ty`, which is one tile below the visual trunk — landing directly on adjacent roads or clearings. The buffer zone added in v2.6.34 compensated in the wrong direction and created awkward planting gaps.

### Changes Made
- `src/world/LevelScript.ts` — Collider grid position changed from `ty` to `colTy = ty - 1`. Loop starts at `ty = 3` so `ty - 1` is always a valid tile. Skip check now tests `isPath(tx, ty-1) || isClearing(tx, ty-1)` instead of the ty+1/ty+2 buffer. `grid.isBlocked` and `treeByTile` map key both use `colTy`.

### Rationale
Placing the collider at ty-1 aligns it with the rendered trunk position. This eliminates phantom collision walls on roads while correctly blocking the tile the tree visually occupies. The wrong-direction buffer is no longer needed.

### Next Steps
- Verify tree colliders visually align with trunks in forest/road transition areas.
- Check `treeByTile` gap-fill logic still assigns correctly with the updated tile key.

---

## 2026-03-19 — v2.6.34: Tree planting 2-tile buffer above paths/clearings

### Summary
Trees are no longer planted when the tile at ty+1 or ty+2 is a path or clearing. This creates a 2-tile buffer zone below each tree candidate, preventing tree colliders from overlapping roads.

### Root Cause
Tree visuals extend approximately one tile downward from their grid position (ty). A tree planted at ty=5 would render its trunk/base near ty=6, placing its collider on top of whatever occupies that tile. On roads and clearings this caused invisible collision walls mid-path and visually narrowed roads.

### Changes Made
- `src/world/LevelScript.ts` — Added two early-continue checks inside the tree-planting loop: skip if `isPath(tx, ty+1) || isClearing(tx, ty+1)`, and skip if `isPath(tx, ty+2) || isClearing(tx, ty+2)`. The existing check for the tile's own position (ty) remains.

### Rationale
A 2-tile lookahead is sufficient because tree visuals extend at most 1 tile below their grid row. Checking ty+2 as well provides a small visual breathing room so tree canopies don't visually crowd the road edge.

### Next Steps
- Verify road edges look correct in the dungeon/forest transition zones.
- Consider the same buffer for the left/right axes if horizontal path crowding becomes noticeable.

---

## 2026-03-19 — v2.6.33: Fix grid colliders not freed when entities are killed

### Summary
Grid tiles occupied by entities were never freed when an entity was killed because Excalibur's `Actor.kill()` does not call `Component.onRemove()` — it only removes the actor from the scene. This caused killed entities to permanently block pathfinding tiles.

### Root Cause
`GridOccupancyComponent.onRemove()` handled tile cleanup, but `onRemove()` is not invoked by Excalibur's `kill()` flow. Any entity killed (enemies, trees, etc.) left its tiles permanently blocked.

### Changes Made
- `src/components/GridOccupancyComponent.ts` — Extracted tile-freeing logic into a new public `freeTiles()` method. `onRemove()` now delegates to `freeTiles()` as a fallback.
- `src/engine/GameEntity.ts` — Added `onPreKill()` override (which IS called by Excalibur's `kill()` flow). It retrieves the `GridOccupancyComponent` and calls `freeTiles()` before the entity is removed from the scene. Also imported `GridOccupancyComponent`.

### Rationale
Using `onPreKill()` is the correct Excalibur hook for pre-removal cleanup. Keeping `onRemove()` as a backup ensures tiles are freed regardless of the removal path (kill, scene change, or direct component removal).

### Next Steps
- Monitor pathfinding in dense areas to confirm no tile leaks remain after combat.

---

## 2026-03-19 — v2.6.32: Fix gap-fill tile ownership + tree stumps

### Summary
Two tree-related fixes: gap-fill tile ownership is now correctly established during tree creation (not reverse-calculated after the fact), and trees now leave a visible stump when destroyed.

### Changes Made
- `src/world/LevelScript.ts` — `treeByTile` map is now populated inside the tree creation loop using the exact `(tx, ty)` grid coordinates. Removed the old post-loop rebuild that reverse-calculated tile position from entity world position (`Math.floor(e.pos.x / T)` etc.), which was off-by-one and caused gap-fill tiles to remain blocked after a tree was cut.
- `src/scenes/GameScene.ts` — Added `spawnStump(x, y)` method. When a tree resource is killed, a 12x8px brown rectangle actor is placed at ground position (`y + 10`). It is not a collider, sits at `z = -0.5`, waits 20 seconds, then fades out over 3 seconds and calls `.die()`.

### Rationale
The reverse position calculation (`Math.floor((e.pos.y + T) / T)`) produced incorrect tile coordinates due to the visual offset applied during tree placement, meaning the treeByTile map entries never matched gap-fill lookups. Building the map during creation using the raw `tx,ty` loop variables is exact and reliable. The stump provides visual feedback that a tree was harvested without requiring any collision or gameplay logic.

### Next Steps
- Consider a more detailed stump sprite once pixel art assets are available.
- Verify gap-fill freeing is correct in dense forest edge cases.

---

## 2026-03-19 — v2.6.30: Gap-fill collider recalc on tree destroy + corner wall-sliding fix

### Summary
Two movement/collision improvements: gap-fill tiles in forest areas now recalculate when trees are destroyed (clearing a forest properly opens paths), and the player no longer gets stuck on tile corners when moving diagonally into a wall.

### Changes Made
- `src/components/GridOccupancyComponent.ts`:
  - Extended the `_gridSystem` forward-reference type to expose `isBlocked()` and `getSize()`.
  - Added `_gapFillTiles` — a module-level Set tracking tiles that were blocked by the gap-fill algorithm (not by an entity).
  - New exported `markGapFill(tx, ty)` — called by LevelScript to register each gap-fill tile at world generation time.
  - New internal `recalcGapFills(cx, cy)` — after an entity is removed, scans gap-fill tiles within radius 3. For each, counts its 8 blocked neighbors; if fewer than 3 remain blocked the tile is made walkable and removed from the set.
  - `onRemove()` now calls `recalcGapFills()` for each freed tile.
- `src/world/LevelScript.ts`:
  - Imported `markGapFill` from `GridOccupancyComponent`.
  - After `grid.setBlocked()` for each computed gap-fill tile, calls `markGapFill(tx, ty)` so the set is populated at generation time.
- `src/engine/GridCollisionSystem.ts`:
  - `applyGridCollision()` now saves `origVx` / `origVy` before the axis checks.
  - Added a corner-slide block: when both axes come out zero but the original intent was diagonal, re-tests X alone then Y alone. If X alone is clear, slides along X (`vy = 0`); if Y alone is clear, slides along Y (`vx = 0`). Player can now slide along walls when approaching diagonally.

### Rationale
Gap-fill tiles blocked narrow gaps in forest walls to prevent trivial pathfinding exploits. However, once the trees adjacent to a gap-fill tile were destroyed, the blocking tile was never released, leaving invisible walls in cleared areas. The recalculation logic fixes this by re-evaluating validity on entity removal.

The corner-sliding fix addresses a classic grid-collision edge case: pure axis-by-axis checks reject both components when the diagonal hits a corner, but either component alone would be valid movement. The fallback re-test unblocks this scenario without changing behavior for head-on wall collisions.

### Next Steps
- Consider exposing a debug overlay toggle to visualize gap-fill tiles.
- Profile `recalcGapFills` on maps with dense forests to confirm it stays within frame budget.

---

## 2026-03-19 — v2.6.29: Rework death animation — collapse + fade, no rotation

### Summary
Replaced the rotation-based death animation in `GameEntity.playDeath()` with a clean four-phase visual sequence using scale and opacity only. The shadow is now hidden during death via a guard in `ShadowCasterComponent`, preventing it from distorting or rotating with the old fall-over effect.

### Changes Made
- `src/engine/GameEntity.ts`:
  - Removed random `rotateTo` call that caused the sprite to spin sideways on death.
  - Phase 1: Red flash — opacity blinks 0.8 → 1.0 → 0.6 over 200ms to sell the hit.
  - Phase 2: Collapse — `scaleTo` shrinks scaleY to 0.3 (entity squishes flat, simulating falling to the ground) while scaleX expands slightly.
  - Phase 3: Lie on ground — opacity 0.5 for 3 seconds.
  - Phase 4: Fade out — `fade(0, 3000)` then `kill()`.
  - Updated JSDoc comment to reflect the new sequence.
- `src/components/ShadowCasterComponent.ts`:
  - Added an early-return guard at the top of the update/draw path: if `actor.isDying` is true, sets `shadowVisible = false` and returns immediately.
  - Shadow no longer renders, rotates, or distorts during the death animation.

### Rationale
The previous rotation-based death looked unconvincing and broke the shadow — the ellipse shadow would rotate with the sprite, visually flying off into the wrong position. The new sequence keeps the sprite upright and flat, which reads clearly as "fallen" in a top-down/isometric context, and the hidden shadow avoids any visual artefacts during the animation.

### Next Steps
- Could add a brief screen-shake or particle burst on death for extra impact.
- Consider pooling dead entities instead of killing them if performance becomes a concern.

---

## 2026-03-19 — v2.6.28: Bot clears resources blocking build spots before building

### Summary
The bot AI now detects when a build spot tile is occupied by a resource entity (tree, rock, etc.) and clears it before attempting to build. A new "Clear Build Spot" decision tree node sits between Feed Fire and Build in priority, ensuring the bot actively removes obstacles rather than ignoring blocked spots indefinitely.

### Changes Made
- `src/scenes/GameScene.ts`:
  - `runBuildSpots`: added a `continue` guard — if the spot's tile is blocked (`grid.isBlocked`), skip auto-build entirely.
  - `availableBuildSpots` passed to BotAI now filters out spots whose tile is blocked, so the bot never tries to build where it cannot.
  - New `blockedBuildSpots` array passed to BotAI — unlocked spots whose tile is currently blocked, giving the bot a target list to clear.
- `src/ai/BotAI.ts`:
  - `BotGameState` interface gains `blockedBuildSpots: Array<{ wx, wy }>`.
  - `BotContext` interface gains `blockerResource: GameEntity | null`.
  - Context builder iterates `blockedBuildSpots`, searches nearby entities with a `ResourceComponent` within a 60px radius, and assigns the closest one as `blockerResource`.
  - New decision tree node "Clear Build Spot": fires when `blockerResource !== null` and `hpRatio >= 0.4`; emits a `chop` goal targeting the blocking entity.
  - Priority: Feed Fire > Clear Build Spot > Build.

### Rationale
Previously the bot would simply never build if a resource happened to occupy the build spot tile, silently stalling progression. By separating "blocked" spots from "available" spots and giving the bot an explicit goal to clear obstacles, build progression is now fully automated — the bot recognises the blocker, removes it, then proceeds to build on the next tick.

### Next Steps
- Could extend blocker detection to handle other entity types beyond ResourceComponent if non-resource entities can occupy build tiles.

---

## 2026-03-19 — v2.6.27: Fix shadow positioning for entity anchor/pivot

### Summary
Replaced the `entityHeight` parameter on `ShadowCasterComponent` with `feetOffset` — a direct pixel offset from `entity.pos.y` to the ground contact point. This correctly handles entities with different anchor points, particularly trees whose anchor is near the bottom of the sprite.

### Changes Made
- `src/components/ShadowCasterComponent.ts`:
  - Replaced `entityHeight` constructor option with `feetOffset` (default 8).
  - Shadow Y origin is now `feetOffset` below `entity.pos.y` instead of `entityHeight * 0.35`, which was pushing shadows too far down for bottom-anchored sprites.
  - Cleaned up stale comments from the original game formula block.
- `src/entities/EntityFactory.ts`:
  - Tree (anchor 0.8): `feetOffset: 2` — pos is nearly at trunk base, minimal offset needed.
  - Player (anchor 0.5): `feetOffset: 10` — feet are ~10px below the centered pos.
  - Enemy (anchor 0.5): `feetOffset: Math.round(def.size * 0.4)` — proportional to enemy size.

### Rationale
The old `entityHeight * 0.35` formula was designed assuming a centered anchor (0.5). Trees use anchor 0.8, so their `pos.y` is already close to the ground — applying an additional height-based offset pushed the shadow well below the tree's actual base, making it visually detached. The `feetOffset` parameter makes the intent explicit per entity type and correctly handles any anchor configuration.

### Next Steps
- Could expose `feetOffset` via entity config/definition rather than hard-coding in the factory.

---

## 2026-03-19 — v2.6.26: Hit sparks on resource attacks

### Summary
Added per-hit particle sparks when the player attacks a resource node (wood, stone, metal). Each hit spawns 4-8 small rectangular particles with resource-appropriate colors that spray outward with an upward bias and fade out over 300-500ms.

### Changes Made
- `src/scenes/GameScene.ts`:
  - `spawnHitSparks(x, y, resourceType)` — new private method that creates a burst of `ex.Actor` particles at the hit position. Color palettes are keyed by resource type: brown/tan for wood, grey/white for stone, copper/bronze for metal. Each particle gets a random size (1.5-3.5px rectangle), a random outward velocity with a -30 upward bias, and an `actions.fade` over 300-500ms followed by `.die()`.
  - Attack handler updated to call `spawnHitSparks` on every hit (before the kill check), so feedback fires whether or not the resource survives the hit.

### Rationale
Without per-hit feedback, chopping or mining feels unresponsive — the only visual confirmation of a hit was the resource disappearing on the final blow. The sparks give immediate tactile feedback on every swing, matching the expectation players have from similar action/survival games. Particles self-destruct via Excalibur's action system so there is no manual cleanup required.

### Next Steps
- Could add a small screen-shake or sound cue to reinforce the hit feel further.

---

## 2026-03-19 — v2.6.25: Fix entities getting stuck inside colliders

### Summary
Added a stuck-entity recovery system that detects and resolves cases where the player or enemies end up inside blocked tiles (trees, rocks, buildings). Also fixed enemy spawning to never place enemies inside blocked tiles.

### Changes Made
- `src/engine/GridCollisionSystem.ts`:
  - `pushOutOfBlocked(wx, wy)` — if the given world position is inside a blocked tile, searches an expanding ring (radius 1–5 tiles) for the nearest walkable tile and returns its center. Returns `null` if the entity is not stuck.
  - `findWalkableNear(wx, wy)` — convenience wrapper used by spawning; returns the original position if it is already walkable, otherwise delegates to `pushOutOfBlocked`.
- `src/scenes/GameScene.ts`:
  - `pushEntitiesOutOfBlocked()` — runs first in every `onPreUpdate` frame. Checks the player and all living enemies; if any are inside a blocked tile, teleports them to the nearest walkable center and zeroes their velocity.
  - Enemy spawning updated to call `findWalkableNear()` on the raw spawn coordinates, ensuring enemies never materialize inside trees, rocks, or buildings.

### Rationale
Two gameplay actions can trap entities inside solid tiles: placing a building on a tile an entity is standing on, and the forest gap-filling pass converting open tiles to trees after an entity has walked onto them. Without recovery, affected entities become permanently stuck. The per-frame push-out covers both scenarios without requiring changes to the building or forest systems.

### Next Steps
- If entities are frequently getting trapped, consider adding a debug overlay that highlights blocked-tile violations per frame.
- The ring search cap of 5 tiles (25-tile radius worst case) is conservative; raise it if very dense obstacle clusters appear in later waves.

---

## 2026-03-19 — docs: add interactive architecture visualization page

### Summary
Added `public/architecture.html` — a self-contained interactive reference page (548 lines) for navigating the full project architecture without reading source code. The page has 6 tabs:

1. **Project Structure** — all modules listed and color-coded by type (scenes, AI, entities, components, systems, config, utils).
2. **Game Objects** — every entity type (Player, Bot, Enemy variants, Turret, Building, Drop, Projectile) with its attached components listed.
3. **Components** — all 15 components with name, purpose, and key properties documented.
4. **AI Systems** — bot goal decision tree and per-enemy-type decision trees shown as structured flowcharts.
5. **Data Flow** — the per-frame update loop call order and the full entity lifecycle (spawn → update → death → cleanup).
6. **Config & Stats** — all game balance tables: enemy HP/speed/damage, build costs, resource values, turret stats, etc.

### Changes Made
- `public/architecture.html` (new, 548 lines): single-file HTML/CSS/JS, no external dependencies, served statically.

### Rationale
The codebase has grown across many modules and the architecture is not obvious from directory browsing alone. This page gives any developer (or AI assistant) a fast, visual entry point to understand how systems connect before diving into source files.

### Next Steps
- Keep the page updated as new components or entity types are added.
- Consider linking it from the project README or a dev-tools nav menu.

---

## 2026-03-19 — v2.6.24: Fix bot stuck trying to build — affordability + build spot snapping

### Summary
Three coordinated fixes eliminate the bug where bots would walk to a build spot but then stand there indefinitely, unable to actually construct anything.

1. **BotAI — inventory-only affordability check**: The bot's affordability calculation previously summed inventory resources AND drops lying on the ground. This caused the bot to believe it could afford a build, walk to the spot, then fail because the drops were never picked up. Now only inventory contents are counted; the bot routes through "Gather for Build" to collect drops or mine resources before attempting construction.

2. **BotAI — shouldSwitchGoal build escape**: Added a guard that immediately returns `true` (switch goal) when the current goal is `'build'` but `affordableBuildSpot` is `null`. Prevents the bot from standing at a build spot indefinitely after resource counts change mid-goal.

3. **GameScene — build spot snapping to walkable tile**: Build spot world positions are now validated against the walkable grid. If the calculated position lands on a blocked tile (tree, rock), the code searches expanding rings up to 4 tiles to find the nearest walkable cell and snaps the spot there. If no walkable tile is found within the search radius the spot is skipped entirely.

### Changes Made
- `src/ai/BotAI.ts`:
  - Removed `dropCounts` accumulation from build spot analysis.
  - Affordability check: `have = (res as any)[r] ?? 0` (inventory only, no drop offset).
  - `shouldSwitchGoal`: early return `true` when `currentGoal.type === 'build'` and `_ctx.affordableBuildSpot === null`.
- `src/scenes/GameScene.ts`:
  - After computing `wx`/`wy` for each build spot, check `isBlocked(ttx, tty)`.
  - Expanding ring search (`r = 1..4`, perimeter-only `dx/dy` iteration) finds nearest walkable tile.
  - `continue` skips spot if no walkable tile found within 4-tile radius.

### Rationale
The root cause was an optimistic affordability assumption: counting ground drops as "available" without accounting for the pickup step. Fixing affordability to reflect actual inventory state keeps the goal-switching logic consistent. The build spot snapping is a complementary fix ensuring bots are never sent to structurally unreachable construction sites.

### Next Steps
- Monitor bot gather loops to confirm drops are reliably collected before build attempts.
- Consider a maximum gather-loop retry count to prevent bots getting stuck if drops are unreachable.

---

## 2026-03-19 — v2.6.23: Fix black areas in deep forest with proper ground texture

### Summary
Deep forest areas previously showed near-black gaps between tree sprites because the base ground color was almost invisible and no ground texture was drawn beneath trees. Three coordinated fixes eliminate this:

1. Base ground color brightened from `#050a02` to `#0f1a08` (visible dark forest green instead of near-black).
2. Every world tile not already covered by a Wang path/clearing transition tile now receives the full-forest ground sprite (`wangIdx=0` from `ground-tileset.png`) at `z=-9`, sitting between the base color layer (`z=-10`) and Wang transition tiles (`z=-8`).
3. The forest tile pass uses a chunked 4x4 grid scan for performance, rendering individual tiles only in chunks that partially overlap the Wang render set.

### Changes Made
- `src/world/LevelScript.ts`:
  - Base chunk color: `#050a02` → `#0f1a08`.
  - Added comment above Wang tile render loop.
  - New forest floor fill block after Wang tile rendering: iterates all world tiles in 4x4 chunks, skips tiles already in `renderSet`, places `forestSprite` at `z=-9` for remaining tiles.

### Rationale
Wang tiles only cover path edges and clearing borders. Pure deep-forest tiles had no texture assigned, leaving the base color (previously near-black) fully exposed between tree sprites. Tiling the `wangIdx=0` forest sprite everywhere provides a consistent ground layer that eliminates all black gaps.

### Next Steps
- Profile scene entity count to confirm the extra forest-floor actors do not cause frame-rate issues at full world size.
- Consider using a TileMap or sprite batch if actor count becomes a bottleneck.

---

## 2026-03-19 — v2.6.22: Fix turret targeting + HP bar for dying enemies

### Summary
Two fixes to correctly handle enemies in the `isDying` state (death animation in progress):
1. Turrets no longer target dying enemies — `BuildingComponent` now skips enemies where `isDying` is true, alongside already-skipped killed enemies.
2. HP bars are removed as soon as an enemy starts dying, not only after `isKilled()` — `GameScene` now checks `isDying` in the HP bar cleanup condition.

### Changes Made
- `src/components/BuildingComponent.ts`:
  - Targeting loop: `if (e.isKilled() || e.isDying) continue;`
- `src/scenes/GameScene.ts`:
  - HP bar update loop: `if (e.isKilled() || e.isDying)` triggers cleanup.

### Rationale
After the death animation was introduced (v2.6.20), turrets would continue firing at corpses and HP bars would float over fallen enemies for the full 6-second death sequence. Both issues are visual/logical inconsistencies that made the game feel unpolished.

### Next Steps
- Verify no other targeting or display systems reference enemies without checking `isDying`.

---

## 2026-03-19 — v2.6.21: Double tree shadow length via entityHeight 40→80

### Summary
Increased the `entityHeight` parameter passed to `ShadowCasterComponent` for trees from 40 to 80, making all tree shadows twice as long.

### Changes Made
- `src/entities/EntityFactory.ts`:
  - `ShadowCasterComponent` for tree entities: `entityHeight` changed from `40` to `80`.

### Rationale
The previous shadow length was too short relative to tree sprite size, making trees look flat and poorly grounded in the scene. Doubling the height produces more convincing, dramatic shadows that better convey tree scale.

### Next Steps
- Evaluate whether other tall objects (e.g. rocks, structures) need matching shadow height adjustments for visual consistency.

---

## 2026-03-19 — v2.6.20: Death animation — enemies fall over and fade out instead of instant kill

### Summary
Replaced instant `kill()` calls for enemies with a staged `playDeath()` sequence: a brief opacity flash, a random-direction fall-over rotation, a 3-second pause lying on the ground, and a 3-second fade to zero before the entity is actually removed. Dying entities are excluded from targeting, AI, spawn counts, and HUD display via an `isDying` flag.

### Changes Made
- `src/engine/GameEntity.ts`:
  - Added `public isDying = false` flag.
  - Added `playDeath(onComplete?)` method: guards against double-call, stops velocity, triggers a chained action sequence — opacity 0.7, random `rotateTo` (~35 deg, 4 rad/s), opacity 0.6, `delay(3000)`, `fade(0, 3000)`, then calls `kill()`.
- `src/scenes/GameScene.ts`:
  - Attack targeting filter: excludes `isDying` enemies so a dying enemy cannot be selected as a melee target.
  - Dead-enemy cleanup loop: enemies with `hp.alive === false` now call `playDeath()` and are kept in the list (`return true`) instead of being killed instantly.
  - Enemies that `isKilled()` (fully dead) are still removed; enemies that `isDying` are kept.
  - Spawn quota count (`aliveCount`): excludes `isDying` enemies so dying bodies do not block new spawns.
  - HUD enemy counter: excludes `isDying` enemies from the displayed count.
- `src/ai/EnemyBrainSystem.ts`:
  - Per-enemy update loop now skips entities where `isDying` is true, preventing AI from running on a falling corpse.
- `src/ai/BotAI.ts`:
  - `buildContext` enemy filter now also excludes `isDying` so the bot never targets a dying enemy.

### Rationale
Instant removal made enemy deaths feel abrupt and cheap. The new sequence gives visual feedback that rewards the player — the body lingers long enough to be noticed but fades before cluttering the scene. Keeping dying entities in the list (rather than a separate array) minimises refactoring surface; the `isDying` flag acts as a lightweight gate at every consumption point.

### Next Steps
- Consider a brief red tint flash at the start of `playDeath()` (requires tinting the graphic rather than just reducing opacity).
- Evaluate whether player death should also use `playDeath()`.
- Tune the 3s lie + 3s fade durations based on playtesting — may want shorter for fast-paced waves.

---

## 2026-03-19 — v2.6.19: Shadow uses entity's actual sprite as a black silhouette

### Summary
Rewrote ShadowCasterComponent to render the entity's real sprite tinted black, rather than a generic scaled circle. Trees now cast tree-shaped shadows and characters cast character-shaped shadows. The `entityWidth` parameter is gone — dimensions come directly from the graphic itself.

### Changes Made
- `src/components/ShadowCasterComponent.ts` — complete rewrite:
  - Retrieves `actor.graphics.current` (the entity's live sprite/animation frame).
  - Temporarily sets `graphic.tint = ex.Color.Black`, calls `graphic.draw()`, then restores the original tint.
  - Shadow is drawn at entity feet: `offsetY = entityHeight * 0.35`.
  - Rotation formula: `angle_away_from_light + PI/2` (matches original game).
  - Scale formula: `scaleX = actor.scale.x`, `scaleY = shadowLen * 0.45`.
  - Alpha formula: `max(0.08, 0.45 * edgeFade)` — unchanged from original.
  - Removed `entityWidth` constructor parameter — no longer needed.
  - Removed `shadowRadius`, `shadowX`/`shadowY` — replaced with `shadowOffsetX`/`shadowOffsetY` and `shadowRotation`.
- `src/entities/EntityFactory.ts` — simplified three `ShadowCasterComponent` constructor calls to pass `entityHeight` only (removed `entityWidth` argument for player, enemy, and tree).

### Rationale
The ellipse-from-circle approach was a geometric approximation that broke the visual identity of each entity — a tree's shadow looked the same as a person's. Using the entity's actual sprite as the shadow source gives faithful silhouettes at zero extra asset cost. Tint manipulation is cheap (no extra draw call overhead) and the tint is immediately restored so it never bleeds into the normal render pass.

### Next Steps
- Playtest shadow orientation on trees (tall sprites may need a draw-origin adjustment).
- Consider caching the tint restore so it is resilient if `graphic.tint` is undefined.

---

## 2026-03-19 — v2.6.18: Shadow drawn inside entity graphics pipeline, no separate actor

### Summary
Rewrote ShadowCasterComponent to draw the shadow via the entity's own `graphics.onPreDraw` callback rather than creating a separate shadow actor. The shadow is now entirely internal to the entity — no orphaned actors, no manual cleanup, and automatic destruction when the entity is killed.

### Changes Made
- `src/components/ShadowCasterComponent.ts` — full rewrite:
  - Removed `shadowActor: ex.Actor` — no separate actor is created or managed.
  - Added `installDraw()` which hooks into `actor.graphics.onPreDraw` to draw the shadow ellipse inline.
  - Shadow parameters (`shadowX`, `shadowY`, `shadowAngle`, `shadowScaleX`, `shadowScaleY`, `shadowAlpha`, `shadowRadius`) are computed in `onPreUpdate` and consumed in the `onPreDraw` callback.
  - Uses `ctx.drawCircle` with `ctx.scale` to produce the ellipse shape — same visual result as before.
  - `onRemove()` deleted — no cleanup needed since there is no external actor to kill.
  - `shadowVisible` flag gates the draw call so nothing is rendered when no qualifying light is nearby.
  - Same formulas retained: `shadowLen = min(1.2, 400 / (dist + 50))`, `alpha = max(0.08, 0.45 * edgeFade)`, direction away from nearest light.

### Rationale
The previous approach spawned a child actor into the scene for each entity's shadow. This created a subtle lifecycle problem: if the entity was killed before the shadow actor was cleaned up, the shadow could persist as an orphan. Embedding the draw call directly in the entity's graphics pipeline eliminates that class of bug entirely and simplifies the component — no scene management, no z-ordering coordination, no kill/remove bookkeeping.

### Next Steps
- Verify shadow renders correctly in world space (onPreDraw coordinate space vs. entity transform space may need a feetOffsetY tweak during playtesting).
- Consider soft-edge shadow (radial gradient) if the hard ellipse looks too sharp on varied terrain.

---

## 2026-03-19 — v2.6.17: Elliptical shadow with bonfire wobble

### Summary
Replaced the grey rectangle shadow with a properly shaped elliptical ground shadow. The shadow now looks like it lies flat on the ground, is offset from entity feet in the direction away from the light, and dances with the bonfire firelight using the same wobble math as the fog shader.

### Changes Made
- `src/components/ShadowCasterComponent.ts` — full rewrite:
  - Shadow graphic changed from `Rectangle` to `Circle` scaled into an ellipse via `actor.scale`.
  - Alpha raised to max 0.45 (was 0.35); min raised to 0.08 (was 0.05) — visibly darker shadows.
  - Shadow positioned offset from entity feet in the light-away direction. Y component multiplied by 0.5 to flatten it for ground perspective.
  - Scale X stretches along the shadow direction; scale Y stays flat (0.3–0.45 range) for a ground-plane look.
  - Constructor now accepts `{ entityWidth, entityHeight }` for proper ellipse proportions.
  - Removed per-frame graphic-resize logic (no longer needed with scale-based approach).
- `src/entities/EntityFactory.ts`:
  - Player: `ShadowCasterComponent({ entityWidth: 14, entityHeight: 24 })`
  - Enemies: `ShadowCasterComponent({ entityWidth: def.size, entityHeight: def.size })`
  - Trees: `ShadowCasterComponent({ entityWidth: 20, entityHeight: 40 })`
- `src/scenes/GameScene.ts`:
  - Bonfire light positions for shadow calculation now apply a sin/cos wobble (matching the fog shader's seed + frequency constants), so shadows sway with the firelight every frame.

### Rationale
The grey rectangle shadow was visually incorrect — it appeared as a solid block rather than a ground shadow. The new ellipse, rotated and scaled, reads as a cast shadow lying on the ground plane. Syncing shadow wobble with the fog shader makes the lighting feel cohesive.

### Next Steps
- Tune ellipse proportions per entity type if needed after playtesting.
- Consider adding a soft gradient to the shadow (radial gradient ellipse) for even softer edges.

---

## 2026-03-19 — v2.6.16: Rewrite shadow system to match original game

### Summary
Replaced the ellipse-based shadow approximation with a rectangle-based shadow that faithfully replicates the original game's shadow formulas. Shadows are now much more visible, correctly sized relative to each entity's sprite, and use the exact same length/alpha math as the original.

### Changes Made
- `src/components/ShadowCasterComponent.ts`:
  - Shadow graphic changed from a scaled `Circle` to a `Rectangle` sized at `width * 0.9` by `height * 0.7` of the entity's current sprite dimensions.
  - Shadow length formula: `shadowLen = min(1.2, 400 / (dist + 50))` — closer to light produces a longer shadow, matching the original game exactly.
  - Alpha formula: `opacity = max(0.05, 0.35 * edgeFade)` — 35% at center, fading to 5% at the light radius edge, matching the original.
  - Shadow is rotated `angle + PI/2` (away from light, +90° for anchor orientation) and anchored at entity feet (`anchor.y = 0.9`).
  - Shadow size dynamically updates each frame when the entity's active graphic changes dimensions (e.g., sprite sheet frame size changes).
  - Z-offset tightened from `-0.5` to `-0.1` to stay just below the parent.
  - Constructor parameter changed from `{ width, height }` (old ellipse dims) to `{ entityHeight }` (entity sprite height).
- `src/entities/EntityFactory.ts`:
  - Player: `ShadowCasterComponent({ entityHeight: 24 })`
  - Enemies: `ShadowCasterComponent({ entityHeight: def.size })`
  - Trees: `ShadowCasterComponent({ entityHeight: 40 })`

### Rationale
The previous circle-scaled-to-ellipse approach produced a barely visible shadow at incorrect angles. The original game used a flat rectangle at the entity's feet stretched away from the light — this commit restores that behavior using the same distance and alpha formulas, making shadows immediately visible and physically correct.

### Next Steps
- Evaluate whether a slight blur or gradient on the rectangle would further soften the shadow edge.
- Consider exposing a per-entity shadow opacity multiplier for fine-tuning (e.g., flying enemies casting faint shadows).

---

## 2026-03-19 — v2.6.15: Debug overlay A* paths — lines + dots

### Summary
Improved the debug overlay path visualization in GameScene. Waypoints are now connected by thin line segments drawn from the entity's current position through each consecutive waypoint, in addition to the existing dots. This makes the intended path direction and continuity immediately readable at a glance.

### Changes Made
- `src/scenes/GameScene.ts`:
  - Extracted a `drawPath()` helper function (local const inside `renderDebugOverlay`) accepting the waypoint array, start index, start position, dot color, and line color.
  - Lines: for each pair of consecutive points (starting from the entity's current world position to the first waypoint, then waypoint-to-waypoint), a `Rectangle` actor of width equal to the segment length and height 1.5px is created, centered on the midpoint, and rotated to `Math.atan2(dy, dx)`. Segments shorter than 1px are skipped.
  - Dots: `Circle` radius increased from 2 to 3; z-index raised to 8002 (above lines at 8001) so they always render on top.
  - Player bot path: green lines (`rgba(0,255,0,0.4)`) and green dots (`rgba(0,255,0,0.8)`).
  - Enemy paths: orange lines (`rgba(255,100,0,0.3)`) and orange dots (`rgba(255,100,0,0.7)`).
  - Both paths now call the shared `drawPath()` helper, removing the duplicate loop logic.

### Rationale
Dots alone made it hard to determine path direction or spot gaps between waypoints — especially when waypoints are far apart. Connected line segments immediately convey direction and segment length, making it easier to diagnose pathfinding quality and spacing during development.

### Next Steps
- Consider adding arrowheads at line endpoints to make direction even clearer.
- Evaluate whether per-layer toggles (blocked tiles / player path / enemy paths) would further reduce visual noise during focused debugging.

---

## 2026-03-19 — v2.6.14: Debug overlay + pickup radius increase

### Summary
Added a bottom-left corner "Debug" checkbox to GameScene that renders diagnostic overlays directly onto the game stage. When enabled, blocked grid tiles are highlighted in red, player bot A* waypoints appear as green dots, and enemy A* waypoints appear as orange dots. Rendering is viewport-culled so only on-screen tiles are drawn. Unchecking clears all debug actors immediately. Also increased PICKUP_RADIUS from 40 to 50px so the bot can reliably collect drops that land close to wall colliders, and added a `getSize()` accessor to GridCollisionSystem to support the debug viewport bounds calculation.

### Changes Made
- `src/scenes/GameScene.ts`:
  - Debug checkbox element created and positioned in the bottom-left corner of the DOM overlay.
  - `renderDebugOverlay()` method: iterates blocked grid cells, clips to camera viewport, draws red semi-transparent `Graphics` squares for each collider tile, green circle actors for player bot A* path waypoints, and orange circle actors for enemy A* path waypoints.
  - `clearDebugActors()` method: removes and destroys all debug actors from the stage and clears the tracking array.
  - Checkbox change handler: calls `renderDebugOverlay()` on check and `clearDebugActors()` on uncheck.
- `src/engine/GridCollisionSystem.ts`:
  - `getSize()` method added, returning `{ cols, rows }` so callers can determine grid dimensions without reaching into private fields.
- `src/config.ts`:
  - `PICKUP_RADIUS` increased from `40` to `50`.

### Rationale
The debug overlay accelerates diagnosis of pathfinding and collision issues — previously these required adding temporary console logs or guessing from movement behavior. The viewport culling keeps the overlay lightweight even on large maps. The pickup radius increase addresses a recurring issue where the bot pathfinds to a drop but stalls when the item lands within 1–2 tiles of a wall and the 40px radius falls short of the drop's actual position.

### Next Steps
- Consider making debug overlay layers individually toggleable (colliders / player path / enemy path) via separate checkboxes.
- Evaluate whether PICKUP_RADIUS needs further tuning once new maps with denser collider layouts are tested.

---

## 2026-03-19 — v2.6.13: Bot AI — smart resource targeting by type with truthful status

### Summary
The bot now tracks the best available resource entity per type (wood, stone, metal) using a balanced distance score, and targets the specific resource type required for each goal. Status messages are truthful and specific. If a needed resource type does not exist on the map or as a ground drop, the goal node fails cleanly and the bot moves on — no stuck behavior.

### Changes Made
- `src/ai/BotAI.ts`:
  - `BotContext.bestResourceByType: Record<string, { entity: GameEntity; dist: number; score: number }>` — new field storing the best harvestable entity per resource type (wood/stone/metal). Uses the same weighted score as the old single-resource scan (60% player dist + 40% camp dist). References are live `GameEntity` objects that auto-invalidate when the entity is killed.
  - Context builder loop now reads `ResourceComponent.resourceType` and upserts into `bestResourceByType` per type, while still maintaining the legacy `nearestResource` / `nearestResourceDist` for backward compatibility.
  - **"Chop/Mine for Build"** node `check`: now validates that `bestResourceByType[neededType]` exists rather than just `nearestResource !== null`. If the specific resource type is absent from the map, the node returns `false` and the parent subtree fails.
  - **"Chop/Mine for Build"** node `goal`: targets `bestResourceByType[need].entity` directly. Status label: `"Mine stone for TURRET (need 5)"` / `"Mine metal for WEAPON SHOP (need 2)"` etc.
  - **"Gather Wood"** node `check`: now requires `bestResourceByType['wood'] !== undefined` instead of `nearestResource !== null`.
  - **"Gather Wood"** node `goal`: targets `bestResourceByType['wood'].entity` directly. Status label: `"Chop Wood (need N)"`.

### Rationale
Previously all resource gather goals routed to the single nearest resource regardless of type, which meant a bot needing stone could walk to a wood tree and get stuck trying to harvest the wrong entity. Storing best-per-type references eliminates the mismatch and also gives truthful, actionable status messages that make bot behavior easier to debug.

### Next Steps
- Evaluate whether `bestResourceByType` should respect a per-type cap on max distance beyond which the type is treated as unavailable.
- Consider exposing resource type availability to the build priority ranker so it can deprioritize builds whose inputs are entirely absent from the map.

---

## 2026-03-19 — v2.6.12: Bot AI picks up resource drops from the ground

### Summary
The bot AI can now see and collect resource drops lying on the ground. `BotGameState` is extended with a `drops[]` array populated each tick by `GameScene`. The context builder locates the nearest useful drop and the nearest any drop. Ground drops are also folded into building affordability checks, and two new behavior-tree nodes route the bot to pick them up before chopping or mining.

### Changes Made
- `src/ai/BotAI.ts`:
  - New `BotDrop` interface (`x`, `y`, `type`).
  - `BotGameState.drops: BotDrop[]` field added; default initialized to `[]`.
  - Context builder computes `nearestDrop`, `nearestDropDist`, `nearestNeededDrop`, `nearestNeededDropDist` — preferred types are those missing from inventory for any unlocked build spot, plus wood (always useful).
  - Affordability check now adds `dropCounts[r]` per resource to the `have` value; `missingAmt` still measures only what is missing from inventory so gather goals are not over-reduced.
  - `'pickup'` speed multiplier added (`0.5`).
  - `'pickup'` status label: `"Picking up"`.
  - "Gather for Build" node converted from a leaf to a parent with two children: **"Pick Up for Build"** (fires when a needed drop is within 200 px) and **"Chop/Mine for Build"** (original behavior).
  - **"Pick Up Drops"** general node added after the level-up subtree and before "Gather Wood"; fires when any drop is within 120 px.
  - New `case 'pickup'` in the velocity dispatcher: calls `moveToWithPathfinding` toward the drop position; auto-pickup is handled by `GameScene.runDropPickup()` on proximity.
- `src/scenes/GameScene.ts`:
  - Bot state update now maps `this.drops` (filtered to live, non-flying actors) into `{ x, y, type }` objects and passes them as `drops`.

### Rationale
Previously the bot ignored all resource drops, even those sitting next to it after a kill or chop. This caused it to mine or chop for resources it could simply walk over. The new system lets the bot opportunistically collect nearby drops before committing to a gather action, and treats ground drops as virtual inventory when deciding whether it can afford a building.

### Next Steps
- Consider a maximum pickup walk distance cap so the bot does not wander far off course for a single drop.
- Evaluate whether drop-count should be weighted (e.g. fractional) to avoid over-estimating available resources.

---

## 2026-03-19 — v2.6.11: Fix grid occupancy initialization + forest wall system

### Summary
Three improvements to world generation in LevelScript. A critical bug where the grid system was set after entity creation (making all tile-blocking calls no-ops) is now fixed. A forest wall pass fills single-tile gaps in dense forest to prevent characters from squeezing through. Tree density thresholds are also lowered for thicker forests.

### Changes Made
- `src/world/LevelScript.ts`:
  - **Critical fix**: Moved `setGridSystem(grid)` call to immediately after grid creation, before any entity spawning. Previously it was called in GameScene after `Level1Script.generate()` returned, meaning all `GridOccupancyComponent.onAdd()` calls during generation fired with `_gridSystem = null` and blocked nothing.
  - **Forest wall pass**: After all trees are placed, iterates every empty tile. If a tile has 3 or more blocked neighbors (including diagonals), it is marked blocked in the grid. This fills single-tile gaps in dense forest, forming solid walls. Logs the fill count (`[Level] Filled N forest gaps`).
  - **Tree density**: Lowered thresholds from `0.25 / 0.7` to `0.15 / 0.55` for dense and medium noise zones, placing more trees and creating thicker forest cover.

### Rationale
The `setGridSystem` ordering bug meant trees, stones, metals, and bonfires were silently failing to register as blocked tiles. Characters could walk through all of them on the grid level. The fix ensures the grid is live before the first entity is constructed. The forest wall pass addresses the pathfinding loophole where a single empty tile between two trees allowed passage — 3494 gaps are filled in the default level configuration.

### Next Steps
- Verify NPC/enemy pathfinding still finds valid routes through the denser forest.
- Consider making the gap-fill neighbor threshold configurable (currently hard-coded at 3).

---

## 2026-03-19 — v2.6.10: Bot prioritizes building over leveling up bonfire

### Summary
Reordered the bot decision tree so that building turrets and outposts takes precedence over leveling up the bonfire. Previously the bot would keep feeding the bonfire to reach the next camp level before constructing any defenses. Now it builds first and levels up afterward.

### Changes Made
- `src/ai/BotAI.ts`: Moved the `Build` and `Gather for Build` nodes above the `Level Up Fire` subtree in the idle decision tree. Added clarifying comments marking `Feed Fire` as maintenance and `Build` as higher priority than leveling up.

### Priority Order After Combat
1. Feed Fire (maintenance, fuel < 85%)
2. Build (if can afford a building)
3. Gather for Build (if building available but missing resources)
4. Level Up Fire (gather + feed to reach next camp level)
5. Gather Wood (for fire fuel)
6. Camp Idle

### Rationale
The old order caused the bot to starve its building queue by continuously funneling wood into the bonfire for level-ups. Defenses (turrets, outposts) provide immediate combat value, so building them first produces better strategic outcomes in actual play.

### Next Steps
- Monitor whether bots now over-invest in buildings at the expense of fire maintenance.
- Consider a hybrid check: build only if fuel ratio is already healthy (e.g., > 0.5).

---

## 2026-03-19 — v2.6.9: Replace turret texture + add outpost sprite

### Summary
Replaced the turret pixel art (prior version looked like a windmill) with a proper 32x32 wooden guard tower on stilts with a crossbow, generated via PixelLab MCP. Added a new outpost texture — a torch-lit wooden fence enclosure with a campfire (32x32, PixelLab MCP). AssetLoader now registers `outpostSprite`, and EntityFactory applies it when rendering the OUTPOST building type.

### Changes Made
- `public/assets/pixelart/turret.png`: Replaced — new sprite is a wooden guard tower on stilts with crossbow (32x32).
- `public/assets/pixelart/outpost.png`: New asset — torch-lit wooden fence enclosure with campfire (32x32).
- `src/engine/AssetLoader.ts`: Added `outpostSprite` static `ImageSource`; registered alongside `turretSprite` in `allResources`.
- `src/entities/EntityFactory.ts`: Added `else if` branch in `createBuilding` to apply `outpostSprite` when `buildingType === 'OUTPOST'` and the asset is loaded.

### Rationale
The previous turret sprite was visually ambiguous and not readable as a defensive structure. The new tower sprite clearly communicates a guard post. The outpost now has a dedicated texture instead of falling back to the color-coded rectangle, improving overall visual consistency across building types.

### Next Steps
- Consider adding sprites for remaining building types (FORGE, etc.) to eliminate all color-rect fallbacks.

---

## 2026-03-19 — v2.6.8: Bot stands and fights melee enemies, only dodges projectiles

### Summary
Fixed bot combat behavior in the 'kill' goal. Previously the bot would kite backward when an enemy entered attack reach, which caused erratic backpedaling against melee enemies. Now the bot stands still and attacks when within reach, and only moves to dodge an incoming projectile (evasion urgency > 1.0). While still approaching an enemy, the projectile-dodge threshold was also raised from 0.5 to 1.0 and the blend factor increased, so approach pathing is not disrupted by low-urgency evasion signals.

### Changes Made
- `src/ai/BotAI.ts`: In the `kill` goal branch, replaced kite-backward logic (moving away from enemy + pulling toward bonfire) with `vx = 0; vy = 0` when within attack reach. Added projectile-dodge override when `ctx.evasion.urgency > 1.0`. Raised the approach-evasion threshold from 0.5 to 1.0 and increased blend cap from 0.5 to 0.6.

### Rationale
The kiting behavior was designed for ranged combat but was incorrectly applied to melee enemies, making the bot constantly retreat and never land attacks. Standing still forces the bot to trade hits at close range, which is more natural and effective against melee opponents.

### Next Steps
- Consider separate kite logic conditioned on whether the enemy is a ranged type.

---

## 2026-03-19 — v2.6.7: Turret pixel art + arrow projectile + bonfire feed fix

### Summary
Three related improvements to the camp and turret systems. Bonfire feeding was previously blocked whenever fuel exceeded 90%, which prevented level-up progression even when the camp level was not at max — this is now fixed by allowing feeding whenever a level-up is still possible. The turret building now renders a 48x48 medieval wooden arrow tower pixel art sprite (generated via PixelLab MCP) with a rectangle fallback if the asset is not loaded. Turret projectiles are now an 8x2 brown rectangle rotated toward the target, giving an arrow-like appearance instead of the previous orange circle.

### Changes Made
- `public/assets/pixelart/turret.png` (new): 48x48 medieval wooden arrow tower pixel art, generated via PixelLab MCP.
- `src/engine/AssetLoader.ts`: Added `turretSprite` static `ImageSource` pointing to `/assets/pixelart/turret.png`; registered it in the loader list under a `// Buildings` comment block.
- `src/entities/EntityFactory.ts`: `createBuilding` for `TURRET` type now uses `AssetLoader.turretSprite.toSprite()` when loaded, with a fallback rectangle using the original color map.
- `src/components/BuildingComponent.ts`: Turret projectile changed from `ex.Circle({ radius: 3 })` to `ex.Rectangle({ width: 8, height: 2, color: '#AA8844' })`; `proj.rotation` set to `Math.atan2(dir.y, dir.x)` so it faces the target.
- `src/scenes/GameScene.ts`: Bonfire feeding condition split into `needsFuel` (fuel < 90%) and `needsLevelUp` (camp not at max level); feeding is now allowed when either condition is true, fixing the level-up block at full fuel.

### Rationale
The fuel > 90% gate was intended to prevent spam-feeding but inadvertently blocked level-up accumulation entirely once the bonfire was nearly full. By separating the two concerns, the player can always progress through camp levels as long as they have wood.

### Next Steps
- Consider adding pixel art sprites for other building types (OUTPOST, FORGE, etc.)
- Turret arrow projectile could gain a small trail particle effect for visual clarity

---

## 2026-03-19 — v2.6.6: Bot AI actively upgrades bonfire to next level

### Summary
Extended `BotGameState` with `campLevel` and `campFuelAdded` so the bot is aware of the bonfire's current upgrade state. The `buildContext()` method now derives two new context flags — `canLevelUp` (not yet at max fire level) and `woodForLevelUp` (logs required to reach the next fuel threshold). A new "Level Up Fire" decision tree node sits between the regular fire-feeding logic and the build logic; its two children send the bot to feed the bonfire if it already holds wood, or to chop trees if it does not. Status labels report the target level and remaining wood count (e.g., "Feed to Lv.2 (3 wood left)" or "Gather for Lv.2 (need 5 wood)"). `GameScene` now passes `campLevel` and `campFuelAdded` to the bot on every tick.

### Changes Made
- `src/ai/BotAI.ts`:
  - Extended `BotGameState` interface with `campLevel: number` and `campFuelAdded: number`.
  - Extended `BotContext` interface with `canLevelUp: boolean` and `woodForLevelUp: number`.
  - Default `gameState` initialised with `campLevel: 0` and `campFuelAdded: 0`.
  - `buildContext()`: reads `CONFIG.FIRE_LEVELS` and current `campLevel`/`campFuelAdded` to compute `canLevelUp` and `woodForLevelUp` (fuel deficit divided by `FUEL_PER_WOOD`, rounded up).
  - Decision tree: added `'Level Up Fire'` node (requires `canLevelUp` and HP >= 40%) with two children — `'Feed to Level Up'` (has wood + bonfire reachable) and `'Gather for Level Up'` (nearest resource reachable).
  - Both children embed target level and remaining wood count in the `_treePath` status string.
- `src/scenes/GameScene.ts`:
  - Bot state update now passes `campLevel: this.campLevel` and `campFuelAdded: this.campFuelAdded` each tick.

### Priority Order (high to low)
survive → defend camp → counter-attack → kite → fire emergency → combat → feed fire → **level up fire** → build → gather for build → gather wood → idle

### Rationale
Levelling up the bonfire unlocks new build spots, making it a prerequisite for building expansion. Placing the node after basic fire maintenance but before building ensures the bot does not neglect survival while still advancing the camp before spending resources on structures. The two-child structure (feed vs. gather) mirrors the existing fire-feeding pattern, keeping the AI consistent.

### Next Steps
- Confirm `CONFIG.FIRE_LEVELS` thresholds match the game design document
- Test edge case: bot at max fire level should skip the node entirely and proceed to building
- Consider requiring a minimum wood reserve before entering the level-up branch so the bot does not strip all logs and starve the bonfire

---

## 2026-03-19 — v2.6.5: Bot AI can gather resources and build structures

### Summary
Extended `BotGameState` to include `availableBuildSpots` (unlocked, unbuilt spots from `GameScene`). The bot now analyses which spots it can afford and which require more resources, then acts accordingly: walking to a spot it can afford (auto-build triggers via `GameScene.runBuildSpots`) or gathering the specific missing resource first. A new `build` goal type drives A* pathfinding to the spot; the bot stands still on arrival. Status label shows "Building" and a 2-second hold time prevents goal flickering. Priority sits just above "gather for build" and below all survival and combat nodes.

### Changes Made
- `src/ai/BotAI.ts`:
  - Added `BotBuildSpot` interface (`type`, `wx`, `wy`, `cost`).
  - Extended `BotGameState` with `availableBuildSpots: BotBuildSpot[]`.
  - Added context fields `affordableBuildSpot`, `gatherBuildSpot`, `gatherNeed`.
  - `buildContext()`: iterates available spots, computes first affordable spot and first spot missing a resource, filling the three new context fields.
  - Decision tree node `'Build'`: active when `affordableBuildSpot !== null`; produces a `build` goal pointing at the spot's world coordinates.
  - Decision tree node `'Gather for Build'`: active when `gatherBuildSpot` exists, HP >= 40%, and a resource node is reachable; reuses the `chop` goal type directed at the nearest resource.
  - Hold time for `build` goal set to 2.0 seconds.
  - Status label maps `build` → `'Building'`.
  - `executeGoal` case `'build'`: A* walk toward spot; zero velocity when within `INTERACT_RADIUS`.
- `src/scenes/GameScene.ts`:
  - Bot state update now filters `buildSpots` to `state === 'unlocked'` and maps them to `BotBuildSpot` objects (including cost from `BUILDINGS`), passing the array as `availableBuildSpots`.

### Priority Order (high to low)
survive → defend camp → counter-attack → kite → fire emergency → combat → feed fire → BUILD → gather for build → gather wood → idle

### Rationale
The bot previously had no awareness of the build system, leaving it idle even when it had the resources to construct a building. Passing the unlocked spot list from `GameScene` keeps the AI decoupled from scene internals, and the two-tier logic (afford now vs. need to gather) means the bot makes progress toward buildings even when partially resourced. The 2-second hold time ensures the goal does not flicker when the bot is on the boundary of an affordable spot calculation.

### Next Steps
- Verify `GameScene.runBuildSpots` correctly auto-builds when the bot stands within `INTERACT_RADIUS` of a spot
- Test multi-spot scenarios — bot should not greedily chain builds without re-evaluating fuel needs
- Consider adding a maximum "wood reserve" check before building, so the bot does not spend all wood and neglect the bonfire

---

## 2026-03-19 — v2.6.4: Tune bot combat aggression — fight harder, flee less

### Summary
Adjusted five interrelated thresholds in `BotAI.ts` to make the bot commit to fights rather than retreating at the first sign of damage. The bot now only flees when truly critical (sub-25% HP), skips retreat entirely when it can clearly finish a weakened enemy, and no longer kites a single melee opponent.

### Changes Made
- `src/ai/BotAI.ts`:
  - **Retreat threshold** lowered from 35% to 25% HP — `if (ctx.hpRatio < 0.25) this.retreating = true`.
  - **"Can win" override** — when `retreating` is true but only 1 enemy remains with HP < 30, the retreat check returns false and the bot finishes the fight instead of fleeing.
  - **Kite guard** — added `if (ctx.nearEnemyCount < 2) return false` so kiting is only triggered when surrounded by 2 or more melee enemies; in a 1v1 the bot stands and fights.
  - **Surrounded flee threshold** tightened from HP < 70% to HP < 50%, requiring the bot to be more damaged before attempting to escape a mob.
  - **Hysteresis** adjusted: retreat begins at 25% HP and cancels at 50% (previously 35% start / 60% cancel), narrowing the oscillation band.

### Rationale
The previous thresholds caused the bot to retreat too conservatively — fleeing at 35% HP meant abandoning fights it could win, and kiting a single enemy made 1v1 combat feel timid. Lowering the retreat floor to 25% keeps the bot engaged through normal damage trading. The "can win" check prevents the edge case where a bot correctly enters retreat mode but then runs from a nearly-dead enemy it should finish. Restricting kiting to multi-enemy situations makes the bot feel decisive rather than evasive in straightforward encounters.

### Next Steps
- Playtest the new thresholds and verify the bot does not die more often due to reduced retreating
- Consider adding an "enrage" state (attack speed bonus) when HP drops below 25% but "can win" check fires
- Tune the "can win" HP threshold (currently < 30) based on how often bots lose those all-in fights

---

## 2026-03-19 — v2.6.3: Dynamic shadow rendering system

### Summary
Added a `ShadowCasterComponent` that renders a soft ellipse shadow beneath every game entity. Shadows are directionally stretched away from the nearest active light source (bonfire or outpost building), scale in length with proximity to the light, and fade out at the edge of a light's radius. The component is wired onto players, enemies, and trees, and GameScene updates the shared static light list each frame.

### Changes Made
- `src/components/ShadowCasterComponent.ts` (new): Excalibur `Component` that spawns a child `Actor` rendered as a dark ellipse (circle scaled on Y) at z - 0.5 below its owner. Each `onPreUpdate` it locates the nearest light source within range, computes the angle away from it, offsets the shadow actor to the entity's feet in that direction, stretches the scale proportionally to proximity, and fades opacity between 5% (edge) and 30% (center). Light sources are injected via the static `ShadowCasterComponent.lightSources` array to avoid per-component scene queries.
- `src/entities/EntityFactory.ts`: Added `ShadowCasterComponent` to player (16x6), enemies (width = `def.size`, height = `max(4, size * 0.3)`), and trees (18x8).
- `src/scenes/GameScene.ts`: In the existing per-frame update loop, constructs a `shadowLights` array from all active bonfires (using the same fuel/level radius formula as the fog system) and any buildings with a `LightSourceComponent`, then assigns it to `ShadowCasterComponent.lightSources`.

### Rationale
The game already has a dynamic fog/light system but shadows were absent, making entities look flat and disconnected from the ground. Ellipse shadows with direction from light sources add readable depth and reinforce which light is illuminating each character. Using a scaled Circle avoids Excalibur's lack of a native Ellipse graphic. Sharing light sources via a static property rather than querying the scene per-entity keeps the update O(entities * lights) with no additional scene traversal cost.

### Next Steps
- Tune shadow length and opacity constants based on playtesting feedback
- Consider hiding shadows for entities outside any light radius (currently they disappear naturally at opacity < 0.05)
- Evaluate adding a subtle shadow to projectiles

---

## 2026-03-19 — v2.6.2: Melee enemies fight to death; bonfire blocks tile

### Summary
Two targeted gameplay and navigation fixes. Melee enemies no longer flee when low on HP — they commit to the fight. Ranged enemies retain flee behavior. The bonfire tile is now registered as unwalkable in the grid occupancy system, preventing enemies and the player from pathing through it.

### Changes Made
- `src/components/DecisionTreeComponent.ts`: Removed the `Flee` sequence (LowHP + TargetNear + RunAway) from `createMeleeTree()`. Updated the comment. Melee enemies now have a two-branch selector: attack when in melee range, otherwise chase. Only ranged enemies retain a flee branch.
- `src/entities/EntityFactory.ts`: Added a `GridOccupancyComponent` to the bonfire entity, computed from `Math.floor(x / CONFIG.TILE_SIZE)` and `Math.floor(y / CONFIG.TILE_SIZE)`. This registers the bonfire's tile as blocked so the walkability grid treats it as an obstacle.

### Rationale
Melee enemies retreating at 20% HP was unintuitive and made combat feel inconsistent — a skeleton running away mid-fight broke immersion and could exploit pathfinding edge cases. Removing flee from melee types keeps their role clear: close-range fighters that commit. The bonfire tile block closes a pathing bug where enemies could walk through the bonfire actor, which had no physical presence in the grid despite being a large stationary obstacle.

### Next Steps
- Tune ranged enemy flee threshold and flee distance
- Consider a "cornered" state for melee enemies at very low HP (enrage instead of flee)
- Verify GridOccupancyComponent cleans up on bonfire removal/reset

---

## 2026-03-19 — v2.6.1: Smart resource scoring, enemy HP bars, building depth sort

### Summary
Three targeted gameplay and visual quality improvements. Bot resource selection now uses a weighted score rather than raw nearest-to-player distance. Enemies display floating HP bars that appear on damage and clean up on death. Buildings are now included in the per-frame depth sort so they z-order correctly with entities.

### Changes Made
- `src/ai/BotAI.ts`: Replaced the "nearest resource to player within camp radius" selection with a weighted score of 60% distance-to-player + 40% distance-to-camp. Hard limit raised from `GATHER_RANGE` to `GATHER_RANGE * 1.5`. Result: bot picks resources that are reasonably close to itself without running far from the bonfire unnecessarily.
- `src/scenes/GameScene.ts`:
  - `depthSort()`: Added buildings to the z = pos.y sort loop so they layer correctly behind/in-front-of characters.
  - `updateEnemyHPBars()` (new): Maintains a `Map<GameEntity, {bg, fill}>` of `ex.Actor` pairs per enemy. Background is a dark rectangle; fill shrinks proportionally and changes color — green above 50% HP, orange above 25%, red below. Both actors are hidden (opacity 0) at full HP and shown as soon as any damage is taken. Dead or removed enemies have their actors killed and the entry purged.
  - `update()`: Calls `updateEnemyHPBars()` each frame after depth sort.

### Rationale
The old nearest-resource logic could send the bot to a tree far from camp, burning travel time and leaving the bonfire undefended. The new scoring anchors gathering closer to base while still preferring trees the bot is already near. Enemy HP bars provide immediate combat feedback without a permanent HUD element cluttering the screen. Building depth-sort was a visual regression fix — buildings were rendering at a fixed z and could appear on top of characters at the wrong y positions.

### Next Steps
- Tune the 60/40 weight split based on playtesting feedback
- Consider showing player HP bar as a similar floating element
- Add building sprites to replace placeholder rectangles

---

## 2026-03-19 — v2.6.0: Bonfire progression system — levels, build spots, buildings

### Summary
Major feature addition implementing the core camp progression loop from the original game design. The bonfire now has 6 levels driven by cumulative fuel, each level unlocking build spots around camp and scaling the light radius. Players can construct 6 building types with distinct gameplay effects (turrets, light sources, passive bonuses).

### Changes Made
- `src/components/BuildingComponent.ts` (new): Per-type building update logic. TURRET polls for nearest enemy each frame and fires an orange projectile Actor on a cooldown; projectile checks proximity to target each preupdate and deals damage via HealthComponent on hit with a yellow impact flash. OUTPOST/FORGE/WEAPON_SHOP/ARMOR_WORKSHOP/FRIEND_HUT are stubs handled by GameScene.
- `src/config.ts`: Added `BUILD_SPOTS` config array defining 9 spawn positions around the bonfire, each with a `BuildingType`, unlock `fireLevel`, and resource cost.
- `src/types.ts`: Added `BuildSpotConfig` interface (`pos`, `buildingType`, `fireLevel`, `cost`).
- `src/entities/EntityFactory.ts`: Added `createBuildSpotGhost()` (pulsing semi-transparent blue rectangle + name label) and `createBuilding()` (solid colored rectangle entity with BuildingComponent attached and initialized).
- `src/scenes/GameScene.ts`:
  - Bonfire level system: `campFuelAdded` accumulates fuel (never decreases); level thresholds `[0, 25, 60, 110, 175, 275]`; `levelMult = 1.0 + level * 0.5` scales light radius; purple "CAMP LEVEL X!" floating text on level-up; red "THE DARKNESS STIRS..." warning at level 2+.
  - Build spots: ghost actors created per spot, visible when unlock level is reached; player proximity + resource check auto-triggers construction and removes ghost.
  - Buildings: added to fog light list (OUTPOST), read `armorBonus` (ARMOR_WORKSHOP), init turret with enemy getter.
  - HUD: camp level number + purple gradient progress bar rendered each frame.

### Rationale
Progression system is the central gameplay loop of Fading Lights. The bonfire leveling with visual feedback (light expansion, floating text, HUD bar) makes resource gathering feel rewarding. Build spots provide a spatial decision layer — where to invest resources — and buildings like the TURRET give the camp active defensive capability rather than purely passive survival.

### Next Steps
- Wire FORGE / WEAPON_SHOP to unlock weapon tiers
- Wire FRIEND_HUT to spawn an ally entity
- Balance fuel thresholds and building costs against resource spawn rates
- Add visual variety to buildings (sprites vs rectangles)

---

## 2026-03-19 — v2.5.14: Smarter BotAI — targeted gathering, camp-bound search, status label

### Summary
Overhauled `BotAI.ts` to make the bot behave more purposefully during resource gathering and idle time. The bot now calculates exactly how much wood it needs before chopping, restricts its resource search to a 180 px radius around the bonfire, orbits camp very slowly instead of wandering, and displays a live status label above the player head showing the current action.

### Changes Made
- `src/ai/BotAI.ts`:
  - `BotContext`: added `woodNeeded` (int) and `hasEnoughWood` (bool) fields
  - `GATHER_RANGE = 180`: new config constant limiting resource search to camp vicinity
  - `updateStatusLabel()`: new method — creates/updates an `ex.Label` above the player showing the current goal as human-readable text; combat goals rendered in `#FF6644`, peaceful goals in `#AADDFF`
  - `buildContext()`: resource search now filters to entities within `GATHER_RANGE` of the bonfire; computes `fuelDeficit`, `woodNeeded`, and `hasEnoughWood` each tick
  - Decision tree — "Feed Fire": threshold raised from `fuelRatio < 0.70` to `fuelRatio < 0.85`; triggers whenever `wood >= 1` regardless of gather state
  - Decision tree — "Gather Wood" (was "Gather Resources"): skipped when `hasEnoughWood`; removed the 300 px player-distance guard (camp range already constrains it); goal label includes `need N` count for debug readability
  - Decision tree — "Camp Idle" (was "Patrol"): bot returns to bonfire if `distToFire > 70`; within 70 px it slow-orbits at radius 40 with `speed 0.2`; wander side-jump every 5–9 s instead of every 3 s

### Rationale
The previous bot would chop indefinitely once it started gathering, accumulating far more wood than needed and wandering away from camp to find trees. This made the bot feel mechanical and caused it to neglect the bonfire. The new approach treats gathering as a targeted errand — compute the deficit, collect just enough, then return to feed the fire. Restricting the search radius keeps the bot close to camp, which is both strategically correct (defend the bonfire) and visually more readable to the player. The status label gives instant feedback on what the bot is doing without requiring the debug HUD to be open.

### Next Steps
- Consider exposing `GATHER_RANGE` as a difficulty-scaling parameter
- Add a brief "thinking" pause before switching from idle to gather to reduce jitter
- Evaluate whether `woodNeeded + 2` buffer is sufficient for aggressive fuel consumption rates

---

## 2026-03-19 — v2.5.13: Pixel art textures for drops and resource deposits

### Summary
Replaced procedural rectangle/circle drop rendering and small placeholder deposit sprites with proper pixel art assets generated via PixelLab MCP. Drops are now 32x32 PNGs and resource deposits are 48x48 PNGs, giving all resource objects a consistent hand-crafted look.

### Changes Made
- `public/assets/pixelart/wood_drop.png` — New 32x32 firewood log/bark piece texture
- `public/assets/pixelart/stone_drop.png` — New 32x32 grey stone chunk texture
- `public/assets/pixelart/metal_drop.png` — New 32x32 copper/bronze ore chunk texture
- `public/assets/pixelart/stone_deposit_new.png` — New 48x48 rocky boulder with mineral veins (replaces 20x16 placeholder)
- `public/assets/pixelart/metal_ore_new.png` — New 48x48 metal ore formation with metallic veins (replaces 20x16 placeholder)
- `src/engine/AssetLoader.ts`:
  - Added `woodDrop`, `stoneDrop`, `metalDrop` image source entries
  - Updated `stoneDeposit` and `metalOre` sources to point at the new 48x48 textures
- `src/entities/EntityFactory.ts`:
  - `createDrop()`: now uses pixel art textures (woodDrop / stoneDrop / metalDrop) instead of procedural colored shapes
  - `createStone()` / `createMetal()`: anchor updated to 0.6 for better visual grounding; fallback sizes increased to match the larger sprites
- `src/scenes/GameScene.ts`:
  - `spawnParabolicStick()`: uses `wood_drop` texture for the animated stick projectile instead of a plain brown rectangle
- `package.json`: version bumped 2.5.12 → 2.5.13

### Rationale
The previous drop rendering used Excalibur `Rectangle`/`Circle` graphics drawn in code — quick to implement but visually inconsistent with the rest of the game's pixel art aesthetic. The deposit sprites were tiny 20x16 placeholder images that looked out of place next to the player and enemy sprites. Using PixelLab-generated assets at consistent resolutions (32x32 for pickups, 48x48 for world objects) brings resource visuals in line with the overall art direction and makes loot drops immediately recognisable at a glance.

### Next Steps
- Audit remaining procedural graphics (e.g., bonfire base, camp structures) for pixel art replacement candidates
- Consider adding a subtle idle animation (bob or shimmer) on floor drops to improve visibility
- Verify the new deposit anchor (0.6) feels right on all tile backgrounds, especially near walls

---

## 2026-03-19 — v2.5.12: Visual feedback for drop pickup and bonfire feeding

### Summary
Added animated visual feedback for two previously instant interactions: picking up resource drops and feeding wood to the bonfire. Both now have satisfying fly-to-target animations to reinforce what happened to the player.

### Changes Made
- `src/scenes/GameScene.ts`:
  - **Drop pickup animation**: When the player walks over a drop within `PICKUP_RADIUS`, the drop is flagged `_flyingToPlayer` and a `preupdate` listener lerps it toward the player over 300ms with a slight upward arc (`sin(t*PI)*15`). The item also shrinks from 100% to 50% scale as it flies. The resource is only credited and the actor killed once `t >= 1`. A secondary filter pass removes newly killed drops at the end of the frame.
  - **`spawnParabolicStick()`**: New private method that creates a brown rectangle actor at a source position and animates it parabolically to a target over 500ms. Arc height scales with horizontal distance (`40 + |dx|*0.15`). The stick rotates a full turn during flight and shrinks slightly to sell the perspective. Used for bonfire feeding.
  - **Bonfire feed animation**: `runBonfire()` now calls `spawnParabolicStick(player → bonfire)` on each feed event, and calls `spawnFloatingText()` with an orange `+N fuel` label above the bonfire. Fuel added is computed before clamping so the displayed amount is accurate.
  - **Feed cooldown**: Added `feedCooldown` field (seconds). Set to 0.5s each time a stick is consumed. `runBonfire()` only feeds when `feedCooldown <= 0`, ensuring sticks fly one at a time rather than all in the same frame.
  - **Bot feeding unified**: Removed the separate instant-feed block from the bot `cmd.interact` path. Bot now relies on `runBonfire()` running each frame, so it gets the same animation and cooldown as the human player.
- `package.json`: version bumped 2.5.11 → 2.5.12

### Rationale
Instant item disappear on pickup offered no feedback — it was unclear whether the pick-up happened or was missed. The fly-to-player arc makes collection unambiguous and satisfying. Similarly, the bonfire fed silently before; the parabolic stick + floating fuel text makes each piece of wood feel deliberate. The 0.5s cooldown prevents a visual mess when feeding many sticks in quick succession, and unifying the bot path removes a maintenance split between two code paths doing the same thing.

### Next Steps
- Tune arc height and flight duration based on feel (300ms pickup / 500ms bonfire)
- Consider a brief scale-pop on the resource HUD counter when a pick-up lands
- The floating text "+N fuel" currently uses `Math.round(added)` — verify `FUEL_PER_WOOD` is always a whole number to avoid "14.99 fuel" display edge cases

---

## 2026-03-19 — v2.5.11: Progressive enemy spawning — wave system with escalating difficulty

### Summary
Removed the static test-enemy block from `LevelScript` so levels start with zero enemies. Added a minute-based wave system to `GameScene` that progressively increases enemy count and enemy type difficulty. The HUD now shows the current wave number.

### Changes Made
- `src/world/LevelScript.ts`:
  - Deleted the 7-enemy test spawn loop that placed one of each enemy type around the camp at level start
  - Replaced with a comment pointing to `GameScene.runSpawning()` as the authoritative spawn source
- `src/scenes/GameScene.ts`:
  - Added `waveTimer`, `waveNumber`, `totalSpawned`, and `MAX_ALIVE` (10) fields
  - Added static `WAVE_POOLS` array: 7 entries mapping wave index to weighted enemy-type pools (Wisp-only at wave 0, escalating to Beast/Lord/VoidMage at wave 6+)
  - `runSpawning()` rewritten: increments `waveTimer`, advances `waveNumber` each 60s, computes `waveQuota = min(waveNumber+1, 10)`, derives `spawnInterval = max(3, 60/(quota+1))` to spread spawns across the minute, and only spawns when `aliveCount < waveQuota`
  - Enemy type drawn randomly from the wave-appropriate pool
  - HUD updated: added "Wave N" display in amber alongside Kills/Enemies counters
  - Console logs wave transitions: `[Spawn] Wave N — spawning up to N+1 enemies`
- `package.json`: version bumped 2.5.10 → 2.5.11

### Rationale
The test enemy block was useful for early development but broke the game feel — players faced 7 varied enemies from second one. The wave system creates a proper difficulty ramp: one harmless Wisp at minute 0, then steadily more enemies of increasing strength. Spreading spawns over the minute (rather than dumping them all at once) prevents sudden overwhelming swarms while keeping pressure constant.

### Next Steps
- Tune per-wave pool composition based on playtesting (especially wave 3-5 difficulty curve)
- Consider adding a brief on-screen "Wave N" announcement when a new wave starts
- Expose `MAX_ALIVE` and `WAVE_POOLS` to CONFIG for easier balance iteration

---

## 2026-03-19 — 3e93ea7: v2.5.10: BotAI rewrite — A* pathfinding, camp defense, counter-attack

**Commit:** 3e93ea7

### Summary
Complete rewrite of `src/ai/BotAI.ts`. All bot movement now uses A* pathfinding via `grid.findPath()` so bots navigate around obstacles. Two new reactive decision tree nodes add camp defense and projectile counter-attack logic, making kill goals interruptible at higher priority.

### Changes Made
- `src/ai/BotAI.ts` (full rewrite):
  - All movement goals (kill, flee, feed, chop, idle/patrol) replace straight-line `dirTo()` with `grid.findPath()` A* navigation
  - **Defend Camp** node: detects enemies within 250px of bonfire and interrupts lower-priority goals to engage the threat
  - **Counter-Attack** node: traces incoming projectile trajectories back to the nearest ranged enemy, triggering a kill goal against the attacker
  - Kill goal is now reactive — can preempt chop/mine/feed/idle when camp is threatened or bot takes projectile damage
  - Repath logic: repaths every 0.8–1.2s or when target drifts >60px from last known path destination
  - A* waypoint count displayed in debug HUD
- `package.json`: version bumped 2.5.9 → 2.5.10

### Rationale
Straight-line movement was causing bots to get stuck on trees, walls, and other obstacles constantly. A* pathfinding resolves this at the navigation layer while grid collision remains as a fallback safety net on final velocity. The camp defense and counter-attack nodes make bot behavior feel proactive rather than passive — bots now respond to threats to the bonfire and to being attacked from range, which meaningfully raises the skill ceiling of cooperative play.

### Next Steps
- Tune A* repath interval and enemy detection radii based on playtesting
- Consider path-smoothing (funnel algorithm) to reduce zigzag waypoint walking
- Expose camp-defense radius (currently 250px) in CONFIG for balance tuning

---

## 2026-03-19 — 364ffc9: v2.5.9: Player melee animation, resource drops, and auto-pickup

**Commit:** 364ffc9

### Summary
Added the full melee attack loop for the player: directional axe-swing spritesheets play on attack, resources drop collectible items when destroyed, and players auto-collect drops by walking over them. Damage timing is now driven by the animation's damage frame callback, matching the pattern already used for enemy dodges.

### Changes Made
- `src/engine/AssetLoader.ts`:
  - Loaded 8 directional male melee spritesheets (3 frames, 48x48 each)
  - Exported `maleMeleeSheets` mapping for use in EntityFactory
- `src/components/AnimatedSpriteComponent.ts`:
  - Added `attackSpriteSheets` and `attackSheetGrid` options mirroring the existing walk pattern
  - Refactored duplicate sheet-extraction logic into shared `extractSheetFrames()` helper
- `src/entities/EntityFactory.ts`:
  - Wired player entity with attack animation config pointing to `maleMeleeSheets`
  - Added `createDrop()` factory method: spawns wood sticks (brown rectangles) or stone/metal (small circles) at destruction point with random scatter and bounce-in scale animation
- `src/scenes/GameScene.ts`:
  - Added `drops` array to track live drop entities
  - `runDropPickup()`: each frame checks if player is within 40px of any drop; auto-collects and increments inventory
  - `spawnFloatingText()`: renders "+N wood / stone / metal" text floating upward — triggered on resource destruction and on each individual pickup
  - Attack integration: melee damage to both enemies and resources fires on the animation's damage frame callback (previously fired immediately on key press)

### Rationale
Damage-on-damage-frame makes combat feel responsive and fair — the hit registers at the visual peak of the swing rather than the moment the key is pressed. The drop and pickup system gives resource destruction tangible feedback and sets up the foundation for a crafting/inventory loop.

### Next Steps
- Add inventory UI panel to display collected resource counts
- Implement crafting recipes that consume wood/stone/metal
- Consider a pickup magnet radius that grows as the player levels up

---

## 2026-03-19 — 41a5968: v2.5.8: Fix SpriteSheet.getSprite argument order in tryExtractWalkSheets

**Commit:** 41a5968

### Summary
Fixed a fatal game load error caused by swapped arguments in `SpriteSheet.getSprite()` inside `tryExtractWalkSheets()`. The call `getSprite(0, i)` was interpreted by Excalibur as (column=0, row=i), so any walk animation with more than one frame would throw "No sprite exists in the SpriteSheet at (0, 1)" and crash the game before it could start.

### Changes Made
- `src/components/AnimatedSpriteComponent.ts`:
  - `tryExtractWalkSheets()`: changed `sheet.getSprite(0, i)` to `sheet.getSprite(i, 0)` — Excalibur's signature is `(column, row)`, so iterating columns across row 0 is the correct pattern for a horizontal sprite strip
- `package.json`: bumped version from 2.0.0 to 2.5.8 to align with commit versioning convention

### Rationale
The argument swap meant Excalibur was looking for sprites in a second row that does not exist in a single-row horizontal strip, causing an immediate fatal throw. The fix reads frames left-to-right across row 0, which is exactly how the walk spritesheets are laid out.

### Next Steps
- Verify all 8 directional walk animations play correctly in-game after this fix
- Add idle animation frames (currently falls back to static sprite when not moving)

---

## 2026-03-19 — aec0213: v2.5.7: Player walking animations via spritesheet support

**Commit:** aec0213

### Summary
The player character now displays walking animations when moving. Previously the player used a `SpriteRendererComponent` showing a single static directional sprite with no leg movement. This commit wires up a walk spritesheet through `AnimatedSpriteComponent`, enabling 8-directional animated movement.

### Changes Made
- `src/components/AnimatedSpriteComponent.ts`:
  - **`walkSpriteSheets` option** — accepts a record of direction keys to spritesheet image paths, loaded via the existing asset pipeline
  - **Deferred frame extraction** — frames are not sliced until the spritesheet image fires its `onload` event, avoiding attempts to extract from an unready image
  - **`AnimFrame` union type** — `ImageSource | Graphic` allows the animation array to hold both raw loaded images and excalibur `Graphic` objects interchangeably, simplifying rendering logic
- `src/entities/EntityFactory.ts`:
  - Player entity switched from `SpriteRendererComponent` to `AnimatedSpriteComponent`
  - Walk animation wired up: 8 directions (N, NE, E, SE, S, SW, W, NW), 6 frames each, 48x48 px per frame, sourced from the walk spritesheet

### Rationale
Static directional sprites read as stiff and lifeless during movement. The spritesheet approach keeps all directional walk frames in a single asset file, which is simpler to manage and load. Deferring frame extraction prevents a common async bug where canvas draws fail on incomplete image data.

### Next Steps
- Add idle animation frames (currently falls back to static sprite when not moving)
- Consider attack animation frames for the player via the same spritesheet mechanism
- Verify animation frame timing feels natural across different movement speeds

---

## 2026-03-19 — eb33605: BotAI goal persistence, movement smoothing, completion detection

**Commit:** eb33605

### Summary
Improved bot decision-making stability and movement fluidity. The bot previously re-evaluated its goal every tick, causing rapid goal-switching and jittery movement. This commit introduces goal inertia (minimum hold times per goal type), lerp-based movement smoothing, and proper goal completion detection.

### Changes Made
- `src/ai/BotAI.ts`:
  - **Goal persistence / inertia** — `goalAge` and `goalMinTime` fields track how long the bot has held the current goal. Each goal type has a minimum hold time: kill (2s), chop/mine/feed (1.5s), flee (0.8s), kite (0.4s), dodge (0.2s), idle (1s).
  - **`shouldSwitchGoal()`** — new private method encapsulates the switch logic: allows immediate switch only when current target is dead/gone, new goal is reactive (dodge/flee/kite), or hold time has elapsed.
  - **Movement smoothing** — `smoothVx`/`smoothVy` lerp toward raw velocity each tick using `SMOOTH_FACTOR = 0.15`. Values snap to 0 below 0.02 to prevent indefinite drift.
  - **Goal completion detection** — when hold time is active but target is killed, goal switches immediately rather than waiting out the timer.
  - **Stuck detection improvement** — threshold raised from 1.5s to 2.0s; on trigger, `goalAge` is set to 999 to force immediate goal re-evaluation.
  - **Debug HUD** — goal line now appends `[Xs]` showing how long the current goal has been active.

### Rationale
Without hold times, the bot oscillated between "kill" and "gather" goals on every tick when near both an enemy and a resource, producing erratic behavior. Minimum hold times give each decision time to play out. Movement smoothing eliminates the frame-to-frame velocity snapping that caused visible stutter.

### Next Steps
- Consider per-target identity caching so a "chop" goal doesn't re-lock to a different tree mid-hold
- Tune SMOOTH_FACTOR per goal type (combat may want faster response than patrol)
- Expose GOAL_HOLD_TIMES in a config object for easier balancing

---

## 2026-03-19 — v2.5.6: Full decision tree bot AI ported from bot.js

**Commit:** 756cca8

### Summary
The player-character bot AI has been fully reimplemented as a structured decision tree, ported from the original game's `bot.js`. The AI makes decisions each tick by walking a priority tree and selecting the highest-priority actionable goal, then executing movement and attacks toward that goal.

### Priority Order
1. **SURVIVE** — evade projectiles using closest-approach geometry; retreat when HP drops below 35% (stops retreating at 60% — hysteresis)
2. **FIRE DYING** — sprint to bonfire when fuel is critically low (under 10%)
3. **KITE** — blend movement 60% away from nearest enemy and 40% toward bonfire when enemy is within kite range
4. **COMBAT** — attack the nearest enemy when within weapon range
5. **FEED FIRE** — walk to bonfire and deposit fuel when bonfire fuel falls below 30% and player has wood
6. **GATHER** — chop trees or mine stone for resources when idle
7. **PATROL** — move to a random waypoint when nothing else applies

### Changes Made
- `src/ai/BotAI.ts` — Full rewrite:
  - `TreeNode` / `BotContext` / `BotGoal` / `TreeTrace` interfaces define the decision tree structure
  - `BotGameState` interface exported for GameScene to pass fuel and resource data each tick
  - Projectile evasion calculates closest approach time and lateral dodge vector
  - Kiting blends two vectors: 60% away from enemy, 40% toward bonfire
  - Debug HUD (`drawDebugHUD`) renders the real-time decision tree trace on the right side of the Phaser canvas
  - HP hysteresis: `retreating` flag set at 35% HP, cleared at 60%
  - Bot enabled by default; backtick key toggles it on/off
- `src/scenes/GameScene.ts` — Passes `BotGameState` (bonfire fuel, max fuel, current resources) to `BotAI.update()` each tick

### Rationale
The previous BotAI was a stub. The original game had a fully functional bot in `bot.js` that was never ported to the TypeScript rewrite. This commit brings feature parity: the bot can survive autonomously, manage the bonfire, and engage enemies using the same logic as the original.

### Excluded from commit
- `test-results/` (Playwright output)
- `notes.md` (not tracked)

---

## 2026-03-17 — fix: mobile intro video — compressed asset + autoplay policy handling

**Commit:** 731314e

### Summary
The intro video now works correctly on mobile devices. A compressed mobile variant (`intro_mobile.mp4`) is served to phones and tablets, cutting load from 30MB to 5.4MB. Mobile autoplay policy is handled explicitly: the video starts muted, a "Tap to unmute" hint appears, and double-tap skips. iOS Safari compatibility is improved with `playsinline` and `webkit-playsinline` attributes. Desktop fallback logic is also made more robust.

### Changes Made
- `assets/intro_mobile.mp4` — 5.4MB, 480p, H.264 baseline profile, faststart flag; compressed from the 30MB original for reliable mobile streaming
- `js/intro.js` — Reworked autoplay and mobile handling:
  - Mobile detected via `navigator.userAgent`
  - Mobile path: loads compressed video, starts muted, shows "Tap to unmute" overlay, first tap unmutes, second tap skips
  - `playsinline` and `webkit-playsinline` attributes added for iOS Safari
  - Desktop path: tries unmuted first, falls back to muted, skips entirely if video is completely blocked
  - Skip button gains `-webkit-tap-highlight-color: transparent` to remove tap flash on mobile
  - `Skip >` changed to `Skip ▶` (unicode arrow)

### Rationale
Mobile browsers enforce strict autoplay policies that block unmuted video without user interaction. The previous code attempted to play unmuted then retry muted, but did not handle the mobile UX path cleanly — no hint was shown and iOS Safari rejected playback without `playsinline`. The compressed variant prevents mobile users from downloading a 30MB file on a slow connection.

### Excluded from commit
- `test-results/` (Playwright output)
- `assets/pixelart/*.zip` (source archives)
- `assets/pixelart/make_spritesheets.py` (build utility)
- `notes.md` (not tracked)

---

## 2026-03-17 — feat: add IntroScene with fullscreen video before menu

**Commit:** 8978cfa

### Summary
A new IntroScene now plays a fullscreen video (`assets/intro.mp4`) before the main menu loads. The scene handles autoplay restrictions gracefully, provides multiple skip mechanisms, and fades out cleanly on completion or skip. `intro.mp4` is stored via git LFS to keep the repository lean.

### Changes Made
- `assets/intro.mp4` — 30MB intro video, tracked via git LFS (`.gitattributes` created with `*.mp4 filter=lfs`)
- `js/intro.js` — IntroScene implementation:
  - Plays video fullscreen using Phaser's Video game object
  - "Skip" button visible in top-right corner
  - Responds to Space, Esc, Enter keys and tap/click to skip
  - Fades out to black on video end or skip, then transitions to the menu scene
  - Handles autoplay restrictions: starts muted if autoplay is blocked, unmutes on first user interaction
- `js/main.js` — IntroScene registered and inserted as the first scene in the Phaser scene list
- `index.html` — `intro.js` added to the script loading list before `main.js`
- `.gitattributes` — created to configure git LFS tracking for `*.mp4`

### Rationale
An intro video adds production polish and sets the tone before the player reaches the main menu. Starting muted with an unmute-on-interaction fallback ensures the experience works across all browsers regardless of autoplay policy.

### Excluded from commit
- `test-results/` (Playwright output)
- `assets/pixelart/*.zip` (source archives)
- `assets/pixelart/make_spritesheets.py` (build utility)
- `notes.md` (not tracked)

---

## 2026-03-17 — feat: functional wall torches as fog-of-war light sources

**Commit:** 5e39e02

### Summary
Wall torches in the maze dungeon are now active light sources rather than purely decorative sprites. Each torch creates a small flickering hole in the fog of war, overlays a warm orange tint on the lit area, and runs a fire particle emitter. Culling logic skips off-screen torches during each fog update frame.

### Changes Made
- `js/maze.js`
  - Initialises `this._wallTorches` array to track torch world positions at scene creation
  - Pushes each placed torch into the array and attaches a `Phaser.GameObjects.Particles` fire emitter (tints: `0xFF4400`, `0xFF6600`, `0xFFAA00`; blend mode: ADD; depth 4)
  - During fog-of-war canvas update: iterates `_wallTorches`, converts world coords to screen via `_worldToScreen`, skips torches outside the viewport (+/- 100px margin), draws a radial gradient hole (radius 65px, flickering via `sin(time * 0.012 + torch.x)`)
  - Applies a second pass with `source-atop` compositing for the warm orange tint gradient on each torch

### Rationale
Purely decorative torches gave no gameplay or atmospheric payoff. Making them true light sources means rooms with torches are partially visible even before the player enters, rewarding exploration and reinforcing dungeon atmosphere without impacting performance (off-screen torches are skipped each frame).

### Excluded from commit
- `test-results/` (Playwright output)
- `assets/pixelart/*.zip` (source archives)
- `assets/pixelart/make_spritesheets.py` (build utility)
- `notes.md` (not tracked)

---

## 2026-03-17 — v0.5.53: Dungeon pixel art textures + mobile keyboard fix

**Commit:** 4bbe645

### Summary
Added a full set of pixel art dungeon assets and wired them into the maze scene, with Wang-tile blending for smooth floor-to-wall transitions. Also fixed a mobile UX issue where auto-focusing the name input caused the on-screen keyboard to cover the Start button.

### Changes Made
- `assets/dungeon/dungeon-tileset.png` / `dungeon-tileset.json` — 16-tile Wang tileset for dungeon floors and walls
- `assets/dungeon/pillar.png` — decorative pillar sprite
- `assets/dungeon/chest.png` — pixel art treasure chest sprite
- `assets/dungeon/torch.png` — wall torch decoration sprite
- `assets/dungeon/bones.png` — scattered bones decoration sprite
- `js/maze.js` — bakes Wang-tiled floor/wall transitions into a RenderTexture on scene create with smooth blending; places pixel art treasure chest in rooms; scatters bones and torch decorations; falls back to procedural rendering if the tileset is not loaded
- `js/menu.js` — preloads all six dungeon assets on startup; skips auto-focus on the player name input field when running on a mobile device so the virtual keyboard does not obscure the Start button

### Rationale
The dungeon previously used purely procedural geometry for floor and wall rendering. Wang tiles give proper corner and edge transitions that make the level feel hand-crafted. The mobile keyboard fix addresses a reported UX regression where the Start button was hidden behind the keyboard on small screens.

### Excluded from commit
- `test-results/` (Playwright output)
- `assets/pixelart/*.zip` (source archives)
- `assets/pixelart/make_spritesheets.py` (build utility)
- `notes.md` (not tracked)

---

## 2026-03-17 — feat: Add level 2 music track

**Commit:** 211d80f

### Summary
Added a dedicated music track for the maze (level 2). The track fades in when MazeScene is created, replacing the overworld music, and fades out cleanly on victory or when the developer shortcut returns to level 1.

### Changes Made
- `js/audio.js` — added `music_lvl2` entry to `AUDIO_CONFIG` pointing to `audio/music_lvl2.mp3` with the same volume and loop settings as the overworld track
- `js/maze.js` — on `create()`, stops the overworld `music` loop (400 ms fade) then starts `music_lvl2` (1500 ms fade-in); on victory, adds `music_lvl2` to the existing stop block alongside `music` and `ambient`; on the `keydown-ONE` dev shortcut, stops `music_lvl2` before transitioning back to `GameScene`
- `audio/music_lvl2.mp3` — new audio asset added to the repository

### Rationale
The maze previously had no dedicated music, so the overworld track continued playing during level 2. Using a distinct track reinforces the tonal shift between the two scenes and gives players an audible cue that they have entered a new environment.

### Excluded from commit
- `test-results/` (Playwright output)
- `assets/pixelart/*.zip` (source archives)
- `assets/pixelart/make_spritesheets.py` (build utility)
- `notes.md` (not tracked)

---

## 2026-03-17 — refactor: Eliminate code duplication across scenes

**Commit:** f085928

### Summary
Extended `js/shared.js` with four new utility functions that remove inline duplications in `game.js` and `maze.js`. The maze scene's own `_floatText()` method was deleted entirely in favour of the existing shared `showFloatingText()`. Enemy melee distance is now driven by `CONFIG.ENEMY_MELEE_RANGE` rather than a magic number, and the HTML health bar now updates correctly when enemies attack on level 2.

### Changes Made
- `js/shared.js` — added `updateHealthBar()` (syncs HTML health-fill bar from `gameState.hp`), `damagePlayerShared(scene, amount)` (applies armor reduction, deducts HP, calls `updateHealthBar()`), `showFullHUD()` (restores all HUD panels on scene entry), and `showMazeHUD()` (shows HUD but hides fire/resource panels not relevant in the maze)
- `js/game.js` — replaced inline `document.getElementById('hud').style.display = 'flex'` with `showFullHUD()` so the full HUD is always restored correctly when returning from the maze
- `js/maze.js` — replaced inline armor/damage calculation with `damagePlayerShared()`; replaced inline DOM manipulation with `showMazeHUD()`; replaced all three `this._floatText()` calls with `showFloatingText()`; added `updateHealthBar()` call in the HUD update path; changed melee distance check from the magic number `16` to `CONFIG.ENEMY_MELEE_RANGE`; removed the `_floatText()` method entirely

### Rationale
Several small but identical blocks of logic had been copy-pasted into each scene as the codebase grew. Centralising them in `shared.js` means future changes (e.g., adjusting armor formula, HUD layout) only need to happen in one place, and the maze's HTML health bar now stays in sync during combat — a bug that existed because the duplicated code path never called `updateHealthBar()`.

### Excluded from commit
- `test-results/` (Playwright output)
- `assets/pixelart/*.zip` (source archives)
- `assets/pixelart/make_spritesheets.py` (build utility)
- `notes.md` (not tracked)

### Next Steps
- Add JSDoc to the four new `shared.js` exports
- Audit remaining scenes for further duplication candidates now that the pattern is established

---

## 2026-03-17 — feat: Extract shared debug/utility functions into js/shared.js

**Commit:** 7fa1971

### Summary
Created `js/shared.js` as a central module for reusable helpers shared between the overworld (`game.js`) and maze (`maze.js`) scenes. The existing per-scene debug drawing code in `game.js` was refactored to delegate to the shared `drawEnemyDebug()` function. Maze enemies now expose an `aiState` data key so the debug overlay can display their current behaviour state.

### Changes Made
- `js/shared.js` (new file) — contains `showFloatingText()`, `updatePlayerDirection()`, `playAttackAnimation()`, `drawDirectionalShadow()`, `initFogOfWar()`, `updateFogWithLights()`, `drawEnemyDebug()`, and `cleanupDebugLabels()`
- `index.html` — added `js/shared.js` to the script loading list (before `menu.js`)
- `js/game.js` — `_drawDebug` stripped of its inline walk-grid / path / velocity-line drawing; now calls `drawEnemyDebug(this, g, enemies, { walkGrid, gridSize })`; Groq-specific label rendering retained in place
- `js/maze.js` — added `_debugGfx` graphics layer at depth 4999; update loop calls `drawEnemyDebug(this, this._debugGfx, mazeEnemies, {})`; enemy CHASE/ATK PLAYER/WANDER branches now set `aiState` data so the overlay can display the current state

### Rationale
Both scenes had diverged implementations of the same debug visualisations (enemy paths, velocity lines, AI state labels, walk-grid overlay). Centralising them in `shared.js` removes duplication, ensures both scenes benefit from future improvements in one place, and establishes the module as the home for any other utilities that span scenes.

### Excluded from commit
- `test-results/` (Playwright output)
- `assets/pixelart/*.zip` (source archives)
- `assets/pixellab/make_spritesheets.py` (build utility)
- `notes.md` (not tracked)

### Next Steps
- Migrate remaining scene-specific utilities (`showFloatingText`, `updatePlayerDirection`, etc.) to use the shared versions now that the module is in place
- Add JSDoc comments to `shared.js` exports for easier onboarding

---

## 2026-03-17 — v0.5.53: Canvas fog-of-war for maze torch light

**Commit:** e825684

### Summary
Replaced the MazeScene's RenderTexture + hard-circle torch light with the same canvas-based fog-of-war system used in the overworld. The player acts as the torch light source, with a smooth radial gradient falloff, warm orange tint in the lit area, subtle sine-wave flicker, update throttled to 20fps, and full window-resize handling.

### Changes Made
- `js/maze.js` — `_initTorchLight`: removed `_lightGfx` / `_lightRT` RenderTexture setup; replaced with an off-screen `<canvas>` element, a Phaser `createCanvas` texture keyed `maze_fog`, and a screen-space `image` at depth 80 with `scrollFactor(0)`. Registered a `scale.on('resize')` listener to recreate the canvas and texture on window resize.
- `js/maze.js` — added `_worldToScreen(wx, wy)` helper: converts world coordinates to screen coordinates using `cameras.main.scrollX/Y` and `zoom`.
- `js/maze.js` — `_updateTorchLight`: fully rewritten. Throttled via `_fogTimer` (50ms / ~20fps). Fills canvas with near-black darkness (`rgba(2,1,5,0.97)`), punches a transparent hole with `destination-out` and a radial gradient (opacity 1 at centre → 0 at edge), then layers a warm orange tint with `source-atop`. Flicker applied via two overlapping sine waves on the radius. Final canvas is copied into the Phaser texture via `drawImage` + `refresh()`.

### Rationale
The previous RenderTexture approach used a flat filled circle for the light area, producing a hard visible edge. The canvas-based gradient matches the overworld bonfire system exactly, giving a smooth light-to-dark transition, warm atmospheric colour, and subtle alive feeling from the flicker — all at a consistent rendering cost thanks to the 20fps throttle.

### Excluded from commit
- `test-results/` (Playwright output)
- `assets/pixelart/*.zip` (source archives)
- `assets/pixelart/make_spritesheets.py` (build utility)
- `notes.md` (not tracked)

### Next Steps
- Tune the flicker sine frequencies and amplitude if the effect feels too strong or too subtle
- Consider reducing `_torchRadius` slightly now that the gradient gives a softer perceived edge
- Verify the resize handler behaves correctly on mobile orientation changes

---

## 2026-03-17 — v0.5.53: Dev shortcuts to jump between scenes

**Commit:** 0514198

### Summary
Added two debug-only keyboard shortcuts to speed up development iteration across the two main game scenes. Pressing 2 in GameScene transitions immediately to MazeScene (with `hasTorch` auto-granted so the maze is playable), and pressing 1 in MazeScene returns to GameScene. Both shortcuts check `window._debugMode` and are no-ops in production.

### Changes Made
- `js/game.js` — added `keydown-TWO` listener: stops all audio loops, sets `gameState.hasTorch = true`, then starts `MazeScene`
- `js/maze.js` — added `keydown-ONE` listener: starts `GameScene` directly

### Rationale
Without shortcuts, reaching MazeScene required completing level 1, which is slow during active maze development. The torch auto-grant prevents the immediate "no torch" block in the maze entry logic.

### Excluded from commit
- `test-results/` (Playwright output)
- `assets/pixelart/*.zip` (source archives)
- `assets/pixelart/make_spritesheets.py` (build utility)
- `notes.md` (not tracked)

### Next Steps
- Consider adding a shortcut to jump directly to other future scenes as they are created
- Remove or gate shortcuts more strictly before any public/release build

---

## 2026-03-17 — v0.5.53: Pixel art characters for all players — random gender, directional sprites, walk animations

**Commit:** 331c2f3

### Summary
Extended the pixel art character system (previously only used for the local player) to cover all other human-controlled or AI-controlled characters in the game world. Remote network players and Friend Hut allies now each get a randomly-assigned male or female pixel art character with full directional facing and walk animation support. The local player's gender is also re-randomised on every page load instead of being locked in for the session.

### Changes Made
- `js/menu.js` — removed session persistence check; `window._charVariant` is now re-assigned fresh on every page load, guaranteeing a new random gender each game start
- `js/game.js` — `spawnAlly()` now picks a random `male`/`female` variant, uses the corresponding `{variant}_south` texture, and stores `_charVariant` / `_lastDir` on the sprite
- `js/game.js` — ally movement loop updated to play directional walk animations via `facingToDirection()` + `player_walk_{dir}` keys when moving, and idle to a static directional frame when stopped
- `js/game.js` — `network.onPeerState` handler updated to use pixel art directional sprites for remote players: plays walk animation when the remote position delta indicates movement, idles to a static directional frame otherwise
- `assets/pixelart/survivor-female/` — added full pixel art female character asset set: 8-directional rotations + walking, lead-jab, and throw-object animation frames (137 PNGs + metadata.json)

### Rationale
Ally and remote player sprites were still using the old coloured procedural textures while the local player had been upgraded to pixel art. This brings all visible humans in the game to the same visual standard and makes each session visually distinct because every character's gender is independently random.

### Excluded from commit
- `test-results/` (Playwright output)
- `assets/pixelart/*.zip` (source archives)
- `assets/pixelart/make_spritesheets.py` (build utility)
- `notes.md` (not tracked)

### Next Steps
- Verify remote player directional sprites render correctly when `fy` data is present in the network state
- Consider broadcasting the chosen variant in the network state so remote players can see the correct gender consistently across all peers
- Ally attack animation could be driven by the same directional system once attack frames are wired up

---

## 2026-03-17 — feat: data-driven character variant system with female character

**Commit:** 95ec791

### Summary
Full overhaul of the player character system to support multiple character variants selected randomly each session. A complete female character set (walk, melee, ranged — all 8 directions) was added at the same quality level as the existing male character. The asset structure was reorganised from flat spritesheets into a folder hierarchy, and all game code was made variant-agnostic through a shared prefix pattern.

### Changes Made
- `assets/characters/male/` — 32 PNGs across rotations/, walk/, melee/, ranged/ subfolders (8 directions each)
- `assets/characters/female/` — 32 PNGs across the same subfolder structure
- `js/menu.js` — added `CHAR_VARIANTS` array (`['male', 'female']`), random selection stored in `window._charVariant`, all animations registered under a `player_` prefix so downstream code needs no variant awareness
- `js/game.js` — replaced hard-coded texture keys with `this._charPrefix` (derived from `window._charVariant`)
- `js/maze.js` — same `_charPrefix` substitution for player texture references

### Rationale
Randomising the character variant each session adds visual variety at no runtime cost. The data-driven design means adding a third variant (or any future variant) requires only a new folder and one string pushed to `CHAR_VARIANTS` — no logic changes.

### Excluded from commit
- `test-results/` (Playwright output)
- `assets/pixelart/*.zip` (source archives)
- `assets/pixelart/make_spritesheets.py` (build utility)
- `assets/pixelart/survivor-female/` (raw source sprites)
- `notes.md` (not tracked)

### Next Steps
- Verify both character variants render correctly for all animation states in-game
- Consider persisting the chosen variant across a session restart (or intentionally re-rolling it)
- Future: add a third variant by dropping a new folder into assets/characters/ and appending to CHAR_VARIANTS

---

## 2026-03-17 — fix: set lit flag on main bonfire at creation

**Commit:** abd4866

### Summary
The main bonfire was never assigned `setData('lit', true)` at creation time. Only secondary camps received this flag (via `_lightSecondCamp`). The shadow system builds its light source list by iterating bonfires and checking the `'lit'` data flag, so the main bonfire was never included — leaving the list empty and causing no shadows to be drawn at all.

### Changes Made
- `js/game.js` — `_createBonfire`: added `bonfire.setData('lit', isMain ? true : false)` immediately after the existing `campFireLevel` data assignment. Main bonfires are flagged `true` at creation; secondary camps are initialised to `false` (their flag is set later via `_lightSecondCamp` as before).

### Rationale
The shadow system was architecturally correct — it just never had any input because the main bonfire's `lit` flag was absent. A single-line data assignment at bonfire creation restores shadow rendering without touching the shadow update logic or the secondary-camp lighting path.

### Excluded from commit
- `test-results/` (Playwright output)
- `.zip` source archives
- `make_spritesheets.py` (build utility)
- `notes.md` (not tracked)

### Next Steps
- Verify shadows appear immediately when entering a new game world (main bonfire lit from the start)
- Confirm secondary camp shadows still activate correctly when `_lightSecondCamp` runs
- Check that extinguishing the main bonfire (if ever implemented) correctly clears the `lit` flag

---

## 2026-03-17 — feat: improve shadow systems in overworld and maze

**Commit:** aed297f

### Summary
Extended and refined shadow casting in both the overworld and maze/dungeon scenes. The overworld now scopes shadows to each bonfire's actual light radius and adds outpost buildings as light sources. The maze introduces a brand-new player-as-torch shadow system for enemies, throttled and culled for performance.

### Changes Made

**js/game.js (overworld)**
- Shadows are only cast on objects that fall within a bonfire's `getLightRadius` — objects outside the radius receive no shadow.
- Each object independently finds its nearest lit bonfire, so two bonfires in view each cast their own independent shadow on nearby objects.
- Outpost buildings now act as light sources with a radius of 120px.
- Shadow opacity fades smoothly as objects approach the edge of the light radius, producing a soft falloff rather than a hard cutoff.

**js/maze.js (dungeon)**
- New shadow system where the player's torch is the sole light source.
- Enemies cast shadows directed away from the player, within a torch radius of 145px.
- Update loop throttled to 15 fps and shadows are camera-culled (off-screen enemies are skipped) to keep performance consistent on large dungeon floors.

### Rationale
The overworld shadow system previously had no concept of light radius, meaning objects far beyond a bonfire's visible glow still received shadows. Scoping to `getLightRadius` and supporting multiple independent bonfires makes shadows physically plausible and visually consistent with the lighting. The maze shadow system is new — giving the player a torch that casts enemy shadows reinforces the dungeon atmosphere and rewards awareness of enemy positions.

### Excluded from commit
- `test-results/` (Playwright output)
- `.zip` source archives
- `make_spritesheets.py` (build utility)
- `notes.md` (not tracked)

### Next Steps
- Tune torch radius (currently 145px) and falloff curve for dungeon feel
- Consider adding shadow for the player themselves in the maze (self-shadow on walls)
- Verify multiple-bonfire shadow rendering with 3+ bonfires clustered close together

---

## 2026-03-17 — feat: geometrically correct directional shadow casting

**Commit:** db89c44

### Summary
Replaced the simple `fillEllipse` shadow with a rotated 16-segment polygon ellipse that is stretched away from the bonfire along the precise light-to-object angle. Shadow length now scales with each object's height and falls off with distance from the fire, producing realistic directional shadows for all shadow-casting objects.

### Changes Made
- `js/game.js` — `_updateShadows` / `drawShadow`:
  - Signature extended: `drawShadow(baseX, baseY, objW, objH)` — object height is now a first-class parameter.
  - Shadow length formula: `min(objH * 1.2, objH * 400 / dist)` — taller objects cast longer shadows; length falls off with distance.
  - Shadow centre offset: `(baseX + cos(angle) * shadowLen * 0.5, baseY + sin(angle) * shadowLen * 0.5)` — always points directly away from the light source.
  - Ellipse drawn as a 16-segment polygon: `halfW = objW * 0.3` (narrow), `halfH = shadowLen * 0.5` (long), rotated by the light-to-object angle using a 2D rotation matrix.
  - Alpha range tightened to `0.05–0.3` (was `0.06–0.3`).
  - Trees: `(tree.x, tree.y, tree.width || 48, tree.height || 64)`.
  - Player: `(p.x, p.y + ..., 20, 32)` — narrower and shorter than before.
  - Enemies: `(e.x, e.y + sz * 0.3, sz * 1.2, sz * 1.5)`.
  - Allies: `(a.x, a.y + 10, 18, 28)`.

### Rationale
The previous flat ellipse had no concept of object height; shadow size and direction were tied only to distance from the light. By parameterising height and rotating the ellipse polygon to match the exact light angle, shadows now behave like cast shadows in a real top-down scene — long and dramatic when the fire is close or the object is tall, short and faint at the edge of the light radius.

### Excluded from commit
- `test-results/` (Playwright output)
- `.zip` source archives
- `make_spritesheets.py` (build utility)
- `notes.md` (not tracked)

### Next Steps
- Tweak `halfW` multiplier per object type if shadows look too narrow on large trees
- Consider a soft-edge pass (outer polygon at lower alpha) for a penumbra effect
- Play-test with multiple bonfires in view to verify the nearest-bonfire selection reads correctly

---

## 2026-03-17 — fix: correct shadow positioning to object base/feet

**Commit:** aea91ed

### Summary
Refactored `drawShadow` in `GameScene._updateShadows` to accept explicit base coordinates instead of a sprite object, ensuring all shadow ellipses originate at the actual foot/base of each object rather than at the sprite's anchor point. Ally shadows were also added for the first time.

### Changes Made
- `js/game.js` — `_updateShadows`:
  - `drawShadow(obj, w, h)` signature replaced with `drawShadow(baseX, baseY, w)`. Height is no longer needed; shadow height is derived from stretch length alone (`6 + len * 0.15`).
  - Shadow offset reduced: x-stretch factor `0.5`, y-stretch factor `0.3` (previously the offset included a `h * 0.2` vertical displacement unrelated to light direction).
  - Shadow max length reduced from 30 to 24; falloff from `800/dist` to `500/dist`. Alpha range tightened to `0.06–0.3`.
  - Trees: called with `(tree.x, tree.y, tree.width || 48)` — origin `(0.5, 1)` means `tree.y` is already the trunk base.
  - Player: called with `(p.x, p.y + (p.height || 48) * 0.3, 28)` to approximate foot position.
  - Enemies: called with `(e.x, e.y + sz * 0.3, sz * 1.5)` using raw `size` data value.
  - Allies: new loop added — `(a.x, a.y + 10, 24)` per active ally.

### Rationale
The previous `drawShadow` offset used `h * 0.2` as a fixed vertical displacement regardless of light direction, which placed shadows below and behind objects rather than directly underfoot. By passing the base position explicitly and computing the ellipse stretch purely from the light angle, shadows now sit correctly on the ground at each object's feet.

### Excluded from commit
- `test-results/` (Playwright output)
- `.zip` source archives
- `make_spritesheets.py` (build utility)
- `notes.md` (not tracked)

### Next Steps
- Verify ally shadow sizes look appropriate relative to ally sprite dimensions
- Consider clamping the enemy base Y offset to avoid shadow floating on very small enemies (size < 8)
- Play-test near bonfires to confirm the shadow stretch direction reads naturally from all angles

---

## 2026-03-17 — feat: dynamic bonfire shadows for trees, player, and enemies

**Commit:** a62a9b2

### Summary
Added a real-time shadow system driven by lit bonfires. Each frame (throttled to ~15fps), the nearest lit bonfire to the camera centre is used as the light source. Trees, the player, and enemies all receive an ellipse shadow that stretches away from the light, grows longer when closer, and fades in opacity with distance.

### Changes Made
- `js/game.js` — `GameScene.create`: added `_shadowTimer` throttle counter and `_shadowGfx` graphics object at depth 0.5 (below all sprites).
- `js/game.js` — `update`: increments `_shadowTimer` by `delta`; calls `_updateShadows()` when the timer exceeds 66ms (approx 15fps), then resets.
- `js/game.js` — new `_updateShadows()` method:
  - Clears and redraws the graphics layer each call.
  - Builds a camera-bounds rect (with 100px margin) to skip off-screen objects.
  - Iterates `this.bonfires` to find the nearest lit bonfire to the camera centre; uses camera centre as fallback if no bonfire is lit.
  - `drawShadow(obj, w, h)` helper: computes angle away from light, shadow length (`min(30, 800/dist)`), offset position, and alpha (`0.35 - dist/600 * 0.3`, floored at 0.05); draws a filled black ellipse.
  - Calls `drawShadow` for all active trees, the player sprite, and all active enemies.
- `assets/pixelart/` — new tileset variants committed: `ground-tileset-dark.png`, `ground-tileset-elevated.png`, `ground-tileset-flat.json/.png`, `ground-tileset-new.json/.png`, `ground-tileset-v3.json/.png`.

### Rationale
Shadows anchored to bonfire positions tie the lighting atmosphere directly to gameplay — a player standing close to a bonfire sees long, dramatic shadows, while enemies lurking at the edge of the light radius cast only faint traces. Throttling to 15fps keeps the GPU/CPU cost negligible versus rendering every frame.

### Excluded from commit
- `test-results/` (Playwright output)
- `.zip` source archives
- `make_spritesheets.py` (build utility)
- `notes.md` (not tracked)

### Next Steps
- Consider per-bonfire shadow blending when multiple bonfires are lit (weighted average of light positions)
- Evaluate whether shadow ellipses should scale with sprite scale for larger enemies
- Wire new tileset variants into the map editor or scene loader when ready

---

## 2026-03-17 — fix: prevent walk/idle from overriding attack animations

**Commit:** 503e7d9

### Summary
Attack animations (melee jab and ranged throw) were being cut short because the walk/idle direction update ran every frame and immediately replaced the attack animation. `_updatePlayerDir` in both `game.js` and `maze.js` now detects when a `player_melee_*` or `player_ranged_*` animation is actively playing and skips the walk/idle update until the attack animation completes.

### Changes Made
- `js/game.js` — `_updatePlayerDir`: reads `p.anims.currentAnim?.key`, checks for `player_melee_` or `player_ranged_` prefix with `p.anims.isPlaying`; if true, caches `p._lastDir` and returns early. Also removed redundant re-read of `currentAnim.key` when switching to walk animation.
- `js/maze.js` — movement update block: same guard added before the velocity-driven walk/idle branch, so the maze scene respects attack animations the same way the overworld does. Weapons with `attackType` of `swing` or `thrust` trigger the melee jab animation; `shoot` triggers the ranged throw animation.

### Rationale
The fix was minimal and surgical — no changes to animation playback logic, only a guard condition in the direction-update path. This preserves all existing walk/idle/direction behaviour while ensuring attack animations play to completion.

### Excluded from commit
- `test-results/` (Playwright output)
- `.zip` source archives
- `make_spritesheets.py` (build utility)
- `notes.md` (not tracked)
- New tileset asset files not yet referenced in code

### Next Steps
- Test all weapon types (swing, thrust, shoot) in both overworld and maze scenes to confirm full animation playback
- Confirm animation completion callbacks (if any) fire correctly after the guard returns early

---

## 2026-03-17 — feat: broadcast proximity heal event so remote player sees floating text

**Commit:** b6ea46c

### Summary
Proximity healing now broadcasts a `heal` network message to the peer so the other player sees a green "+3" floating text appear on the healing player's sprite. Previously the visual was only local.

### Changes Made
- `js/network.js` — added `heal` message case in the incoming-message switch; calls `this.onHeal(fromPeerId, msg.amt)` when received.
- `js/game.js` — two changes:
  - In the proximity heal block, after applying the heal, calls `network.broadcastReliable({ t: 'heal', amt: healAmount })` when there are connected peers.
  - Registers `network.onHeal` handler that looks up the remote player sprite by peer ID and calls `showFloatingText` with `'+' + amt` in green (`#00FF66`).

### Rationale
The healing player already saw their own floating text locally, but the peer had no indication the other player was being healed. This change closes that visibility gap so both players have the same feedback during cooperative play.

### Excluded from commit
- `test-results/` (Playwright output)
- `.zip` source archives
- `make_spritesheets.py` (build utility)
- `notes.md` (not tracked)
- New tileset asset files not yet referenced in code

### Next Steps
- Consider adding a brief green flash or tint on the remote sprite when healing fires, in addition to floating text
- Verify the heal visual appears correctly when the local player is the one being healed by the peer (reverse direction)

---

## 2026-03-17 — v0.5.53: Major rendering performance optimizations

**Commit:** e2e0bbb

### Summary
Four targeted CPU/rendering optimizations that collectively eliminate the bulk of per-frame overhead in large world scenes: tree tweens replaced with camera-culled sine sway, static objects removed from the depth-sort loop, Wang tile road rendering collapsed into a single RenderTexture, and fog-of-war and enemy HP drawing throttled to sub-frame rates.

### Changes Made
- `js/game.js` — all changes confined to this file:
  - Replaced all tree Phaser tweens with `setData`-stored sway parameters (`swayOff`, `swaySpd`, `swayAng`). New `_updateTreeSway(time)` method runs each frame but skips any tree outside camera bounds + 80px margin.
  - Added one-time `setDepth(y)` calls at world-generation time for trees, stones, metals, rock walls, and metal mines. Removed these five groups from `updateDepthSort()` entirely, which now only iterates player, enemies, allies, remote players, buildings, projectiles, and drops.
  - `_drawRoadTiles()` now computes a bounding box over all path tiles, creates a single `RenderTexture` at world coords, and draws all Wang tile frames into it via `rt.drawFrame()`. No individual `add.image` calls remain for road tiles.
  - `_fogTimer` and `_hpDrawTimer` accumulators added; fog-of-war updates only when `_fogTimer > 50` (~20fps) and enemy HP draws only when `_hpDrawTimer > 100` (~10fps).

### Rationale
Profiling showed per-frame cost dominated by: (a) Phaser tween engine updating 1000+ tree tweens every tick, (b) depth-sort iterating 2000+ static objects that never move, (c) hundreds of individual draw calls for road tile images, and (d) full-rate fog-of-war and HP canvas redraws. None of these required per-frame precision, so eliminating or throttling them provides large CPU savings with no perceptible visual change.

### Excluded from commit
- `test-results/` (Playwright output)
- `.zip` source archives
- `make_spritesheets.py` (build utility)
- `notes.md` (not tracked)
- New tileset asset files not yet referenced in code

### Next Steps
- Profile with browser devtools to confirm expected frame time reduction
- Consider frustum-culling enemies and projectiles from depth sort as a follow-up
- Investigate whether buildings group also qualifies for one-time depth assignment

---

## 2026-03-17 — feat: add player attack animations in all 8 directions

**Commit:** a6bfd53

### Summary
Added directional attack animations for the player character covering all 8 compass directions. Two variants: a quick melee jab (lead-jab, 3 frames) and a slower ranged throw/cast (throw-object, 7 frames). The correct animation is chosen at runtime based on weapon type, and the player returns to idle automatically when the animation completes.

### Changes Made
- `assets/pixelart/spritesheets/` — 16 new spritesheets (8 melee + 8 ranged, one per direction)
- `assets/pixelart/survivor-player-full/` — source frames for lead-jab, throw-object, and walking animations, plus rotation reference sprites and metadata.json
- `js/menu.js` — loads all 16 attack spritesheets during preload; registers Phaser animations (melee at 12fps, ranged at 14fps, repeat: 0)
- `js/game.js` — `playerAttack()` selects `player_ranged_<dir>` for shoot-type weapons, `player_melee_<dir>` for all others; returns to idle on `animationcomplete`
- `js/maze.js` — same `playerAttack()` logic applied to the dungeon/maze scene

### Rationale
The previous attack system had no visual feedback for the player character's attack action. These animations give the player a clear, directional cue for both melee and ranged combat, and the weapon-type branch keeps the logic extensible for future weapon categories (e.g. magic staff could reuse ranged).

### Excluded from commit
- `test-results/` (Playwright output)
- `.zip` source archives
- `make_spritesheets.py` (build utility)
- `notes.md` (not tracked)
- Backup/temp tileset files

### Next Steps
- Overlay weapon sprites as a separate layer on top of the melee animation
- Add hit-flash or impact particle at the end of the melee animation
- Consider a brief attack-locked movement window to prevent animation cancelling
- Evaluate whether 12fps vs 14fps feels right on mobile at different screen sizes

---

## 2026-03-17 — v0.5.53: Reduce enemy melee range to 8px (touching only)

**Commit:** 324e15e

### Summary
Added `CONFIG.ENEMY_MELEE_RANGE = 8` and replaced every hardcoded melee distance check across all enemy AI types. Enemies now only strike the player when they are essentially touching (8px), creating tighter, more readable melee combat and a single authoritative constant to tune in the future.

### Changes Made
- `js/config.js` — added `ENEMY_MELEE_RANGE: 8` to the CONFIG object, grouped with the Raider system constants
- `js/game.js` — replaced five separate hardcoded distance thresholds (10px, 14px, 14px, 24px, 14px) with `CONFIG.ENEMY_MELEE_RANGE` across:
  - Regular enemy attack check
  - Lair enemy stop-and-attack transition
  - Raider chase-mode melee stop
  - Fog crawler melee priority check
  - Shadow Mind `ATTACK_PLAYER` state

### Rationale
Previous thresholds were scattered and inconsistent (10–24px), making it difficult to understand or adjust the intended melee feel. Consolidating to a single constant at 8px aligns behaviour with a "must be touching" design intent and removes maintenance risk when tuning combat feel.

### Excluded from commit
- `test-results/` (Playwright output)
- `.zip` source archives
- `make_spritesheets.py` (build utility)
- `notes.md` (not tracked)
- Backup/temp tileset files

### Next Steps
- Play-test to verify enemies feel responsive at the new close range without appearing to teleport attacks
- Consider adding a short approach burst so enemies don't stall right outside 8px
- Tune `CONFIG.ENEMY_MELEE_RANGE` up from 8 if the hitbox feels frustratingly tight on mobile

---

## 2026-03-17 — fix: fix tree visual positioning and Y-sorting

**Commit:** 3eeaa84

### Summary
Corrected the visual and physics placement of pixel art trees in the MazeScene world. Trees now sit at the right depth in the scene — the canopy extends above the collision tile and the trunk/roots land on it — and Y-sorting works correctly so the player walks behind trees that are above them and in front of trees that are below them.

### Changes Made
- `js/game.js` — three targeted fixes in `GameScene`:
  - Tree spawn Y shifted up by one tile (`wy - T`) for pixel art trees so the sprite is anchored with the trunk on the original tile and the canopy above it.
  - Collision body reduced from 22x28 to 22x14, offset repositioned to the trunk base, removing phantom collision from the canopy area.
  - `tree.setDepth(tree.y * 0.01)` added after origin/position adjustment so depth is derived from the trunk base Y, enabling proper Y-sorting with the player and other world objects.

### Rationale
The previous placement placed the full sprite height centred on the tile, meaning the canopy was too low and the collision body covered part of the canopy. Y-sorting was also broken because `setDepth(3)` was a fixed value rather than a position-based one, so the player could not walk behind or in front of trees depending on their relative vertical positions.

### Excluded from commit
- `test-results/` (Playwright output)
- `.zip` source archives
- `make_spritesheets.py` (build utility)
- `notes.md` (not tracked)
- Backup/temp tileset files

### Next Steps
- Play-test to confirm no tree sprites clip into the ground or float above it at different tile sizes
- Verify Y-sorting at the edges of tree clusters where multiple trunks are close together
- Consider applying the same trunk-base depth approach to other tall sprites (rocks, structures)

---

## 2026-03-17 — v0.5.53: Add pixel art sprites for all stone/rock objects

**Commit:** ede1a05

### Summary
Added four new hand-crafted pixel art sprites covering every stone, ore, and rock object in the game world. The game engine now checks for these loaded textures before falling back to procedural generation, so all stone/metal/rock creation points render consistently using the authored art. The four sprites cover the full range of use cases: small mineable deposits, copper ore veins, a large impassable boulder, and a large mineable rock formation with copper markings.

### Changes Made
- `assets/pixelart/stone_deposit.png` — new sprite, 32x32: dark grey stone cluster for mining
- `assets/pixelart/metal_ore.png` — new sprite, 32x32: copper ore with orange veins
- `assets/pixelart/rock_wall.png` — new sprite, 64x48: large impassable boulder
- `assets/pixelart/metal_mine.png` — new sprite, 48x48: large mineable rock formation with copper
- `js/menu.js` — preloads all four new stone/rock images on startup
- `js/textures.js` — skips procedural texture generation when the corresponding pixel art asset is already loaded
- `js/game.js` — switches all stone/metal/rock object creation points to use the pixel art texture keys

### Rationale
Previously, stone and rock objects were rendered via procedural canvas generation, producing inconsistent results and making it difficult to match the visual style of the rest of the world. Replacing them with authored pixel art sprites ensures visual consistency, allows fine-grained control over each asset's appearance, and removes the runtime cost of procedural generation for these objects. The conditional skip in textures.js means the change is backward-compatible if a sprite fails to load.

### Excluded from commit
- `test-results/` (Playwright output)
- `.zip` source archives
- `make_spritesheets.py` (build utility)
- `notes.md` (not tracked)
- Backup/temp tileset files (`ground-tileset-dark.png`, `-elevated`, `-flat`, `-new`, `-v3`)

### Next Steps
- Play-test to verify sprite sizes and collision bodies match each object's intended footprint
- Check that metal_mine and rock_wall display correctly at all zoom levels
- Consider adding a subtle sparkle or glint animation to metal_ore for readability

---

## 2026-03-17 — feat: add tree variants with wind sway animation

**Commit:** ea72e23

### Summary
Added four new pixel art tree sprite variants (pine, oak, dead/spooky, birch) to give the world's forests visual variety. World generation now uses the level's seeded RNG to pick a variant per tree, keeping layouts deterministic across sessions. All trees animate with a gentle wind sway via Phaser tweens — each tree has a staggered start delay, randomized duration and angle range, and its pivot is set at the trunk base so rotation looks physically grounded.

### Changes Made
- `assets/pixelart/tree_pine.png` — new sprite, 48x64
- `assets/pixelart/tree_oak.png` — new sprite, 40x48
- `assets/pixelart/tree_dead.png` — new dead/spooky variant, 40x56
- `assets/pixelart/tree_birch.png` — new sprite, 36x64
- `js/menu.js` — preloads all four new tree images on startup
- `js/game.js` — builds `_treeVariants` array from available textures; selects variant per tree via seeded `rng()`; sets `origin(0.5, 1)` on each tree for trunk-base pivot and adjusts y accordingly; adds Phaser tween (Sine.easeInOut, yoyo, repeat -1) with per-tree stagger; derives collision body offset dynamically from sprite dimensions

### Rationale
A forest composed entirely of one identical tree sprite looked monotonous and broke immersion. Introducing four distinct variants (and especially the dead/spooky tree) reinforces the dark-woods atmosphere. The wind sway gives the world a sense of life without requiring additional animation frames — tweens handle it at runtime with negligible cost. Seeding variant selection through the existing world RNG ensures a given map seed always produces the same forest layout.

### Excluded from commit
- `test-results/` (Playwright output)
- `.zip` source archives
- `make_spritesheets.py` (build utility)
- `notes.md` (not tracked)
- Backup/temp tileset files

### Next Steps
- Tune sway angle/duration constants after in-game play-test
- Consider adding a subtle alpha flicker to the dead tree for extra atmosphere
- Verify collision bodies are correctly sized for all four sprite dimensions

---

## 2026-03-17 — assets: Replace ground tileset with dark forest version

**Commit:** 43bc3a8

### Summary
Replaced `assets/pixelart/ground-tileset.png` with a dark forest version suited to the game's dark woods setting. The light sandy path is now a dark brown earthy trail, the bright green ground is now a dark green forest floor, and tile transitions use natural dark blending throughout. No code changes — asset swap only.

### Changes Made
- `assets/pixelart/ground-tileset.png` — full visual rework: dark brown earthy trail, dark green forest floor, natural dark tile transitions (binary size reduced from ~7 KB to ~4 KB)

### Rationale
The previous tileset used a light sandy path and bright grassy tones that clashed with the game's dark atmospheric setting. The replacement palette aligns the ground visuals with the dark woods environment the game takes place in, improving overall cohesion.

### Excluded from commit
- `test-results/` (Playwright output)
- `.zip` source archives
- `make_spritesheets.py` (build utility)
- `notes.md` (not tracked)
- Backup/temp tileset files (`ground-tileset-dark.png`, `ground-tileset-elevated.png`, `ground-tileset-flat.png`, `ground-tileset-new.png`, `ground-tileset-v3.png`, and associated JSON files)

### Next Steps
- Play-test across all map regions to confirm the dark forest floor reads clearly at standard zoom
- Verify path visibility is sufficient in low-light scenes

---

## 2026-03-17 — v0.5.53: Regen ground tileset, darken base ground colors

**Commit:** dd06206

### Summary
Replaced `assets/pixelart/ground-tileset.png` with a cleaner regeneration that eliminates black line seam artifacts and produces a smooth sandy path with soft grass-to-sand transitions. Also darkened the procedural base ground colors in `js/textures.js` from the `0x2d4a2d` range to the `0x1e3520` range so the fallback tile colors better match the tileset's dark forest floor tones.

### Changes Made
- `assets/pixelart/ground-tileset.png` — artifact-free regen, smooth sandy path, soft grass-to-sand edges (binary size reduced from ~13 KB to ~7 KB)
- `js/textures.js` — base ground colors darkened (`0x2d4a2d` → `0x1e3520`, `0x305030` → `0x213822`, `0x284428` → `0x1b311d`, `0x2c4c2c` → `0x1f3621`); detail dot count reduced from 8 to 6; added darker shadow-detail pass (3 dots at `0x162a16`)

### Rationale
The previous tileset had visible black-pixel seam artifacts along tile edges, and the sandy path lacked smooth blending with the surrounding grass. The procedural ground textures rendered noticeably lighter than the pixel art tiles they appeared alongside, breaking visual cohesion. Both changes together align the in-engine ground appearance with the tile art's forest floor palette.

### Excluded from commit
- `test-results/` (Playwright output)
- `.zip` source archives
- `make_spritesheets.py` (build utility)
- `notes.md` (not tracked)
- Backup/temp tileset files (`ground-tileset-elevated.png`, `ground-tileset-flat.png`, `ground-tileset-new.png`, `ground-tileset-v3.png`, and associated JSON files)

### Next Steps
- Play-test across all map regions at standard zoom to confirm seams are fully gone
- Verify dark forest floor colors don't make the ground too difficult to read in low-light scenes

---

## 2026-03-17 — assets: replace ground tileset with photorealistic forest-floor version

**Commit:** a9b86d0

### Summary
Replaced `assets/pixelart/ground-tileset.png` with a new photorealistic top-down version. The new tileset depicts a dark forest floor (moss, fallen leaves, twigs) transitioning to a dirt path via soft sandy edges, replacing the previous brown elevation-like borders. Detail shading is significantly higher and the perspective is a strict high top-down view. The Wang tile layout is preserved exactly, so no code changes were required.

### Changes Made
- `assets/pixelart/ground-tileset.png` — new photorealistic tile sheet (same Wang tile arrangement, binary size reduced from ~19 KB to ~13 KB)

### Rationale
The previous tileset used simple brown borders that read as elevation changes rather than natural ground transitions. The new version uses organic materials (moss, leaf litter, sandy dirt edges) that are more consistent with a dark forest setting and give the environment a more grounded, atmospheric look without requiring any map or autotiling logic changes.

### Excluded from commit
- `test-results/` (Playwright output)
- `.zip` source archives
- `make_spritesheets.py` (build utility)
- `notes.md` (not tracked)
- Backup/temp tileset files (`ground-tileset-elevated.png`, `ground-tileset-flat.png`, `ground-tileset-new.png`, and associated JSON files)

### Next Steps
- Review tileset in-game across all map regions to confirm moss/dirt transitions read correctly at play zoom levels
- Consider matching tree trunk or wall tile shading to the new forest-floor palette

---

## 2026-03-17 — feat: add 8-direction walk animations for player and stalker

**Commit:** a9620bd

### Summary
Added full 8-directional walk animations for the two main pixel art characters: the survivor-player and the shadow-stalker enemy. Each character has 6-frame walk cycles at 48x48 pixels per frame, covering all cardinal and diagonal directions (N, NE, E, SE, S, SW, W, NW).

### Changes Made

**New assets**
- `assets/pixelart/spritesheets/` — 16 spritesheet PNGs (8 directions x 2 characters), each a 6-frame horizontal strip at 48x48px per frame
- `assets/pixelart/survivor-player-anim/` — source animation frames and rotation previews for the player character
- `assets/pixelart/shadow-stalker-anim/` — source animation frames and rotation previews for the stalker enemy

**JS changes**
- `js/menu.js` — loads all 16 walk spritesheets during preload; registers Phaser animation keys (e.g. `player_walk_south`) in `create()`
- `js/game.js` — `_updatePlayerDir` now plays the matching directional walk animation while the player is moving and snaps to idle frame when stopped; stalker enemies use the same directional walk logic
- `js/maze.js` — player walk animations wired up in the dungeon/maze scene using the same animation keys
- `js/textures.js` — removed broken canvas texture extraction for ground tiles; sprites now use spritesheet frames directly, fixing a game hang

### Rationale
Previously characters used static sprites with no movement feedback. Directional walk animations make movement feel responsive and give the game a much more polished feel. The textures.js fix was a prerequisite — the broken canvas extraction was causing the game to hang on load in certain scenes.

### Excluded from commit
- `test-results/` (Playwright output)
- `.zip` source archives
- `make_spritesheets.py` (build utility)

### Next Steps
- Consider adding run/sprint animations at a higher frame rate
- Idle animations (subtle breathing or blinking) would complement the walk cycles
- Attack animations per direction would complete the character animation set

---
