// tests/auras.test.js — SPEC §5 auras + serialization.
// INDEPENDENCE: all expected values derived from SPEC.md + CONTRACT.md only
// (engine.js was never read). Damage math cited inline.
//
// d4 derivation (CONTRACT "RNG (Earthquake only)", mulberry32, roll = floor(value*4)+1):
//   seed 42 → rolls 3(S), 2(E), 4(W)…; rng state after 1 roll = 1831565855, after 2 = 3663131668
//   seed 7  → rolls 1(N), 1(N)…;       rng state after 1 roll = 1831565820, after 2 = 3663131633
// Verified with the local rngStep below (same algorithm as pinned in CONTRACT.md).
const { GM, DATA, assert, assertEq, assertThrows, mkBattle, play, act, endTurn, unit, at } =
  require('./helpers.js');

// Local copy of the CONTRACT-pinned RNG step, used only to compute expectations.
function rngStep(s) {
  let t = (s + 0x6D2B79F5) >>> 0;
  let r = t;
  r = Math.imul(r ^ (r >>> 15), r | 1);
  r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
  return { value: ((r ^ (r >>> 14)) >>> 0) / 4294967296, next: t };
}
function rngAfter(seed, n) {
  let s = seed;
  for (let i = 0; i < n; i++) s = rngStep(s).next;
  return s;
}
// Sanity-pin the constants used below against the algorithm itself.
assertEq(rngAfter(42, 1), 1831565855, 'rng constant check');
assertEq(rngAfter(42, 2), 3663131668, 'rng constant check');
assertEq(rngAfter(7, 2), 3663131633, 'rng constant check');
assertEq(Math.floor(rngStep(42).value * 4) + 1, 3, 'seed 42 roll 1 = 3 (S)');
assertEq(Math.floor(rngStep(7).value * 4) + 1, 1, 'seed 7 roll 1 = 1 (N)');

const J = (x) => JSON.stringify(x);

const tests = [];

// ───────────────────────── LOCAL STORM (SPEC §5) ─────────────────────────

tests.push({
  name: 'localStorm: end of controller turn deals 1 to EVERY unit (friend or foe) within Chebyshev 1, not itself, not beyond (§5)',
  fn() {
    let s = mkBattle({
      units: [
        { form: 'Tempestdrake', owner: 0, x: 3, y: 3 },           // 0, hp 8
        { form: 'Shriket', owner: 0, x: 2, y: 2 },                // 1 ally adj (diag), hp 4
        { form: 'Cacklet', owner: 0, x: 3, y: 4 },                // 2 ally adj (orth), hp 4
        { form: 'Pupfloe', owner: 1, x: 4, y: 4 },                // 3 enemy adj, hp 4
        { form: 'Floecub', owner: 1, x: 4, y: 3 },                // 4 enemy adj, hp 4
        { form: 'Zapkitt', owner: 1, x: 2, y: 3 },                // 5 enemy adj, hp 3
        { form: 'Coilbug', owner: 0, x: 3, y: 5 },                // 6 ally at distance 2 — untouched
        { form: 'Slithrin', owner: 1, x: 5, y: 5 },               // 7 enemy at distance 2 — untouched
      ],
    });
    s = endTurn(s, 0); // helper resolves the storm aura ({t:'aura', unitId:0}, no target)
    assertEq(unit(s, 0).hp, 8, 'Tempestdrake never hits itself');
    assertEq(unit(s, 1).hp, 3, 'adjacent ally takes 1');
    assertEq(unit(s, 2).hp, 3, 'adjacent ally takes 1');
    assertEq(unit(s, 3).hp, 3, 'adjacent enemy takes 1');
    assertEq(unit(s, 4).hp, 3, 'adjacent enemy takes 1');
    assertEq(unit(s, 5).hp, 2, 'adjacent enemy takes 1');
    assertEq(unit(s, 6).hp, 4, 'Chebyshev 2 ally untouched');
    assertEq(unit(s, 7).hp, 4, 'Chebyshev 2 enemy untouched');
    assertEq(s.turn.player, 1, 'turn passed after aura resolution');
  },
});

tests.push({
  name: 'localStorm: can KO an ally, and that ally-KO satisfies Cacklet\'s allyKo evolution at the start of its controller\'s next turn (§4, §5)',
  fn() {
    let s = mkBattle({
      units: [
        { form: 'Tempestdrake', owner: 0, x: 3, y: 3 },
        { form: 'Zapkitt', owner: 0, x: 3, y: 4, hp: 1 },  // ally at 1 hp — storm KOs it
        { form: 'Cacklet', owner: 0, x: 0, y: 0 },         // evolve condition: an allied unit is KO'd
        { form: 'Pupfloe', owner: 1, x: 7, y: 7 },
      ],
    });
    s = endTurn(s, 0);
    assertEq(unit(s, 1).pos, null, 'storm KO\'d the 1-hp ally');
    assert(unit(s, 2).allyKoSeen === true, 'Cacklet saw an allied KO');
    s = endTurn(s, 1); // opponent's turn passes -> Cacklet's controller's turn starts -> evolution (§4 step 1)
    assertEq(s.turn.player, 0);
    assertEq(unit(s, 2).stage, 1, 'Cacklet evolved to Ossiyena');
    // §4: refresh +2 current HP capped at new max: 4+2=6, Ossiyena max 6 → 6
    assertEq(unit(s, 2).hp, 6, 'evolution refresh 4+2 capped at Ossiyena max 6');
  },
});

