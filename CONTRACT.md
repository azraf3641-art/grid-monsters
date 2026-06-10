# ENGINE CONTRACT — Grid Monsters v7 beta

Normative for `engine.js`, `data.js`, and all tests. **SPEC.md is the rules authority**; this file pins the API surface and resolves interpretation gaps ("DEV-PINS"). Precedence on conflict: **SPEC.md > CONTRACT.md > tests > implementation.** Never weaken a test to make an implementation pass — fix whichever artifact disagrees with the higher authority.

## Files & module pattern

- `data.js` → defines `const GM_DATA = {...}` (pure JSON-compatible literal). Ends with:
  `if (typeof module !== 'undefined') module.exports = GM_DATA;`
- `engine.js` → defines `const GM = {...}`. Loads data via
  `const GM_DATA = (typeof module !== 'undefined') ? require('./data.js') : window.GM_DATA;`
  Ends with `if (typeof module !== 'undefined') module.exports = GM;`
  Pure logic: zero DOM access, zero timers, **zero `Math.random`** (the only randomness is the seeded RNG inside the state, consumed ONLY by Earthquake).
- `ui.js`, `net.js`: browser-only, never required by tests.
- `test.js`: runner; each `tests/*.test.js` exports an array `[{name, fn}]`; `fn` throws on failure.

## Coordinates & geometry

