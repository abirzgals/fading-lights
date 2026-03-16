// ============================================================
// GROQ AI ENEMY — Shadow Mind
// Uses Groq inference to plan tactical steps every few seconds.
// Model: openai/gpt-oss-120b (OpenAI GPT OSS 120B via Groq)
// ============================================================

// Cloudflare Worker proxy — holds the API key server-side (no key needed in client code)
const GROQ_ENDPOINT = 'https://thefadinglight.arturs-birzgals.workers.dev';

// All model params — change here without touching the Worker
const GROQ_MODEL       = 'openai/gpt-oss-120b';
const GROQ_TEMPERATURE = 0.4;
const GROQ_MAX_TOKENS  = 2000;

// Stats for the Shadow Mind enemy type
const SHADOW_MIND_STATS = {
    name: 'Shadow Mind',
    hp: 220,
    damage: 3,
    speed: 68,
    xp: 150,
    size: 24,
    gold: 20,
    color: 0x9900CC,
};

const groqEnemyAI = {
    log: [],   // [{ts, type, content}] — last 30 entries for debug panel
    _MAX_LOG: 30,

    _pushLog(type, content) {
        const d = new Date();
        const ts = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
        this.log.push({ ts, type, content });
        if (this.log.length > this._MAX_LOG) this.log.shift();
    },

    // ----------------------------------------------------------
    // 1. BUILD WORLD STATE — snapshot of everything the AI needs
    //    All positions and distances are in TILES (1 tile = 32 px).
    //    Distances use Euclidean (√(dx²+dy²)) so diagonals are correct.
    // ----------------------------------------------------------
    buildWorldState(enemy, scene) {
        const T = CONFIG.TILE_SIZE;

        const ex = Math.round(enemy.x / T);
        const ey = Math.round(enemy.y / T);
        const px = Math.round(scene.player.x / T);
        const py = Math.round(scene.player.y / T);

        // Euclidean tile distance helper
        const tileDist = (ax, ay, bx, by) => Math.round(Math.sqrt((bx-ax)**2 + (by-ay)**2));

        const distToPlayerTiles = tileDist(ex, ey, px, py);
        // Keep pixel distance only for internal threshold checks
        const distToPlayerPx = Phaser.Math.Distance.Between(
            enemy.x, enemy.y, scene.player.x, scene.player.y);

        // All player fire camps — positions and distances in tiles
        const camps = scene.bonfires
            .filter(b => !b.getData('isLairCamp'))
            .map((b, i) => {
                const fuel    = b.getData('fuel') || 0;
                const maxFuel = b.getData('maxFuel') || 1;
                const lit     = !!(b.getData('lit') || b.getData('isMain'));
                const btx     = Math.round(b.x / T);
                const bty     = Math.round(b.y / T);
                return {
                    idx:     i,
                    label:   b.getData('isMain') ? 'MAIN BASE' : 'OUTPOST',
                    tx:      btx,
                    ty:      bty,
                    fuelPct: Math.round((fuel / maxFuel) * 100),
                    lit,
                    dist:    tileDist(ex, ey, btx, bty),
                };
            });

        // Nearby player buildings within 25 tiles (~800 px)
        const buildings = [];
        if (scene.buildingsGroup) {
            for (const b of scene.buildingsGroup.children.entries) {
                if (!b.active) continue;
                const btx  = Math.round(b.x / T);
                const bty  = Math.round(b.y / T);
                const dist = tileDist(ex, ey, btx, bty);
                if (dist < 25) {
                    const atkRange = b.getData('attackRange') || 0;
                    const bhp      = b.getData('hp') || 0;
                    const bmaxHp   = BUILDINGS[b.getData('type')]?.hp || bhp || 1;
                    buildings.push({
                        idx:              buildings.length,
                        type:             b.getData('type') || 'BUILDING',
                        tx:               btx,
                        ty:               bty,
                        dist,
                        attackRangeTiles: Math.round(atkRange / T),  // 0 = not a shooter
                        hpPct:            Math.round((bhp / bmaxHp) * 100),
                    });
                }
            }
        }

        const hpPct  = Math.round((enemy.getData('hp') / enemy.getData('maxHp')) * 100);
        const pHpPct = Math.round(((gameState.hp ?? gameState.health ?? 100) / (gameState.maxHealth || CONFIG.PLAYER_MAX_HP)) * 100);
        const meleeRng = (enemy.getData('size') || 22) + 34; // px, internal only

        return {
            self:   { tx: ex, ty: ey, hpPct, damage: enemy.getData('damage') },
            player: {
                tx: px, ty: py, hpPct: pHpPct,
                dist:        distToPlayerTiles,
                inMeleeRange: distToPlayerPx < meleeRng,
                canSee:       distToPlayerPx < 420,
            },
            camps,
            buildings,
            gameTimeSec: Math.floor(gameState.time),
        };
    },

    // ----------------------------------------------------------
    // 2. BUILD PROMPT — AD&D flavoured tactical briefing
    //    All coordinates and distances are in TILES.
    // ----------------------------------------------------------
    buildPrompt(ws, recentSteps) {
        const campsLines = ws.camps.map(c =>
            `  [${c.idx}] ${c.label}: tile(${c.tx},${c.ty}), fuel:${c.fuelPct}%, lit:${c.lit}, dist:${c.dist}t`
        ).join('\n');

        const buildLines = ws.buildings.length
            ? ws.buildings.map(b => {
                const danger = b.attackRangeTiles > 0
                    ? ` ⚠ TURRET range:${b.attackRangeTiles}t — stay >${b.attackRangeTiles}t away or destroy`
                    : '';
                return `  [${b.idx}] ${b.type} at tile(${b.tx},${b.ty}), dist:${b.dist}t, HP:${b.hpPct}%${danger}`;
              }).join('\n')
            : '  none nearby';

        const playerThreat = ws.player.inMeleeRange ? 'IN MELEE RANGE — strike now'
            : ws.player.canSee ? `visible, ${ws.player.dist}t away`
            : `out of sight, ${ws.player.dist}t away`;

        const recentSection = recentSteps && recentSteps.length > 0
            ? `\n=== YOUR LAST ACTIONS ===\n${recentSteps.map((s, i) => `  ${i + 1}. ${JSON.stringify(s)}`).join('\n')}\n`
            : '';

        return `You are SHADOW_MIND, an ancient darkness creature in a top-down survival game.
All positions and distances are in TILES (integers). Diagonal distance = round(√(dx²+dy²)).

=== CURRENT SITUATION ===
YOU       : tile(${ws.self.tx},${ws.self.ty}), HP:${ws.self.hpPct}%, dmg:${ws.self.damage}
PLAYER    : tile(${ws.player.tx},${ws.player.ty}), HP:${ws.player.hpPct}% — ${playerThreat}

FIRE CAMPS (drain their fuel to win):
${campsLines}

PLAYER BUILDINGS (avoid if dangerous, or destroy):
${buildLines}

GAME TIME: ${ws.gameTimeSec}s
${recentSection}
=== YOUR OBJECTIVE ===
PRIMARY  — extinguish ALL fire camps (attack each until fuelPct = 0)
SECONDARY — kill the player if they get in your way or have low HP
TERTIARY  — survive (flee if HP < 25%)

=== AVAILABLE ACTIONS ===
Each step MUST be a JSON object. All coords are tile integers.

{"action":"MOVE_TO","tx":75,"ty":55}
{"action":"ATTACK_CAMP","idx":0}
{"action":"ATTACK_PLAYER"}
{"action":"DESTROY_BUILDING","idx":0}
{"action":"FLEE","tx":60,"ty":70}
{"action":"WAIT","seconds":2}

=== TACTICAL HINTS ===
- TURRET shoots anything within its range (tiles). Before approaching a camp, check if a turret covers it.
  If so: DESTROY_BUILDING first, OR flank — move to the far side of the camp away from the turret.
  Flanking formula: flankTx = campTx + sign(campTx - turretTx) * (turretRange + 2)
- Prioritise camp with lowest fuelPct (closest to 0).
- If player HP < 30% and nearby (<8t), kill first.
- Max 5 steps. You will be re-queried after execution.

OUTPUT FORMAT — respond with ONLY this JSON, nothing else:
{"reasoning":"one concise sentence","steps":[{"action":"..."},{"action":"..."}]}`;
    },

    // ----------------------------------------------------------
    // 3. CALL GROQ API
    // ----------------------------------------------------------
    async queryGroq(worldState, recentSteps) {
        const prompt = this.buildPrompt(worldState, recentSteps);
        this._pushLog('REQUEST', prompt);

        let content = '';
        try {
            const resp = await fetch(GROQ_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model:           GROQ_MODEL,
                    temperature:     GROQ_TEMPERATURE,
                    max_tokens:      GROQ_MAX_TOKENS,
                    stream:          false,
                    response_format: { type: 'json_object' },
                    messages: [
                        {
                            role: 'system',
                            content: 'Tactical game AI. Output a JSON object with keys "reasoning" (string) and "steps" (array of action objects).',
                        },
                        { role: 'user', content: prompt },
                    ],
                }),
            });

            if (!resp.ok) {
                const errText = await resp.text();
                const msg = `HTTP ${resp.status}: ${errText.slice(0, 200)}`;
                console.warn('[GroqAI]', msg);
                this._pushLog('ERROR', msg);
                return null;
            }

            const data = await resp.json();
            const msg = data.choices?.[0]?.message || {};

            const internalThinking = msg.reasoning?.trim() || '';
            content = msg.content?.trim() || '';

            // Fallback: if content is empty (reasoning model used all tokens on thinking),
            // try to extract JSON from the internal reasoning text
            const searchIn = content || internalThinking;

            // Strip markdown fences just in case (some models add them despite instructions)
            const cleaned = searchIn.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

            const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
            if (!jsonMatch) throw new Error('No JSON object found in response');

            const plan = JSON.parse(jsonMatch[0]);
            console.log(`%c[Shadow Mind] ${plan.reasoning}`, 'color:#CC44FF;font-weight:bold');
            console.log('[Shadow Mind] Steps:', plan.steps);
            if (!Array.isArray(plan.steps)) return null;

            this._pushLog('RESPONSE', {
                reasoning: plan.reasoning || '',
                steps: plan.steps,
                thinking: internalThinking,   // internal model chain-of-thought for debug panel
            });
            return { steps: plan.steps, reasoning: plan.reasoning || '' };

        } catch (e) {
            const msg = `${e.message} | raw: ${content.slice(0, 120)}`;
            console.warn('[GroqAI] Parse/network error:', e.message, '\nRaw:', content.slice(0, 300));
            this._pushLog('ERROR', msg);
            return null;
        }
    },
};
