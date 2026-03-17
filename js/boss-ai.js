// ============================================================
// BOSS AI — Darkness Lord uses Groq for tactical decisions
// ============================================================

const bossAI = {
    log: [],
    _MAX_LOG: 20,
    _pending: false,

    _pushLog(type, content) {
        const d = new Date();
        const ts = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
        this.log.push({ ts, type, content });
        if (this.log.length > this._MAX_LOG) this.log.shift();
    },

    buildWorldState(boss, scene) {
        const T = scene._TILE || 32;
        const bx = Math.round(boss.x / T), by = Math.round(boss.y / T);
        const px = Math.round(scene.player.x / T), py = Math.round(scene.player.y / T);
        const tileDist = (ax, ay, bx2, by2) => Math.round(Math.sqrt((bx2 - ax) ** 2 + (by2 - ay) ** 2));
        const dist = tileDist(bx, by, px, py);

        // Count nearby minions
        let aliveMinions = 0;
        for (const e of scene.mazeEnemies.children.entries) {
            if (e.active && e !== boss) aliveMinions++;
        }

        // Treasure position
        const tx = Math.round(scene.treasure.x / T);
        const ty = Math.round(scene.treasure.y / T);
        const playerDistToTreasure = tileDist(px, py, tx, ty);

        return {
            self: {
                tx: bx, ty: by,
                hpPct: Math.round((boss.getData('hp') / boss.getData('maxHp')) * 100),
                damage: boss.getData('dmg'),
                isCharging: !!scene._bossCharging,
            },
            player: {
                tx: px, ty: py,
                hpPct: Math.round((gameState.hp / CONFIG.PLAYER_MAX_HP) * 100),
                dist,
                distToTreasure: playerDistToTreasure,
                inMeleeRange: dist <= 2,
            },
            treasure: { tx, ty },
            aliveMinions,
            torchRadius: scene._torchRadius,
        };
    },

    buildPrompt(ws, recentSteps) {
        const recentSection = recentSteps && recentSteps.length > 0
            ? `\n=== YOUR LAST ACTIONS ===\n${recentSteps.map((s, i) => `  ${i + 1}. ${JSON.stringify(s)}`).join('\n')}\n`
            : '';

        return `You are DARKNESS LORD, the final boss in a dark dungeon. You guard an ancient treasure chest.
You are cunning, deceptive, and deadly. You have special abilities no regular enemy has.

=== CURRENT SITUATION ===
YOU       : tile(${ws.self.tx},${ws.self.ty}), HP:${ws.self.hpPct}%, dmg:${ws.self.damage}
PLAYER    : tile(${ws.player.tx},${ws.player.ty}), HP:${ws.player.hpPct}%, dist:${ws.player.dist}t
TREASURE  : tile(${ws.treasure.tx},${ws.treasure.ty}), player is ${ws.player.distToTreasure}t from it
MINIONS ALIVE: ${ws.aliveMinions}
PLAYER TORCH RADIUS: ${ws.torchRadius}px (bigger = player sees more)
${ws.self.isCharging ? '⚡ YOU ARE CURRENTLY CHARGING ULTIMATE — cannot act' : ''}
${recentSection}
=== YOUR OBJECTIVE ===
PRIMARY   — KILL the player. They must NOT reach the treasure.
SECONDARY — DECEIVE and OUTSMART: lure the player AWAY from treasure into dark corridors, then ambush
TERTIARY  — SURVIVE: if HP < 30%, summon minions and use ultimate attack

=== AVAILABLE ACTIONS ===
{"action":"MOVE_TO","tx":30,"ty":40}         — move to position (uses A* pathfinding through dungeon)
{"action":"ATTACK_PLAYER"}                    — melee attack if close, or fire dark orb projectiles
{"action":"ULTIMATE"}                         — charge 3 seconds then devastating AOE nova (130px radius, 40 dmg). Use when player is close.
{"action":"SUMMON_MINIONS","count":3}          — summon 1-4 shadow creatures to help you (costs HP: 10 per minion)
{"action":"GUARD_TREASURE"}                   — position yourself between player and treasure
{"action":"AMBUSH","tx":25,"ty":35}           — move to position silently, wait for player to come close, then strike
{"action":"FLEE","tx":20,"ty":20}             — retreat to recover
{"action":"TAUNT","message":"Come closer..."}  — display message to lure player

=== TACTICAL ADVICE ===
- If player is far from treasure (>8t), GUARD_TREASURE or set up an AMBUSH between them and the chest
- If player is close to treasure (<5t), be aggressive — ATTACK or ULTIMATE
- If your HP < 30% and minions < 2, SUMMON_MINIONS to buy time
- If player HP < 25%, chase aggressively — finish them off
- Use TAUNT to psychological warfare — lure them into traps
- ULTIMATE is devastating but has 3s charge time — use when player is committed to fighting
- Alternate between ranged attacks, melee, and special abilities. Be unpredictable.
- Max 4 steps per plan. You will be re-queried after execution.

OUTPUT FORMAT — respond with ONLY this JSON:
{"reasoning":"your tactical thinking in one sentence","steps":[{"action":"..."},{"action":"..."}]}`;
    },

    async query(boss, scene) {
        if (this._pending) return null;
        this._pending = true;

        const ws = this.buildWorldState(boss, scene);
        const recentSteps = boss.getData('_recentSteps') || [];
        const prompt = this.buildPrompt(ws, recentSteps);
        this._pushLog('REQUEST', `HP:${ws.self.hpPct}% P:${ws.player.dist}t Minions:${ws.aliveMinions}`);

        try {
            const resp = await fetch(GROQ_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: GROQ_MODEL,
                    temperature: 0.6,
                    max_tokens: 1500,
                    stream: false,
                    response_format: { type: 'json_object' },
                    messages: [
                        { role: 'system', content: 'Dungeon boss tactical AI. Output JSON with "reasoning" and "steps" array.' },
                        { role: 'user', content: prompt },
                    ],
                }),
            });

            if (!resp.ok) {
                this._pushLog('ERROR', `HTTP ${resp.status}`);
                this._pending = false;
                return null;
            }

            const data = await resp.json();
            const msg = data.choices?.[0]?.message || {};
            const searchIn = msg.content?.trim() || msg.reasoning?.trim() || '';
            const cleaned = searchIn.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
            const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
            if (!jsonMatch) throw new Error('No JSON');

            const plan = JSON.parse(jsonMatch[0]);
            if (!Array.isArray(plan.steps)) throw new Error('No steps');

            console.log(`%c[Boss AI] ${plan.reasoning}`, 'color:#FF4444;font-weight:bold');
            this._pushLog('PLAN', plan.reasoning);

            // Store recent steps for context
            boss.setData('_recentSteps', plan.steps.slice(0, 4));

            this._pending = false;
            return plan;
        } catch (err) {
            console.warn('[Boss AI] Error:', err.message);
            this._pushLog('ERROR', err.message);
            this._pending = false;
            return null;
        }
    },
};