tests.push({
  name: 'localStorm: Tavrik is never harmed, even by a FRIENDLY Tempestdrake (Tyrantbane: Rival auras, regardless of side — SPEC §3)',
  fn() {
    let s = mkBattle({
      units: [
        { form: 'Tempestdrake', owner: 0, x: 3, y: 3 },
        { form: 'Tavrik', owner: 0, x: 2, y: 3 },   // FRIENDLY Tavrik adjacent — immune
        { form: 'Shriket', owner: 0, x: 3, y: 4 },  // control: normal ally takes 1
        { form: 'Tavrik', owner: 1, x: 4, y: 3 },   // enemy Tavrik adjacent — also immune
        { form: 'Pupfloe', owner: 1, x: 7, y: 7 },
      ],
    });
    s = endTurn(s, 0);
    assertEq(unit(s, 1).hp, 5, 'friendly Tavrik untouched by friendly Local Storm');
    assertEq(unit(s, 3).hp, 5, 'enemy Tavrik untouched by Local Storm');
    assertEq(unit(s, 2).hp, 3, 'normal adjacent ally still takes 1');
  },
});

tests.push({
  name: 'localStorm: KO of the last enemy via the aura wins immediately (§1 Winning, §5 win check after resolution)',
  fn() {
    let s = mkBattle({
      units: [
        { form: 'Tempestdrake', owner: 0, x: 3, y: 3 },
        { form: 'Zapkitt', owner: 1, x: 3, y: 4, hp: 1 }, // sole enemy at 1 hp
      ],
    });
    s = endTurn(s, 0);
    assertEq(unit(s, 1).pos, null);
    assertEq(s.winner, 0, 'storm controller wins');
    assertEq(s.phase, 'over');
  },
});

tests.push({
  name: 'localStorm: fires only at the END of the CONTROLLER\'s turn — opponent ending their turn triggers nothing (§5)',
  fn() {
    let s = mkBattle({
      units: [
        { form: 'Tempestdrake', owner: 1, x: 3, y: 3 },  // P1's drake
        { form: 'Pupfloe', owner: 0, x: 3, y: 2 },       // P0 unit adjacent to it
        { form: 'Floecub', owner: 0, x: 0, y: 0 },
      ],
    });
    // P0 ends its turn: P0 owns no aura units → no pendingAuras, no storm damage.
    s = GM.applyAction(s, 0, { t: 'endTurn' });
    assertEq(s.turn.player, 1, 'turn passed immediately');
    assertEq(unit(s, 1).hp, 4, 'enemy drake did not storm on P0\'s endTurn');
    // P1 ends its turn: now the storm is pending and resolves.
    let s2 = GM.applyAction(s, 1, { t: 'endTurn' });
    assertEq(s2.turn.pendingAuras, [0], 'storm pending at controller\'s turn end');
    s2 = GM.applyAction(s2, 1, { t: 'aura', unitId: 0 });
    assertEq(unit(s2, 1).hp, 3, 'adjacent P0 unit takes 1 at P1\'s turn end');
  },
});

// ───────────────────────── EARTHQUAKE (SPEC §5) ─────────────────────────

tests.push({
  name: 'earthquake: at start of enemy turn each adjacent ENEMY rolls 1d4 (seed 42 → 3=S, 2=E) in ascending id order; friends and non-adjacent units roll nothing (§5, CONTRACT RNG)',
  fn() {
    let s = mkBattle({
      seed: 42,
      units: [
        { form: 'Terradon', owner: 0, x: 3, y: 3 },   // 0
        { form: 'Zapkitt', owner: 1, x: 2, y: 3 },    // 1: roll 1 = 3(S) → (2,2)
        { form: 'Pupfloe', owner: 1, x: 3, y: 4 },    // 2: roll 2 = 2(E) → (4,4)
        { form: 'Shriket', owner: 0, x: 4, y: 3 },    // 3: FRIENDLY adjacent — no roll
        { form: 'Floecub', owner: 1, x: 6, y: 6 },    // 4: enemy, not adjacent — no roll
      ],
    });
    s = endTurn(s, 0); // P1's turn starts → Earthquake resolves (start-of-turn step 3)
    assertEq(unit(s, 1).pos, { x: 2, y: 2 }, 'id 1 rolled S, moved -y');
    assertEq(unit(s, 2).pos, { x: 4, y: 4 }, 'id 2 rolled E, moved +x');
    assertEq(unit(s, 3).pos, { x: 4, y: 3 }, 'friendly adjacent unit untouched');
    assertEq(unit(s, 4).pos, { x: 6, y: 6 }, 'non-adjacent enemy untouched');
    assertEq(s.rng, 3663131668, 'exactly 2 rng steps consumed (2 rolls, no more)');
  },
});

tests.push({
  name: 'earthquake: rolls resolve in ASCENDING unit id order — blocked-then-vacated proves the order (seed 7 → N,N) (CONTRACT RNG)',
  fn() {
    // Terradon(0) at (3,3); enemy 1 at (4,3); enemy 2 at (4,4). Rolls: N, N.
    // Ascending order: id 1 rolls N → (4,4) occupied by id 2 → BLOCKED, stays.
    //                  id 2 rolls N → (4,5) empty → moves.
    // (Descending order would instead leave id 1 on (4,4) — caught by the asserts.)
    let s = mkBattle({
      seed: 7,
      units: [
        { form: 'Terradon', owner: 0, x: 3, y: 3 },
        { form: 'Zapkitt', owner: 1, x: 4, y: 3 },
        { form: 'Pupfloe', owner: 1, x: 4, y: 4 },
      ],
    });
    s = endTurn(s, 0);
    assertEq(unit(s, 1).pos, { x: 4, y: 3 }, 'id 1 blocked by id 2 (rolled into it first)');
    assertEq(unit(s, 2).pos, { x: 4, y: 5 }, 'id 2 then rolled N into the empty square');
    assertEq(s.rng, 3663131633, 'both rolls consumed (blocked roll still consumed)');
  },
});

