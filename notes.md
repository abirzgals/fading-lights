# Fading Lights — Project Notes

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
