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
    damage: 28,
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
    // ----------------------------------------------------------
    buildWorldState(enemy, scene) {
        const T = CONFIG.TILE_SIZE;

        const eTile = { x: Math.round(enemy.x / T), y: Math.round(enemy.y / T) };
        const pTile = { x: Math.round(scene.player.x / T), y: Math.round(scene.player.y / T) };
        const distToPlayer = Math.round(Phaser.Math.Distance.Between(
            enemy.x, enemy.y, scene.player.x, scene.player.y));

        // All player fire camps
        const camps = scene.bonfires
            .filter(b => !b.getData('isLairCamp'))
            .map((b, i) => {
                const fuel    = b.getData('fuel') || 0;
                const maxFuel = b.getData('maxFuel') || 1;
                const lit     = !!(b.getData('lit') || b.getData('isMain'));
                const dist    = Math.round(Phaser.Math.Distance.Between(enemy.x, enemy.y, b.x, b.y));
                return {
                    idx:      i,
                    label:    b.getData('isMain') ? 'MAIN BASE' : 'OUTPOST',
                    wx:       Math.round(b.x),
                    wy:       Math.round(b.y),
                    fuelPct:  Math.round((fuel / maxFuel) * 100),
                    lit,
                    dist,
                };
            });

        // Nearby player buildings (turrets etc.) within 800px
        const buildings = [];
        if (scene.buildingsGroup) {
            for (const b of scene.buildingsGroup.children.entries) {
                if (!b.active) continue;
                const d = Math.round(Phaser.Math.Distance.Between(enemy.x, enemy.y, b.x, b.y));
                if (d < 800) {
                    const atkRange = b.getData('attackRange') || 0;
                    const bhp     = b.getData('hp') || 0;
                    const bmaxHp  = BUILDINGS[b.getData('type')]?.hp || bhp || 1;
                    buildings.push({
                        idx:        buildings.length,
                        type:       b.getData('type') || 'BUILDING',
                        wx:         Math.round(b.x),
                        wy:         Math.round(b.y),
                        dist:       d,
                        attackRange: atkRange,           // px — 0 means not a shooter
                        hpPct:      Math.round((bhp / bmaxHp) * 100),
                    });
                }
            }
        }

        const hpPct    = Math.round((enemy.getData('hp') / enemy.getData('maxHp')) * 100);
        const pHpPct   = Math.round(((gameState.hp ?? gameState.health ?? 100) / (gameState.maxHealth || CONFIG.PLAYER_MAX_HP)) * 100);
        const meleeRng = (enemy.getData('size') || 22) + 34;

        return {
            self: {
                wx: Math.round(enemy.x), wy: Math.round(enemy.y),
                tile: eTile, hpPct,
                damage: enemy.getData('damage'),
            },
            player: {
                wx: Math.round(scene.player.x), wy: Math.round(scene.player.y),
                tile: pTile, hpPct: pHpPct, dist: distToPlayer,
                inMeleeRange: distToPlayer < meleeRng,
                canSee:       distToPlayer < 420,
            },
            camps,
            buildings,
            gameTimeSec: Math.floor(gameState.time),
        };
    },

    // ----------------------------------------------------------
    // 2. BUILD PROMPT — AD&D flavoured tactical briefing
    // ----------------------------------------------------------
    buildPrompt(ws) {
        const campsLines = ws.camps.map(c =>
            `  [${c.idx}] ${c.label}: pos(${c.wx},${c.wy}), fuel:${c.fuelPct}%, lit:${c.lit}, dist:${c.dist}px`
        ).join('\n');

        const buildLines = ws.buildings.length
            ? ws.buildings.map(b => {
                const danger = b.attackRange > 0
                    ? ` ⚠ TURRET attackRange:${b.attackRange}px — STAY >${b.attackRange}px away or destroy`
                    : '';
                return `  [${b.idx}] ${b.type} at (${b.wx},${b.wy}), dist:${b.dist}px, HP:${b.hpPct}%${danger}`;
              }).join('\n')
            : '  none nearby';

        const playerThreat = ws.player.inMeleeRange ? 'IN MELEE RANGE — striking now is free'
            : ws.player.canSee ? `visible, ${ws.player.dist}px away`
            : `out of sight, ${ws.player.dist}px away`;

        return `You are SHADOW_MIND, an ancient darkness creature playing a top-down survival game — like a dungeon master controlling a monster in AD&D. The map is tile-based (1 tile = 32px). Coordinates are in pixels.

=== CURRENT SITUATION ===
YOU       : (${ws.self.wx},${ws.self.wy}), HP:${ws.self.hpPct}%, dmg:${ws.self.damage}
PLAYER    : (${ws.player.wx},${ws.player.wy}), HP:${ws.player.hpPct}% — ${playerThreat}

FIRE CAMPS (drain their fuel to win):
${campsLines}

PLAYER BUILDINGS (avoid if dangerous, or destroy):
${buildLines}

GAME TIME: ${ws.gameTimeSec}s

=== YOUR OBJECTIVE ===
PRIMARY  — extinguish ALL fire camps (attack each until fuelPct = 0)
SECONDARY — kill the player if they get in your way or have low HP
TERTIARY  — survive (flee if you drop below 25% HP)

=== AVAILABLE ACTIONS ===
Each step MUST be a JSON object with an "action" key. No shorthand strings.

{"action":"MOVE_TO","x":1234,"y":567}
{"action":"ATTACK_CAMP","idx":0}
{"action":"ATTACK_PLAYER"}
{"action":"DESTROY_BUILDING","idx":0}
{"action":"FLEE","x":1234,"y":567}
{"action":"WAIT","seconds":2}

=== TACTICAL HINTS ===
- TURRETS shoot anything within their attackRange px. Before approaching a camp, check if a turret covers it. If so: either DESTROY_BUILDING first, or MOVE_TO a flanking coord on the FAR side of the camp (campX + offset away from turret), then ATTACK_CAMP.
- To flank: if turret is at (tx,ty) and camp at (cx,cy), move to (cx + (cx-tx)/|cx-tx| * (attackRange+60), cy) — that puts you behind the camp out of turret arc.
- Prioritise camp with lowest fuelPct.
- If player HP < 30% and nearby, kill first.
- Max 5 steps. You will be re-queried after execution.

OUTPUT FORMAT — respond with ONLY this JSON, nothing else:
{"reasoning":"one concise sentence","steps":[{"action":"..."},{"action":"..."}]}`;
    },

    // ----------------------------------------------------------
    // 3. CALL GROQ API
    // ----------------------------------------------------------
    async queryGroq(worldState) {
        const prompt = this.buildPrompt(worldState);
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