tests.push({
  name: 'earthquake: occupied/off-board destination = no move, but the roll is still consumed and logged (§5)',
  fn() {
    // Enemy in the corner (0,0): N blocked by friendly body, E blocked by Terradon, S/W off-board.
    // Whatever the d4 shows, the unit cannot move — yet exactly one rng step is consumed.
    let s = mkBattle({
      seed: 42, // roll 1 = 3 (S) → off-board here
      units: [
        { form: 'Terradon', owner: 0, x: 1, y: 0 },
        { form: 'Zapkitt', owner: 1, x: 0, y: 0 },
        { form: 'Shriket', owner: 0, x: 0, y: 1 },
      ],
    });
    const logLenBefore = s.log.length;
    s = endTurn(s, 0);
    assertEq(unit(s, 1).pos, { x: 0, y: 0 }, 'blocked roll does not move the unit');
    assertEq(s.rng, 1831565855, 'exactly one rng step consumed despite the block');
    assert(s.log.length > logLenBefore, 'log grew');
    assert(
      s.log.some((e) => /quake|roll|d4/i.test(e.msg)),
      'the d4 roll appears in the battle log (SPEC §5 / DEV-PIN 19)'
    );
  },
});

tests.push({
  name: 'earthquake: same seed reproduces identical rolls — two identical states replay to identical JSON (§5 seedable RNG)',
  fn() {
    const spec = {
      seed: 42,
      units: [
        { form: 'Terradon', owner: 0, x: 3, y: 3 },
        { form: 'Zapkitt', owner: 1, x: 2, y: 3 },
        { form: 'Pupfloe', owner: 1, x: 3, y: 4 },
        { form: 'Floecub', owner: 1, x: 6, y: 6 },
      ],
    };
    const a = endTurn(mkBattle(spec), 0);
    const b = endTurn(mkBattle(spec), 0);
    assert(J(a) === J(b), 'identical seeds + actions → identical states');
    assertEq(unit(a, 1).pos, unit(b, 1).pos);
    assertEq(a.rng, b.rng);
  },
});

tests.push({
  name: 'earthquake: the seeded generator is consumed ONLY by Earthquake — a full turn cycle (move, attack-free activation, Hungry Depths bite) with no Terradon adjacency leaves state.rng untouched (CONTRACT: zero Math.random, rng only for Earthquake)',
  fn() {
    let s = mkBattle({
      seed: 42,
      units: [
        { form: 'Terradon', owner: 0, x: 3, y: 3 },   // 0 — on board, but nothing ends adjacent
        { form: 'Leviadon', owner: 0, x: 0, y: 0 },   // 1 — bites at end of turn
        { form: 'Shriket', owner: 0, x: 0, y: 1 },    // 2 — bite victim
        { form: 'Pupfloe', owner: 1, x: 6, y: 6 },    // 3
        { form: 'Floecub', owner: 1, x: 7, y: 7 },    // 4
      ],
    });
    s = act(s, 0, 0, { path: [{ x: 3, y: 4 }] });               // a move
    s = endTurn(s, 0, [{ unitId: 1, target: 2 }]);              // Hungry Depths bite (no rng)
    assertEq(unit(s, 2).hp, 3, 'bite landed');
    // P1's turn started: no enemy adjacent to Terradon → zero quake rolls.
    s = act(s, 1, 3, { path: [{ x: 6, y: 5 }] });
    s = endTurn(s, 1);                                          // back to P0 (P1 has no quake aura)
    assertEq(s.turn.player, 0);
    assertEq(s.rng, 42, 'rng never consumed by moves, attacks, or auras other than Earthquake');
    assertEq(s.seed, 42, 'original seed preserved for display');
  },
});

tests.push({
  name: 'earthquake: resolves at start-of-turn step 3, AFTER burn ticks — a burn-KO\'d adjacent enemy rolls nothing (§1 turn loop, §5)',
  fn() {
    let s = mkBattle({
      seed: 42,
      units: [
        { form: 'Terradon', owner: 0, x: 3, y: 3 },
        { form: 'Zapkitt', owner: 1, x: 3, y: 4, hp: 2, burn: { n: 2, ticks: 2 } }, // burn tick 2 KOs it at step 2
        { form: 'Pupfloe', owner: 1, x: 7, y: 7 },
      ],
    });
    s = endTurn(s, 0);
    assertEq(unit(s, 1).pos, null, 'burn tick (step 2) KO\'d it before the quake (step 3)');
    assertEq(s.rng, 42, 'no roll consumed — the only adjacent enemy was already KO\'d');
  },
});

// ───────────────────────── DREAD PRESENCE (SPEC §5) ─────────────────────────

tests.push({
  name: 'dreadPresence: enemy adjacent to Gravewinter deals −1 on attacks — Basic 2 becomes 1 (§5)',
  fn() {
    let s = mkBattle({
      turn: 1, // P1 attacking; playerTurns default [1,1]
      units: [
        { form: 'Gravewinter', owner: 0, x: 5, y: 4 },        // 0
        { form: 'Pupfloe', owner: 0, x: 3, y: 4 },            // 1 victim, hp 4
        { form: 'Floecub', owner: 1, x: 4, y: 4 },            // 2 attacker, adjacent to GW
      ],
    });
    // Floecub Basic 2; Ice doubles Grass/Ground/Flying, victim is Ice → no ×2. 2 − 1 (Dread) = 1.
    s = act(s, 1, 2, { attack: { kind: 'basic', target: { x: 3, y: 4 } } });
    assertEq(unit(s, 1).hp, 3, 'Basic 2 reduced to 1 by Dread Presence');
  },
});