- Board 8×8. `x: 0..7` (left→right), `y: 0..7`. Player **0** ("P1" in SPEC) back rows `y ∈ {0,1}`; player **1** ("P2") back rows `y ∈ {6,7}`. (SPEC "rows 1–2" = y 0–1; "rows 7–8" = y 6–7.)
- Cardinal directions: `N=(0,+1)`, `E=(+1,0)`, `S=(0,-1)`, `W=(-1,0)`. Earthquake d4 map: 1→N, 2→E, 3→S, 4→W.
- The 8 directions: cardinals + `NE=(1,1)`, `SE=(1,-1)`, `SW=(-1,-1)`, `NW=(-1,1)`.
- Facing ∈ `'N'|'E'|'S'|'W'`. Defaults: player-0 units `'N'`, player-1 units `'S'`. Updated ONLY by the final step of a completed move action. Push, Lure, Lunge, Blink, Telegrab relocation, and Earthquake displacement do NOT change facing. Attacks do not change facing.
- Rear squares of a unit at (x,y): the 3 squares on the side opposite its facing. Facing N → `(x-1,y-1),(x,y-1),(x+1,y-1)`; facing S → the three at `y+1`; facing E → the three at `x-1`; facing W → the three at `x+1`. (Off-board rear squares simply don't exist.)
- Distance vocabulary: "adjacent"/"8-adj"/"within 1" = Chebyshev distance 1. Blink 2 = Chebyshev ≤ 2. Scatter range = **Manhattan** distance. "Straight line (8 directions)" = same row, column, or exact diagonal.

## RNG (Earthquake only)

mulberry32. `state.rng` holds the current uint32 seed-state; `state.seed` holds the original seed for display.

```js
// step: returns float in [0,1) and the next uint32 state
function rngStep(s) {
  let t = (s + 0x6D2B79F5) >>> 0;
  let r = t;
  r = Math.imul(r ^ (r >>> 15), r | 1);
  r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
  return { value: ((r ^ (r >>> 14)) >>> 0) / 4294967296, next: t };
}
// d4 roll = Math.floor(value * 4) + 1
```

Earthquake rolls one d4 per affected unit, in **ascending unit `id` order**. A blocked roll is still consumed and still logged.

## data.js schema

```js
const GM_DATA = {
  boardSize: 8,
  typeChart: { Fire:['Grass','Ice'], Water:['Fire','Ground'], Grass:['Water','Ground'],
               Electric:['Water','Flying'], Ground:['Fire','Electric'], Flying:['Grass'],
               Psychic:[], Dark:['Psychic'], Ice:['Grass','Ground','Flying'] },
  tyrants: ['cinderling','wyrmlet','frostfawn'],   // line ids
  lines: [ Line, ... ]                              // exactly 24, in SPEC §6 order
};
Line = { id, num, type, tyrant: bool, stages: [Stage, ...] }  // id = base-form name lowercased
Stage = {
  name, hp, speed, basic,            // basic damage (2 everywhere except Guppling stage 0 = 1)
  special: null | Special,
  traits: [],                        // of 'talonlock','tyrantbane','skulk','backstab','staticQuills','butcher'
  aura: null | 'localStorm' | 'earthquake' | 'dreadPresence' | 'hungryDepths',
  rival: bool,                       // true only on Pyroclasm, Tempestdrake, Gravewinter
  evolve: null | { kind: 'survived'|'dealt'|'ko'|'allyKo', n?: number }   // condition to LEAVE this stage
}
Special =
  { name, pattern:'single'|'lance', range, dmg, effects:[Effect], riders:[Rider] }
| { name, pattern:'cone',  dmg, effects, riders }
| { name, pattern:'burst', dmg, effects, riders }
| { name, pattern:'bomb',  range, dmg, effects, riders }
| { name, pattern:'scatter', range, count, dmg, effects, riders }
| { name, pattern:'telegrab', range, relocate, telesmash: bool }   // effects/riders absent
Effect = {kind:'push',n:1} | {kind:'pin'} | {kind:'pin',centerOnly:true}
       | {kind:'burn',n} | {kind:'burn',n,nearOnly:true} | {kind:'poison'}
       | {kind:'chill',n:1} | {kind:'lure'}
Rider  = {kind:'recoil',n} | {kind:'lunge'} | {kind:'blink',n:2}
// Glacial Gore additionally carries bonusPerChill: true on the Special.
```

Weakened middle specials have empty `effects`/`riders`. Tavrik's line has a single stage with `evolve: null`.

## State shape (all JSON-serializable; no Maps/Sets/functions/undefined)

```js
state = {
  v: 1,
  seed, rng,                       // uint32s
  coinWinner: 0|1,
  phase: 'draft'|'placement'|'battle'|'over',
  draft: {
    order: [p,...],                // 12 entries: [W, L] tyrant picks, then snake L W W L L W W L L W
    pickIndex: 0..12,
    cutTyrant: lineId|null,        // set after second tyrant pick
    teams: [[lineId,...],[...]],
  },
  placement: { current: 0|1, confirmed: [bool,bool] },
  units: [Unit, ...],              // created during placement; id = array index at creation, stable forever
  playerTurns: [int,int],          // count of each player's turns STARTED
  turn: {
    player: 0|1, activationsUsed: 0..3, activated: [unitId,...],
    current: null | { unitId, moved: bool, attacked: bool },
    pendingAuras: null | [unitId,...],   // non-null only in end-of-turn aura subphase
  },
  winner: null|0|1,
  log: [ {msg: string}, ... ],
}
Unit = {
  id, owner, lineId, stage,        // stage = index into line.stages
  hp,                              // max derived: GM_DATA line.stages[stage].hp
  pos: {x,y} | null,               // null = KO'd/removed
  facing: 'N'|'E'|'S'|'W',
  pinnedTurn: 0,                   // owner-turn number during which movement is blocked; 0 = not pinned
  rootedTurn: 0,                   // same semantics (Talonlock self-root)
  burn: null | { n, ticks },       // ticks remaining (starts 2)
  poison: 0,                       // execute stacks, never expire
  chill: 0,                        // stacks; cleared at end of owner's turn
  hexTurns: 0,                     // >0 = hexed; decremented at end of owner's turn
  telegrabs: 0,                    // lifetime times THIS unit has been telegrabbed
  survived: 0, dealt: 0, kos: 0, allyKoSeen: false,
}
```

**Pin/root timing model:** when Pin (or root) is applied, set `pinnedTurn = playerTurns[victim.owner] + 1`. A unit's movement is blocked while `playerTurns[owner] === pinnedTurn`; the flag clears (set back to 0) at the END of the owner's turn number `pinnedTurn`. A unit counts as "Pinned" (for Predator/Butcher bonuses and UI badges) from application until that clear. `playerTurns[p]` increments when p's turn STARTS.

**KO:** set `hp` ≤ 0 → unit removed: `pos = null`. KO'd units stay in `units` (counters frozen) for log/attribution; they never block, never satisfy adjacency, never evolve.

## Actions — `GM.applyAction(state, player, action) → newState`

Pure: never mutates the input state (clone first). Throws `Error` with a human-readable message on any illegal action (wrong player, wrong phase, illegal geometry, etc.). All randomness comes from `state.rng`.

| Phase | Action | Notes |
|---|---|---|
| draft | `{t:'pick', lineId}` | Must be `draft.order[pickIndex]`'s turn. Tyrant picks (index 0,1) must be tyrant lines; after pick 1, the remaining tyrant becomes `cutTyrant`. Snake picks must be non-tyrant, unpicked lines. After pick 12 → phase `placement`. |
| placement | `{t:'place', lineId, x, y}` | Own drafted line, own back two rows, empty square. Re-placing an already-placed line moves it. Creates the Unit (base form) on first placement. |
| placement | `{t:'unplace', lineId}` | Removes from board (before confirm only). |
| placement | `{t:'confirm'}` | Requires all 6 placed. P0 places+confirms first, then P1. After both → phase `battle`, then P0's turn 1 starts (run start-of-turn). |
| battle | `{t:'activate', unitId}` | Own living unit, not yet activated this turn, `activationsUsed < 3`, no activation in progress. Increments `activationsUsed`, sets `turn.current`. |
| battle | `{t:'move', path:[{x,y},...]}` | Current unit; not yet moved or attacked; path = sequence of orthogonal steps from current pos; length ≤ effective Speed; every step empty (Skulk: intermediate squares may be occupied; final must be empty); blocked if pinned/rooted/Hard-Frozen. Sets facing to final step direction. |
| battle | `{t:'attack', ...}` | Current unit; not yet attacked; rejected if Hard Frozen. See attack params below. |
| battle | `{t:'endActivation'}` | Closes `turn.current`. |
| battle | `{t:'endTurn'}` | No activation in progress. Computes the active player's end-of-turn auras (Local Storm / Hungry Depths on living final forms). If any → `pendingAuras` subphase; else turn passes immediately. |
| battle | `{t:'aura', unitId, target?: unitId}` | Resolves one pending aura (any order — owner's choice). Local Storm: no target. Hungry Depths: `target` required iff ≥1 unit (either side) is 8-adjacent (must be one of them); with no adjacent unit, omit target (self-damage 1). When `pendingAuras` empties → turn passes. |
| over | `{t:'rematch', seed, coinWinner}` | Either player. Fresh game (new draft) with supplied seed/coin. |

**Turn pass sequence** (after auras, in order): clear expiring marks on the outgoing player's units (`pinnedTurn`/`rootedTurn` equal to current turn number → 0; `chill → 0`; `hexTurns` decrement, min 0); `survived += 1` for each of their living units; flip `turn.player`; `playerTurns[newPlayer] += 1`; reset activations; run new player's **start-of-turn**: (1) evolutions for their units whose condition is met (repeat while met, one stage at a time; +2 HP capped at new max), (2) Burn ticks on their units (damage credited to the burner; decrement ticks, remove at 0), (3) enemy Earthquake displacement then enemy Dread Presence Chill. Win condition checked after every damage resolution throughout.

**Attack action params:**

```js
{t:'attack', kind:'basic',   target:{x,y}}                          // adjacent square holding an enemy
{t:'attack', kind:'special', dir:{dx,dy}}                           // single & lance (8 dirs), cone (4 cardinal dirs)
{t:'attack', kind:'special', target:{x,y}}                          // bomb (straight line ≤ range)
{t:'attack', kind:'special', squares:[{x,y},...]}                   // scatter (≤ count distinct, Manhattan ≤ range)
{t:'attack', kind:'special', targetUnit: unitId, relocateTo:{x,y}|null}  // telegrab
// optional fields on any attack:
focus: unitId,        // REQUIRED iff ≥2 hit units are super-effective-eligible; must be one of them
lungeTo: {x,y},       // lunge rider: empty square 8-adj to target's final position, or target's
                      // square if the target was KO'd. Omit to decline (illegal to omit when
                      // Talonlock makes it mandatory and a legal square exists).
blinkTo: {x,y},       // blink rider: empty square within Chebyshev 2. Omit to decline.
}
```

## Damage pipeline (per hit unit U, attacker A, attack X) — pinned order

1. `dmg = X.dmg` (basic value for Basics; Telesmash: `min(3, U.telegrabs after increment)`).
2. **×2 at most once** if ANY doubling source applies: super-effective (only if U is the attack's focus — see below), Talonlock Predator (A has talonlock AND U is Pinned), Fire-vs-Hard-Frozen (X is an attack by a Fire-type attacker AND U is Hard Frozen), Tavrik Close-kill (A is Tavrik AND U is Rival — only declarable when adjacent).
3. Flat adds, after doubling: Backstab +2; Butcher +2 (U Pinned before this attack's own effect step); Glacial Gore +1 × U's chill stacks counted before its new stack lands.
4. Attacker-side: Dread Presence −1 if A is 8-adjacent to an enemy Gravewinter (and A is not Tavrik), clamped to minimum 1.
5. Victim-side: Hex +1 if U is hexed. (Hex also adds +1 to Burn ticks, aura damage, and Static Quills reflect — every damage source; Poison deals no damage.)
6. Damage applies simultaneously to all hit units; then effects; then riders (Recoil last-but-one of attack, Static Quills reflect after the attack fully resolves).

**Focus rule:** the at-most-ONE-unit-per-attack limit governs the **super-effective** doubling only. Eligible = hit enemy units whose type the attacker's type beats (Lance: only the first unit hit is eligible). 0 eligible → no focus; exactly 1 → auto-focus; ≥2 → `focus` field required. Other doubling sources (Predator, frozen-Fire, Close-kill) are per-hit and not focus-limited; the ×2 cap is per-hit.

## DEV-PINS (interpretation rulings — flag any change to these)

1. **Attack must bite:** every attack declaration must hit ≥1 enemy unit (Single: first unit in range must be an enemy; Burst/Cone/Lance: ≥1 enemy in the area; Bomb: ≥1 enemy in the plus; Scatter: ≥1 chosen square holds an enemy; Telegrab: enemy target required). Prevents free-rider exploits (e.g., Mindclaw-into-nothing for a free Blink).
2. **Hex window:** "+1 during its next 2 turns" = from application until the END of the victim's controller's 2nd turn after application — the window spans the opponent's turns in between (required for "+1 on attacks" to ever matter). `hexTurns` starts at 2, decrements at end of victim's own turn, active while > 0. Reapplication resets to 2.
3. **Hard Freeze window:** a unit is Hard Frozen from the moment its chill stacks would zero its next-turn Speed (`speed − 2·chill ≤ 0`, chill > 0) until the stacks clear (end of its own next turn). Fire-type attacks deal ×2 to it during that whole window (so a same-turn follow-up Fire attack after Glacial Gore is doubled — required by acceptance §16). Move/attack prohibition naturally applies during its own turn.
4. **Pinned units may still use attack riders** (Lunge/Blink movement that is part of an attack); Pin/root block only the move step (a). Generalized from the Talonlock Override clause.
5. **Forced displacement ignores Pin:** Push, Lure, Telegrab relocation, and Earthquake move pinned/rooted units normally.
6. **Cone direction** is any of the 4 cardinal directions, chosen freely at declaration (not tied to the attacker's current facing).
7. **Telegrab range is Chebyshev** ("within 3 squares, any direction, not blocked"); relocation destination = empty square within Chebyshev `relocate` of the victim's square, or `null` (leave in place — also the forced outcome when no legal destination exists; Telesmash still resolves). Parliowl's weakened grab **does** increment the victim's lifetime counter but deals no Telesmash damage. Archistrix's Telesmash damage = `min(3, counter)` counted **including** the current grab.
8. **"Dealt N damage"** counts actual HP removed (capped at the victim's remaining HP), not overkill. Poison contributes no damage credit. (Flagged to PM as the strictest literal reading.)
9. **Evolution multiplicity:** at start-of-turn, a unit evolves repeatedly while its next condition is already met (one stage at a time, +2 capped refresh each). In practice at most one stage per turn occurs.
10. **Start-of-turn step 3 order:** Earthquake displacement fully resolves before Dread Presence Chill is assessed (adjacency for Chill is post-quake). Among these, multiple instances cannot occur (each line is unique per game).
11. **Aura/trait damage attribution:** Static Quills reflect, like Recoil and aura damage, credits no one.
12. **Hungry Depths heal** applies even if the bite KO'd the bitten unit (3 ally / 2 enemy, capped at max HP).
13. **Scorching Howl** = Cone, 3 dmg, Push 1 on every hit enemy, Burn 1 only on an ENEMY occupying the near square (the spec's "at most one effect" line notwithstanding — §6 is explicit). Lure = pull 1 + Hex, also compound by spec.
14. **Push/pull direction** uses the sign vector from attacker to victim (diagonal pushes allowed, e.g. Burst); cancelled entirely if destination occupied or off-board.
15. **Simultaneity:** the engine tracks the player whose effect is resolving; if a resolution KOs the last units of BOTH sides, that player wins. Recoil/self-damage resolving during your own attack counts as your effect.
16. **Activations:** activating a unit consumes one of the 3 activations even if it then neither moves nor attacks. Hard-Frozen units can technically be activated (wasting it); UI should warn. Pinned units can be activated and attack.
17. **Stoop Strike KO edge:** if Stoop Strike KOs its target, no Pin lands, so the Lunge is optional (normal rider rules, may take the corpse's square) and no self-root occurs.
18. **Blood Scent** is a +2 Speed recomputation (4→6), evaluated live from board state (enemy Rival final alive); it interacts with Chill normally (effective speed = max(0, base(+2) − 2·chill)).
19. **Log** entries are `{msg}` strings including damage math, d4 rolls, evolutions, KOs; the log lives in state (synced to guests).
20. **Telesmash is an attack** (Psychic, never super-effective): Dread −1 (min 1) and Hex +1 apply; Static Quills triggers only if Archistrix is adjacent to Galvaquill when grabbing.
21. **Leviadon's Basic is 2.** The "except Guppling 1" exception names the base form only (the §6 table pins "Basic 1" on the Guppling stage, not the line); evolved Leviadon uses the standard 2.

## Helpers (exported on GM, pure)

- `GM.createGame(seed, coinWinner) → state`
- `GM.applyAction(state, player, action) → state`
- `GM.lineOf(unit)` / `GM.stageOf(unit)` → data records
- `GM.maxHp(state, unitId)`, `GM.effectiveSpeed(state, unitId)`, `GM.isFrozen(state, unitId)`, `GM.isPinned(state, unitId)`
- `GM.reachable(state, unitId) → [{x,y,path}]` (BFS, respects Skulk/pin/root/freeze; empty if the unit can't move)
- `GM.attackChoices(state, unitId)` → declarable attacks with metadata (legal dirs/targets/squares, hit unitIds per choice)
- `GM.previewAttack(state, unitId, attackParams) → {legal, reason?, hits:[{unitId, dmg}], needsFocus, focusEligible:[unitId], lungeSquares:[{x,y}], blinkSquares, mandatoryLunge}`
- `GM.pendingAuras(state) → [{unitId, kind, needsTarget, targets:[unitId]}]`

`applyAction` validation is authoritative; helpers exist for UI/tests convenience and must agree with it.

## Net protocol (net.js, later phase)

Guest→host: `{kind:'intent', player: 1, action}` · Host→guest: `{kind:'state', state}` · `{kind:'hello'}` / `{kind:'welcome', seat:1}`. Host applies intents through the same `applyAction` and broadcasts full state after every successful action (its own included). Room code: `'gm-' + 5` random alphanumerics (host-side `Math.random` is allowed in net.js/ui.js only — never in engine).