tests.push({
  name: 'dreadPresence: −1 clamps to a minimum of 1 — Guppling\'s Basic 1 still deals 1 (§5)',
  fn() {
    let s = mkBattle({
      turn: 1,
      units: [
        { form: 'Gravewinter', owner: 0, x: 5, y: 4 },
        { form: 'Zapkitt', owner: 0, x: 3, y: 4 },            // victim, hp 3
        { form: 'Guppling', owner: 1, x: 4, y: 4 },           // attacker, Basic 1, adjacent to GW
      ],
    });
    // Guppling Basic 1; Water doubles Fire/Ground, victim Electric → no ×2. 1 − 1 = 0 → min 1.
    s = act(s, 1, 2, { attack: { kind: 'basic', target: { x: 3, y: 4 } } });
    assertEq(unit(s, 1).hp, 2, 'damage floored at 1, not reduced to 0');
  },
});

tests.push({
  name: 'dreadPresence: −1 applies AFTER doubling and flat adds (CONTRACT pipeline): Butcherbeak Basic vs pinned Psychic = 2×2 +2 −1 = 5',
  fn() {
    let s = mkBattle({
      turn: 1,
      units: [
        { form: 'Gravewinter', owner: 0, x: 5, y: 4 },
        // Victim owner 0, pinned "now": pinnedTurn = playerTurns[0] + 1 = 2 (pin applied, not yet cleared)
        { form: 'Archistrix', owner: 0, x: 3, y: 4, pinnedTurn: 2 }, // Psychic, hp 6
        { form: 'Butcherbeak', owner: 1, x: 4, y: 4 },               // Dark, Butcher trait, adjacent to GW
      ],
    });
    // Pipeline: Basic 2 → ×2 super-effective (Dark beats Psychic, single target auto-focus) = 4
    //           → +2 Butcher (victim Pinned) = 6 → −1 Dread Presence = 5. 6 hp − 5 = 1.
    s = act(s, 1, 2, { attack: { kind: 'basic', target: { x: 3, y: 4 } } });
    assertEq(unit(s, 1).hp, 1, '2×2+2−1 = 5 damage');
  },
});

tests.push({
  name: 'dreadPresence: at the start of each enemy turn every adjacent enemy gains 1 Chill — a Speed-2 base Hard-Freezes immediately (no move, no attack) (§5, §3 Chill)',
  fn() {
    let s = mkBattle({
      units: [
        { form: 'Gravewinter', owner: 0, x: 4, y: 4 },
        { form: 'Pupfloe', owner: 1, x: 5, y: 5 },  // base, Speed 2 → one stack zeroes it
      ],
    });
    s = GM.applyAction(s, 0, { t: 'endTurn' }); // Dread is not an end-of-turn aura → passes immediately
    assertEq(s.turn.player, 1);
    assertEq(unit(s, 1).chill, 1, 'gained 1 Chill stack at its own turn start');
    // Speed 2 − 2·1 = 0 → Hard Frozen this turn: cannot move or attack (activation itself allowed, DEV-PIN 16).
    s = GM.applyAction(s, 1, { t: 'activate', unitId: 1 });
    assertThrows(() => GM.applyAction(s, 1, { t: 'move', path: [{ x: 5, y: 6 }] }),
      'Hard-Frozen unit cannot move');
    assertThrows(() => GM.applyAction(s, 1, { t: 'attack', kind: 'basic', target: { x: 4, y: 4 } }),
      'Hard-Frozen unit cannot attack (target was otherwise legal: adjacent enemy)');
  },
});

tests.push({
  name: 'dreadPresence: Tavrik is immune to BOTH halves — no Chill at turn start, no −1 on its attacks (§5, Tyrantbane §3)',
  fn() {
    let s = mkBattle({
      units: [
        { form: 'Gravewinter', owner: 0, x: 4, y: 4 },
        { form: 'Zapkitt', owner: 0, x: 5, y: 6 },   // 1 victim for Tavrik, hp 3
        { form: 'Tavrik', owner: 1, x: 4, y: 5 },    // 2 adjacent to GW — immune
        { form: 'Pupfloe', owner: 1, x: 3, y: 5 },   // 3 adjacent to GW — control, gets chilled
      ],
    });
    s = GM.applyAction(s, 0, { t: 'endTurn' });
    assertEq(unit(s, 2).chill, 0, 'Tavrik gains no Chill from Dread Presence');
    assertEq(unit(s, 3).chill, 1, 'ordinary adjacent enemy does gain Chill');
    // Tavrik Basic 2 vs Zapkitt (Electric; Fire doubles Grass/Ice → no ×2; victim is not a Rival → no Close-kill).
    // No Dread −1 for Tavrik → full 2 damage. 3 − 2 = 1. (With Dread it would have been 1 → hp 2.)
    s = act(s, 1, 2, { attack: { kind: 'basic', target: { x: 5, y: 6 } } });
    assertEq(unit(s, 1).hp, 1, 'Tavrik attacks at full damage while adjacent to Gravewinter');
  },
});

tests.push({
  name: 'dreadPresence + earthquake (DEV-PIN 10): quake resolves first — a unit displaced OUT of Gravewinter adjacency gains no Chill',
  fn() {
    // seed 7 → roll 1 = N. Enemy at (4,3): adjacent to Terradon (3,3) AND Gravewinter (4,2).
    // Quake N → (4,4), which is Chebyshev 2 from (4,2) → no longer adjacent → no Chill.
    let s = mkBattle({
      seed: 7,
      units: [
        { form: 'Terradon', owner: 0, x: 3, y: 3 },
        { form: 'Gravewinter', owner: 0, x: 4, y: 2 },
        { form: 'Pupfloe', owner: 1, x: 4, y: 3 },
      ],
    });
    s = endTurn(s, 0);
    assertEq(unit(s, 2).pos, { x: 4, y: 4 }, 'quaked N out of Dread range');
    assertEq(unit(s, 2).chill, 0, 'no Chill: adjacency assessed post-quake (DEV-PIN 10)');
    assertEq(s.rng, 1831565820, 'one roll consumed');
  },
});

tests.push({
  name: 'dreadPresence + earthquake (DEV-PIN 10): a unit displaced INTO Gravewinter adjacency gains the Chill',
  fn() {
    // seed 7 → roll 1 = N. Enemy at (3,4): adjacent to Terradon (3,3), NOT adjacent to Gravewinter (3,6).
    // Quake N → (3,5), adjacent to (3,6) → gains 1 Chill.
    let s = mkBattle({
      seed: 7,
      units: [
        { form: 'Terradon', owner: 0, x: 3, y: 3 },
        { form: 'Gravewinter', owner: 0, x: 3, y: 6 },
        { form: 'Pupfloe', owner: 1, x: 3, y: 4 },
      ],
    });
    s = endTurn(s, 0);
    assertEq(unit(s, 2).pos, { x: 3, y: 5 }, 'quaked N into Dread range');
    assertEq(unit(s, 2).chill, 1, 'Chill applied post-quake (DEV-PIN 10)');
  },
});

// ───────────────────────── HUNGRY DEPTHS (SPEC §5) ─────────────────────────

tests.push({
  name: 'hungryDepths: MANDATORY when a unit is adjacent — resolving without a target (or with a non-adjacent target) throws; bite deals 1 and heals +2 for an enemy (§5)',
  fn() {
    let s = mkBattle({
      units: [
        { form: 'Leviadon', owner: 0, x: 3, y: 3, hp: 5 },
        { form: 'Zapkitt', owner: 1, x: 4, y: 4 },     // adjacent enemy, hp 3
        { form: 'Pupfloe', owner: 1, x: 7, y: 7 },     // far — not a legal target
      ],
    });
    s = GM.applyAction(s, 0, { t: 'endTurn' });
    assertEq(s.turn.pendingAuras, [0], 'Hungry Depths pending at controller\'s turn end');
    assertThrows(() => GM.applyAction(s, 0, { t: 'aura', unitId: 0 }),
      'omitting the target while an adjacent unit exists must throw (bite is mandatory)');
    assertThrows(() => GM.applyAction(s, 0, { t: 'aura', unitId: 0, target: 2 }),
      'a non-adjacent unit is an illegal bite target');
    s = GM.applyAction(s, 0, { t: 'aura', unitId: 0, target: 1 });
    assertEq(unit(s, 1).hp, 2, 'bite deals 1');
    assertEq(unit(s, 0).hp, 7, 'enemy bite heals +2 (5→7)');
    assertEq(s.turn.player, 1, 'turn passes once auras empty');
  },
});

tests.push({
  name: 'hungryDepths: may bite a FRIEND — ally bite deals 1 and heals +3 (§5)',
  fn() {
    let s = mkBattle({
      units: [
        { form: 'Leviadon', owner: 0, x: 3, y: 3, hp: 4 },
        { form: 'Shriket', owner: 0, x: 2, y: 3 },   // adjacent ally, hp 4
        { form: 'Zapkitt', owner: 1, x: 4, y: 3 },   // adjacent enemy also available, hp 3
        { form: 'Pupfloe', owner: 1, x: 7, y: 7 },
      ],
    });
    s = endTurn(s, 0, [{ unitId: 0, target: 1 }]); // choose the ally over the enemy
    assertEq(unit(s, 1).hp, 3, 'ally bitten for 1');
    assertEq(unit(s, 0).hp, 7, 'ally bite heals +3 (4→7)');
    assertEq(unit(s, 2).hp, 3, 'enemy untouched');
  },
});

tests.push({
  name: 'hungryDepths: heal is capped at max HP — Leviadon at 7/8 biting an ally ends at 8, not 10 (§5)',
  fn() {
    let s = mkBattle({
      units: [
        { form: 'Leviadon', owner: 0, x: 3, y: 3, hp: 7 },  // max 8
        { form: 'Shriket', owner: 0, x: 2, y: 3 },
        { form: 'Pupfloe', owner: 1, x: 7, y: 7 },
      ],
    });
    s = endTurn(s, 0, [{ unitId: 0, target: 1 }]);
    assertEq(unit(s, 0).hp, 8, '7 + 3 capped at max 8');
  },
});

tests.push({
  name: 'hungryDepths: heal applies even when the bite KOs the bitten ally (DEV-PIN 12); the KO sets allyKo for other allies (§4)',
  fn() {
    let s = mkBattle({
      units: [
        { form: 'Leviadon', owner: 0, x: 3, y: 3, hp: 4 },
        { form: 'Zapkitt', owner: 0, x: 4, y: 4, hp: 1 },  // ally at 1 hp — bite KOs it
        { form: 'Cacklet', owner: 0, x: 0, y: 0 },
        { form: 'Pupfloe', owner: 1, x: 7, y: 7 },
      ],
    });
    s = endTurn(s, 0, [{ unitId: 0, target: 1 }]);
    assertEq(unit(s, 1).pos, null, 'ally KO\'d by the bite');
    assertEq(unit(s, 0).hp, 7, '+3 ally heal applies even though the bite KO\'d (DEV-PIN 12)');
    assert(unit(s, 2).allyKoSeen === true, 'aura KO of an ally still counts for allyKo evolution');
  },
});

tests.push({
  name: 'hungryDepths: no adjacent unit → Leviadon takes 1 itself, and can starve to KO (losing the game if it was the last unit) (§5)',
  fn() {
    // A: simple starve tick.
    let a = mkBattle({
      units: [
        { form: 'Leviadon', owner: 0, x: 0, y: 0, hp: 3 },
        { form: 'Shriket', owner: 0, x: 5, y: 5 },
        { form: 'Pupfloe', owner: 1, x: 7, y: 7 },
      ],
    });
    let a1 = GM.applyAction(a, 0, { t: 'endTurn' });
    assertThrows(() => GM.applyAction(a1, 0, { t: 'aura', unitId: 0, target: 1 }),
      'supplying a target when NO unit is adjacent is illegal (CONTRACT aura action)');
    a1 = GM.applyAction(a1, 0, { t: 'aura', unitId: 0 });
    assertEq(unit(a1, 0).hp, 2, 'starved for 1');
    assertEq(a1.turn.player, 1, 'turn passed');
    // B: starving its controller's LAST unit hands the win to the opponent (win check after aura, §5).
    let b = mkBattle({
      units: [
        { form: 'Leviadon', owner: 0, x: 0, y: 0, hp: 1 },
        { form: 'Pupfloe', owner: 1, x: 7, y: 7 },
      ],
    });
    b = endTurn(b, 0);
    assertEq(unit(b, 0).pos, null, 'Leviadon starved to KO');
    assertEq(b.winner, 1, 'opponent wins when the controller\'s last unit starves');
    assertEq(b.phase, 'over');
  },
});

tests.push({
  name: 'hungryDepths: aura damage credits no one (no kos/dealt for Leviadon) but a bite-KO of the last enemy still wins, with the heal applied (§3 attribution, §5, DEV-PIN 12)',
  fn() {
    let s = mkBattle({
      units: [
        { form: 'Leviadon', owner: 0, x: 3, y: 3, hp: 5 },
        { form: 'Zapkitt', owner: 1, x: 4, y: 4, hp: 1 },  // sole enemy at 1 hp
      ],
    });
    s = endTurn(s, 0, [{ unitId: 0, target: 1 }]);
    assertEq(unit(s, 1).pos, null);
    assertEq(s.winner, 0, 'biting the last enemy to KO wins immediately');
    assertEq(unit(s, 0).hp, 7, '+2 enemy-bite heal still applies (DEV-PIN 12)');
    assertEq(unit(s, 0).kos, 0, 'aura KO credits no one');
    assertEq(unit(s, 0).dealt, 0, 'aura damage credits no one');
  },
});

// ───────────────────────── MULTI-AURA ORDER (SPEC §5) ─────────────────────────

tests.push({
  name: 'multiAura: a side with both Tempestdrake and Leviadon chooses resolution order — both orders work via the aura action; re-resolving or acting out of seat throws (§5)',
  fn() {
    const spec = {
      units: [
        { form: 'Tempestdrake', owner: 0, x: 2, y: 2 },          // 0
        { form: 'Leviadon', owner: 0, x: 4, y: 4, hp: 4 },       // 1 (Chebyshev 2 from drake — out of storm range)
        { form: 'Pupfloe', owner: 0, x: 3, y: 3, hp: 2 },        // 2 ally adjacent to BOTH
        { form: 'Floecub', owner: 1, x: 7, y: 7 },               // 3
      ],
    };
    // Order A: storm first, then bite.
    let a = GM.applyAction(mkBattle(spec), 0, { t: 'endTurn' });
    assertEq([...a.turn.pendingAuras].sort((x, y) => x - y), [0, 1], 'both auras pending');
    assertThrows(() => GM.applyAction(a, 1, { t: 'aura', unitId: 0 }),
      'opponent cannot resolve the active player\'s auras');
    a = GM.applyAction(a, 0, { t: 'aura', unitId: 0 });          // storm: ally 2→1
    assertEq(unit(a, 2).hp, 1);
    assertThrows(() => GM.applyAction(a, 0, { t: 'aura', unitId: 0 }),
      'an already-resolved aura cannot be resolved again');
    a = GM.applyAction(a, 0, { t: 'aura', unitId: 1, target: 2 }); // bite KOs ally, heal +3 (DEV-PIN 12)
    assertEq(unit(a, 2).pos, null);
    assertEq(unit(a, 1).hp, 7, '4+3 ally-bite heal');
    assertEq(a.turn.player, 1, 'turn passes when pendingAuras empties');
    // Order B: bite first, then storm — equally legal.
    let b = GM.applyAction(mkBattle(spec), 0, { t: 'endTurn' });
    b = GM.applyAction(b, 0, { t: 'aura', unitId: 1, target: 2 }); // bite: ally 2→1, heal 4→7
    assertEq(unit(b, 2).hp, 1);
    assertEq(unit(b, 1).hp, 7);
    b = GM.applyAction(b, 0, { t: 'aura', unitId: 0 });            // storm finishes the ally
    assertEq(unit(b, 2).pos, null);
    assertEq(b.turn.player, 1);
    // Both orders reach the same final material state here.
    assertEq(unit(a, 1).hp, unit(b, 1).hp);
  },
});

// ───────────────────────── SERIALIZATION (SPEC §9, CONTRACT) ─────────────────────────

tests.push({
  name: 'serialization: a rich mid-activation state (burn, poison, chill, hex, pin, telegrab + evolution counters) JSON round-trips, and the same action sequence on original and clone yields identical JSON — including an Earthquake rng draw',
  fn() {
    let s = mkBattle({
      seed: 42,
      units: [
        { form: 'Terradon', owner: 0, x: 3, y: 3, dealt: 5, survived: 4 },             // 0
        { form: 'Tempestdrake', owner: 0, x: 5, y: 5, hp: 6 },                          // 1
        { form: 'Shriket', owner: 0, x: 5, y: 6, hexTurns: 2, poison: 1, telegrabs: 2 },// 2
        // Pinned "now" for owner 1: pinnedTurn = playerTurns[1] + 1 = 1 (mkBattle default playerTurns [1,0])
        { form: 'Zapkitt', owner: 1, x: 3, y: 4, hp: 3, burn: { n: 1, ticks: 2 }, pinnedTurn: 1, poison: 2, chill: 1 }, // 3
        { form: 'Floecub', owner: 1, x: 2, y: 3 },                                      // 4
        { form: 'Pupfloe', owner: 1, x: 7, y: 7 },                                      // 5
      ],
    });
    s = GM.applyAction(s, 0, { t: 'activate', unitId: 0 });   // mid-activation
    const clone = JSON.parse(JSON.stringify(s));
    assert(J(clone) === J(s), 'JSON round-trip is lossless');

    // Identical sequence applied to both. Expected per SPEC:
    //  - Terradon moves to (3,2), Basic 2 vs Floecub (Ground vs Ice: no ×2) → 4−2 = 2 hp.
    //  - endTurn: Local Storm hits Shriket (5,6): 1 + 1 Hex (every damage source) = 2 → 2 hp.
    //  - P1 turn start: Zapkitt burn tick 1 → 2 hp; quake: Floecub (2,3) adjacent to Terradon (3,2),
    //    seed-42 roll 3 = S → (2,2); rng → 1831565855. Zapkitt at (3,4) is NOT adjacent → no roll.
    //  - P1 activates pinned Zapkitt (legal; movement only is blocked), banks it, ends turn.
    const run = (st) => {
      let x = st;
      x = GM.applyAction(x, 0, { t: 'move', path: [{ x: 3, y: 2 }] });
      x = GM.applyAction(x, 0, { t: 'attack', kind: 'basic', target: { x: 2, y: 3 } });
      x = GM.applyAction(x, 0, { t: 'endActivation' });
      x = GM.applyAction(x, 0, { t: 'endTurn' });
      x = GM.applyAction(x, 0, { t: 'aura', unitId: 1 });
      x = GM.applyAction(x, 1, { t: 'activate', unitId: 3 });
      x = GM.applyAction(x, 1, { t: 'endActivation' });
      x = GM.applyAction(x, 1, { t: 'endTurn' });
      return x;
    };
    const s1 = run(s);
    const s2 = run(clone);
    assert(J(s1) === J(s2), 'original and clone replay to identical JSON (determinism)');
    assertEq(unit(s1, 4).pos, { x: 2, y: 2 }, 'quake S moved Floecub');
    assertEq(unit(s1, 4).hp, 2, 'Basic 2 landed');
    assertEq(unit(s1, 2).hp, 2, 'storm 1 + Hex 1 = 2 on the hexed ally');
    assertEq(unit(s1, 3).hp, 2, 'burn ticked 1');
    assertEq(s1.rng, 1831565855, 'exactly one quake roll consumed');
  },
});

// Round-trip helper: apply both the action and its JSON clone, demand identical results.
function rt(state, player, action) {
  const cloned = JSON.parse(JSON.stringify(action));
  const r1 = GM.applyAction(state, player, action);
  const r2 = GM.applyAction(state, player, cloned);
  assert(J(r1) === J(r2), `action ${action.t} must survive a JSON round-trip with identical result`);
  return r1;
}

tests.push({
  name: 'serialization: pick / place / confirm / activate / move / endActivation / endTurn all survive a JSON round-trip through a real createGame flow (CONTRACT actions)',
  fn() {
    // coinWinner 0 → draft.order = [0,1, 1,0,0,1,1,0,0,1,1,0] (W, L, then snake L W W L L W W L L W).
    let s = GM.createGame(123, 0);
    assertEq(s.phase, 'draft');
    s = rt(s, 0, { t: 'pick', lineId: 'cinderling' });   // winner's tyrant
    s = rt(s, 1, { t: 'pick', lineId: 'wyrmlet' });      // loser's tyrant
    assertEq(s.draft.cutTyrant, 'frostfawn', 'third tyrant cut');
    const snake = [
      [1, 'guppling'], [0, 'snapling'], [0, 'mosskit'], [1, 'gritling'], [1, 'falchick'],
      [0, 'podling'], [0, 'zapkitt'], [1, 'hootle'], [1, 'slithrin'], [0, 'coilbug'],
    ];
    for (const [p, lineId] of snake) s = rt(s, p, { t: 'pick', lineId });
    assertEq(s.phase, 'placement');

    const p0Lines = ['cinderling', 'snapling', 'mosskit', 'podling', 'zapkitt', 'coilbug'];
    const p1Lines = ['wyrmlet', 'guppling', 'gritling', 'falchick', 'hootle', 'slithrin'];
    p0Lines.forEach((lineId, i) => { s = rt(s, 0, { t: 'place', lineId, x: i, y: 0 }); });
    s = rt(s, 0, { t: 'confirm' });
    p1Lines.forEach((lineId, i) => { s = rt(s, 1, { t: 'place', lineId, x: i, y: 7 }); });
    s = rt(s, 1, { t: 'confirm' });
    assertEq(s.phase, 'battle');
    assertEq(s.units.length, 12);

    s = rt(s, 0, { t: 'activate', unitId: 0 });            // Cinderling at (0,0)
    s = rt(s, 0, { t: 'move', path: [{ x: 0, y: 1 }] });
    s = rt(s, 0, { t: 'endActivation' });
    s = rt(s, 0, { t: 'endTurn' });
    assertEq(s.turn.player, 1, 'turn passed');
    assertEq(unit(s, 0).pos, { x: 0, y: 1 });
  },
});

tests.push({
  name: 'serialization: attack variants (basic, focus, lungeTo, blinkTo, relocateTo), aura and rematch all survive JSON round-trips with identical results (CONTRACT attack params)',
  fn() {
    // basic
    let b = mkBattle({
      units: [
        { form: 'Shriket', owner: 0, x: 3, y: 3 },
        { form: 'Pupfloe', owner: 1, x: 3, y: 4 },
      ],
    });
    b = GM.applyAction(b, 0, { t: 'activate', unitId: 0 });
    b = rt(b, 0, { t: 'attack', kind: 'basic', target: { x: 3, y: 4 } });
    assertEq(unit(b, 1).hp, 2, 'Basic 2 (Dark vs Ice: no ×2)');

    // focus — Leviadon Maelstrom (Water burst 3) with TWO Fire enemies hit → focus required (§3).
    let f = mkBattle({
      units: [
        { form: 'Leviadon', owner: 0, x: 3, y: 3 },
        { form: 'Sootpup', owner: 1, x: 2, y: 3 },     // Fire, hp 4 — focused: 3×2 = 6 → KO
        { form: 'Cinderling', owner: 1, x: 4, y: 4 },  // Fire, hp 4 — unfocused: 3 → 1 hp
        { form: 'Pupfloe', owner: 1, x: 7, y: 7 },
      ],
    });
    f = GM.applyAction(f, 0, { t: 'activate', unitId: 0 });
    assertThrows(() => GM.applyAction(f, 0, { t: 'attack', kind: 'special' }),
      'focus is REQUIRED with ≥2 super-effective-eligible hits');
    f = rt(f, 0, { t: 'attack', kind: 'special', focus: 1 });
    assertEq(unit(f, 1).pos, null, 'focused Fire unit took 6 and is KO\'d');
    assertEq(unit(f, 2).hp, 1, 'other hit unit took plain 3');
    assertEq(unit(f, 2).pos, { x: 5, y: 5 }, 'Maelstrom Push 1 directly away (diagonal sign vector, DEV-PIN 14)');

    // lungeTo — Pumarok Pounce (Single 2, dmg 3, Lunge).
    let l = mkBattle({
      units: [
        { form: 'Pumarok', owner: 0, x: 3, y: 3 },
        { form: 'Hootle', owner: 1, x: 3, y: 5 },   // hp 4 → 1 (Ground vs Psychic: no ×2)
        { form: 'Pupfloe', owner: 1, x: 7, y: 7 },
      ],
    });
    l = GM.applyAction(l, 0, { t: 'activate', unitId: 0 });
    l = rt(l, 0, { t: 'attack', kind: 'special', dir: { dx: 0, dy: 1 }, lungeTo: { x: 3, y: 4 } });
    assertEq(unit(l, 1).hp, 1);
    assertEq(unit(l, 0).pos, { x: 3, y: 4 }, 'lunged adjacent to the target');

    // blinkTo — Velvesper Mindclaw (Single 1, dmg 3, Blink 2).
    let v = mkBattle({
      units: [
        { form: 'Velvesper', owner: 0, x: 3, y: 3 },
        { form: 'Pupfloe', owner: 1, x: 3, y: 4 },  // hp 4 → 1
      ],
    });
    v = GM.applyAction(v, 0, { t: 'activate', unitId: 0 });
    v = rt(v, 0, { t: 'attack', kind: 'special', dir: { dx: 0, dy: 1 }, blinkTo: { x: 5, y: 3 } });
    assertEq(unit(v, 1).hp, 1);
    assertEq(unit(v, 0).pos, { x: 5, y: 3 }, 'blinked to an empty square within Chebyshev 2');

    // relocateTo — Archistrix Telegrab (range 3, relocate ≤2, Telesmash = min(3, lifetime count incl. this grab)).
    let t = mkBattle({
      units: [
        { form: 'Archistrix', owner: 0, x: 3, y: 3 },
        { form: 'Pupfloe', owner: 1, x: 3, y: 5 },  // first grab → Telesmash 1: hp 4 → 3
      ],
    });
    t = GM.applyAction(t, 0, { t: 'activate', unitId: 0 });
    t = rt(t, 0, { t: 'attack', kind: 'special', targetUnit: 1, relocateTo: { x: 4, y: 4 } });
    assertEq(unit(t, 1).pos, { x: 4, y: 4 }, 'relocated within 2 of its square');
    assertEq(unit(t, 1).hp, 3, 'Telesmash 1 on first grab');
    assertEq(unit(t, 1).telegrabs, 1, 'lifetime counter incremented');

    // aura + rematch — storm KOs the last enemy, then either player rematches.
    let o = mkBattle({
      units: [
        { form: 'Tempestdrake', owner: 0, x: 3, y: 3 },
        { form: 'Zapkitt', owner: 1, x: 3, y: 4, hp: 1 },
      ],
    });
    o = GM.applyAction(o, 0, { t: 'endTurn' });
    o = rt(o, 0, { t: 'aura', unitId: 0 });
    assertEq(o.winner, 0);
    assertEq(o.phase, 'over');
    o = rt(o, 1, { t: 'rematch', seed: 777, coinWinner: 1 });
    assertEq(o.phase, 'draft', 'rematch starts a fresh draft');
    assertEq(o.seed, 777, 'rematch uses the supplied seed');
    assertEq(o.coinWinner, 1, 'rematch uses the supplied coin flip');
  },
});

module.exports = tests;
