#!/usr/bin/env node
// scripts/playthrough.js — deterministic scripted FULL GAME through the PUBLIC
// engine API only (GM.createGame + GM.applyAction, plus exported read helpers).
//
//   node scripts/playthrough.js
//
// Exit 0 silently on success. On any failure: prints the turn-by-turn trace it
// kept as it went, the tail of the engine battle log, and a clear error, then
// exits 1. Set VERBOSE=1 to stream the trace live.
//
// Coverage (per task): 12-pick draft (tyrant phase + snake), full placement on
// both sides (incl. one reposition + one unplace), battle to a real win (all 6
// enemy units KO'd), exercising moves, basics, a Special with a required focus
// pick (Scorching Howl cone over two Ice units), evolutions with the +2-capped
// refresh asserted on every stage gain, a Burn tick (incl. a burn-tick KO with
// attribution), end-of-turn Hungry Depths auras (bite + heal, and heal capped
// at max), and turns with 3, 2, 1, and 0 activations. Invariants are checked
// after EVERY applyAction. Finishes with (a) a mid-game JSON round-trip where
// the same remaining actions are replayed on both copies, and (b) a fresh
// replay of the ENTIRE action list from createGame — both must reproduce the
// exact final JSON.
'use strict';

const path = require('path');
const GM = require(path.join(__dirname, '..', 'engine.js'));
const DATA = require(path.join(__dirname, '..', 'data.js'));

const SEED = 12345;
const COIN_WINNER = 0;

const LINE_BY_ID = {};
for (const line of DATA.lines) LINE_BY_ID[line.id] = line;

// ---------- harness ----------
const TRACE = [];
function tr(msg) { TRACE.push(msg); if (process.env.VERBOSE) console.log(msg); }
function fail(msg) { throw new Error(msg); }
function assert(cond, msg) { if (!cond) fail('ASSERT: ' + msg); }
function assertEq(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) fail('ASSERT: ' + msg + ' — expected ' + e + ', got ' + a);
}
function expectThrows(fn, what) {
  try { fn(); } catch (err) { tr('    (rejected as expected — ' + what + ': ' + err.message + ')'); return err; }
  fail('ASSERT: expected applyAction to throw — ' + what);
}

let cur = null;            // current state
const actions = [];        // every applied action, in order: {player, action}
const activationCounts = []; // activationsUsed at each endTurn
const evolutionsSeen = []; // names, for the final coverage check

function nameOf(u) { return LINE_BY_ID[u.lineId].stages[u.stage].name; }
function U(id) { return cur.units[id]; }

// ---------- invariants, checked after every action ----------
function checkInvariants(prev, next, label) {
  // playerTurns monotonic, at most one turn-start per action
  let bump = 0;
  for (const p of [0, 1]) {
    assert(next.playerTurns[p] >= prev.playerTurns[p],
      'playerTurns[' + p + '] decreased at "' + label + '"');
    bump += next.playerTurns[p] - prev.playerTurns[p];
  }
  assert(bump <= 1, 'playerTurns jumped by ' + bump + ' in one action at "' + label + '"');

  // board consistency + hp bounds
  const occupied = {};
  next.units.forEach((u, i) => {
    assert(u.id === i, 'unit id ' + u.id + ' not at index ' + i);
    const max = LINE_BY_ID[u.lineId].stages[u.stage].hp;
    assert(u.hp <= max, nameOf(u) + ' hp ' + u.hp + ' exceeds max ' + max + ' at "' + label + '"');
    if (u.pos) {
      assert(Number.isInteger(u.pos.x) && Number.isInteger(u.pos.y) &&
        u.pos.x >= 0 && u.pos.x < 8 && u.pos.y >= 0 && u.pos.y < 8,
        nameOf(u) + ' off-board at "' + label + '"');
      const key = u.pos.x + ',' + u.pos.y;
      assert(!occupied[key], 'two units share square ' + key + ' at "' + label + '"');
      occupied[key] = true;
      assert(u.hp >= 1, 'living ' + nameOf(u) + ' has hp ' + u.hp + ' at "' + label + '"');
    } else if (next.phase === 'battle' || next.phase === 'over') {
      assert(u.hp === 0, "KO'd " + nameOf(u) + ' has hp ' + u.hp + ' at "' + label + '"');
    }
  });

  // activation accounting
  if (next.phase === 'battle') {
    const t = next.turn;
    assert(t.activationsUsed >= 0 && t.activationsUsed <= 3,
      'activationsUsed ' + t.activationsUsed + ' out of range at "' + label + '"');
    assert(t.activated.length === t.activationsUsed,
      'activated list length ' + t.activated.length + ' != activationsUsed ' +
      t.activationsUsed + ' at "' + label + '"');
    assert(new Set(t.activated).size === t.activated.length,
      'duplicate unit in activated list at "' + label + '"');
  }

  // stages never regress; every evolution is exactly +2 HP capped at the new max
  prev.units.forEach((pu, i) => {
    const nu = next.units[i];
    assert(nu, 'unit ' + i + ' vanished at "' + label + '"');
    assert(nu.stage >= pu.stage, nameOf(pu) + ' stage decreased at "' + label + '"');
    if (nu.stage > pu.stage) {
      assert(nu.stage === pu.stage + 1,
        'unexpected multi-stage evolution in one action at "' + label + '"');
      assert(!pu.burn, 'evolving unit was burning — refresh check would be confounded');
      const newMax = LINE_BY_ID[nu.lineId].stages[nu.stage].hp;
      assertEq(nu.hp, Math.min(newMax, pu.hp + 2),
        'evolution refresh must be exactly +2 capped at new max for ' + nameOf(nu) +
        ' (was ' + pu.hp + ', new max ' + newMax + ') at "' + label + '"');
      evolutionsSeen.push(nameOf(pu) + '->' + nameOf(nu) +
        ' (' + pu.hp + '->' + nu.hp + '/' + newMax + ')');
      tr('    EVOLUTION ' + evolutionsSeen[evolutionsSeen.length - 1]);
    }
  });
}

function step(player, action, label) {
  const prev = cur;
  cur = GM.applyAction(cur, player, action);
  actions.push({ player, action });
  checkInvariants(prev, cur, label || action.t);
  return cur;
}

// activate / optional move / optional attack / endActivation (skipped if won)
function act(player, unitId, opts) {
  opts = opts || {};
  const who = nameOf(U(unitId));
  step(player, { t: 'activate', unitId });
  if (opts.path) {
    step(player, { t: 'move', path: opts.path });
    const p = U(unitId).pos;
    tr('  P' + (player + 1) + ' ' + who + ' moves to (' + p.x + ',' + p.y + ')');
  }
  if (opts.attack) {
    step(player, Object.assign({ t: 'attack' }, opts.attack));
    tr('  P' + (player + 1) + ' ' + who + ' attacks (' + (opts.attack.kind) + ')');
  }
  if (!opts.path && !opts.attack) tr('  P' + (player + 1) + ' ' + who + ' activates (no-op)');
  if (cur.phase === 'over') return;
  step(player, { t: 'endActivation' });
}

// endTurn + resolve any pending end-of-turn auras with scripted choices
function endTurn(player, auraChoices) {
  activationCounts.push(cur.turn.activationsUsed);
  step(player, { t: 'endTurn' });
  const choices = (auraChoices || []).slice();
  while (cur.phase === 'battle' && cur.turn.pendingAuras && cur.turn.pendingAuras.length) {
    const c = choices.shift() || { unitId: cur.turn.pendingAuras[0] };
    tr('  P' + (player + 1) + ' resolves aura of unit ' + c.unitId +
      (c.target !== undefined ? ' on unit ' + c.target : ''));
    step(player, Object.assign({ t: 'aura' }, c));
  }
  if (cur.phase === 'battle') {
    tr('— P' + (cur.turn.player + 1) + ' turn ' + cur.playerTurns[cur.turn.player] + ' —');
  }
}

function replay(startState, slice) {
  let s = startState;
  for (const rec of slice) s = GM.applyAction(s, rec.player, rec.action);
  return s;
}

// ---------- the game ----------
function main() {
  cur = GM.createGame(SEED, COIN_WINNER);
  assertEq(cur.phase, 'draft', 'new game starts in draft');
  assertEq(cur.seed, SEED, 'seed stored');
  assertEq(cur.coinWinner, 0, 'coin winner stored');
  assertEq(cur.draft.order, [0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0],
    'draft order: [W,L] tyrant picks then snake L W W L L W W L L W with W=0');
  tr('=== DRAFT (seed ' + SEED + ', coin winner P1) ===');

  // Tyrant phase. Winner (P0) first, then loser (P1); third tyrant is cut.
  expectThrows(() => GM.applyAction(cur, 1, { t: 'pick', lineId: 'frostfawn' }),
    'loser picking before winner');
  step(0, { t: 'pick', lineId: 'wyrmlet' });
  expectThrows(() => GM.applyAction(cur, 1, { t: 'pick', lineId: 'zapkitt' }),
    'non-tyrant in the tyrant phase');
  step(1, { t: 'pick', lineId: 'cinderling' });
  assertEq(cur.draft.cutTyrant, 'frostfawn', 'third tyrant cut after second tyrant pick');
  expectThrows(() => GM.applyAction(cur, 1, { t: 'pick', lineId: 'frostfawn' }),
    'picking the cut tyrant');

  // Snake: L W W L L W W L L W
  const snake = [
    [1, 'zapkitt'], [0, 'sootpup'], [0, 'guppling'], [1, 'floecub'], [1, 'pupfloe'],
    [0, 'shriket'], [0, 'mystikit'], [1, 'slithrin'], [1, 'shadekit'], [0, 'pebblepaw'],
  ];
  for (const [p, id] of snake) step(p, { t: 'pick', lineId: id });
  tr('P1 team: ' + cur.draft.teams[0].join(', '));
  tr('P2 team: ' + cur.draft.teams[1].join(', '));
  assertEq(cur.phase, 'placement', 'placement after 12 picks');
  for (const p of [0, 1]) {
    assertEq(cur.draft.teams[p].length, 6, 'team ' + p + ' has 6 lines');
    const tyr = cur.draft.teams[p].filter(id => LINE_BY_ID[id].tyrant);
    assertEq(tyr.length, 1, 'team ' + p + ' has exactly one tyrant');
  }
  assertEq(new Set(cur.draft.teams[0].concat(cur.draft.teams[1])).size, 12,
    '12 distinct drafted lines (12 of 24 sit out)');

  // ---------- placement ----------
  tr('=== PLACEMENT ===');
  // P0 — exercise reposition + unplace, then final layout on rows y0–1.
  step(0, { t: 'place', lineId: 'wyrmlet', x: 0, y: 0 });
  step(0, { t: 'unplace', lineId: 'wyrmlet' });
  step(0, { t: 'place', lineId: 'wyrmlet', x: 0, y: 0 });
  step(0, { t: 'place', lineId: 'wyrmlet', x: 3, y: 1 });   // re-place moves it
  assertEq(cur.units.length, 1, 'reposition/unplace reuse one unit, no duplicates');
  step(0, { t: 'place', lineId: 'sootpup', x: 2, y: 1 });
  step(0, { t: 'place', lineId: 'guppling', x: 4, y: 1 });
  step(0, { t: 'place', lineId: 'shriket', x: 5, y: 1 });
  step(0, { t: 'place', lineId: 'mystikit', x: 1, y: 1 });
  step(0, { t: 'place', lineId: 'pebblepaw', x: 6, y: 1 });
  expectThrows(() => GM.applyAction(cur, 0, { t: 'place', lineId: 'sootpup', x: 2, y: 5 }),
    'placing outside own back two rows');
  step(0, { t: 'confirm' });
  // P1 on rows y6–7.
  step(1, { t: 'place', lineId: 'cinderling', x: 3, y: 6 });
  step(1, { t: 'place', lineId: 'zapkitt', x: 2, y: 6 });
  step(1, { t: 'place', lineId: 'floecub', x: 4, y: 6 });
  step(1, { t: 'place', lineId: 'pupfloe', x: 5, y: 6 });
  step(1, { t: 'place', lineId: 'slithrin', x: 1, y: 6 });
  step(1, { t: 'place', lineId: 'shadekit', x: 6, y: 6 });
  step(1, { t: 'confirm' });

  assertEq(cur.phase, 'battle', 'battle begins after both confirms');
  assertEq(cur.playerTurns, [1, 0], "P1's turn 1 has started");
  assertEq(cur.units.length, 12, '12 units fielded');
  assert(cur.units.every(u => u.stage === 0), 'all units start in base form');
  // unit ids (placement order):
  // P0: 0 Wyrmlet(3,1) 1 Sootpup(2,1) 2 Guppling(4,1) 3 Shriket(5,1) 4 Mystikit(1,1) 5 Pebblepaw(6,1)
  // P1: 6 Cinderling(3,6) 7 Zapkitt(2,6) 8 Floecub(4,6) 9 Pupfloe(5,6) 10 Slithrin(1,6) 11 Shadekit(6,6)
  tr('=== BATTLE ===');
  tr('— P1 turn 1 —');

  // ---- P0 turn 1: advance (3 activations) ----
  expectThrows(() => GM.applyAction(cur, 1, { t: 'activate', unitId: 7 }),
    "acting on the opponent's turn");
  // Sootpup: probe an illegal move (into Wyrmlet's square), then the real one.
  step(0, { t: 'activate', unitId: 1 });
  expectThrows(() => GM.applyAction(cur, 0, { t: 'move', path: [{ x: 3, y: 1 }] }),
    'moving onto an occupied square');
  const reach = GM.reachable(cur, 1);
  assert(reach.some(r => r.x === 2 && r.y === 3 && r.path.length === 2),
    'GM.reachable offers (2,3) in 2 steps for Sootpup (Speed 2)');
  step(0, { t: 'move', path: [{ x: 2, y: 2 }, { x: 2, y: 3 }] });
  tr('  P1 Sootpup moves to (2,3)');
  step(0, { t: 'endActivation' });
  act(0, 0, { path: [{ x: 3, y: 2 }, { x: 3, y: 3 }] });             // Wyrmlet
  act(0, 3, { path: [{ x: 5, y: 2 }, { x: 5, y: 3 }] });             // Shriket
  endTurn(0);

  // ---- P1 turn 1: advance the bait (3 activations) ----
  act(1, 7, { path: [{ x: 2, y: 5 }, { x: 2, y: 4 }] });             // Zapkitt
  act(1, 8, { path: [{ x: 4, y: 5 }, { x: 4, y: 4 }] });             // Floecub
  act(1, 9, { path: [{ x: 5, y: 5 }] });                             // Pupfloe
  endTurn(1);

  // ---- P0 turn 2: first blood (3 activations, basics) ----
  act(0, 1, { attack: { kind: 'basic', target: { x: 2, y: 4 } } });  // Sootpup -> Zapkitt 3->1
  assertEq(U(7).hp, 1, 'Zapkitt at 1 hp after a 2-damage Basic');
  act(0, 3, { path: [{ x: 5, y: 4 }], attack: { kind: 'basic', target: { x: 5, y: 5 } } }); // Shriket -> Pupfloe 4->2
  assertEq(U(9).hp, 2, 'Pupfloe at 2 hp');
  act(0, 2, { path: [{ x: 4, y: 2 }] });                             // Guppling creeps up
  endTurn(0);

  // ---- P1 turn 2: Zapkitt bites back; flanks advance ----
  act(1, 7, { attack: { kind: 'basic', target: { x: 2, y: 3 } } });  // Zapkitt -> Sootpup 4->2
  assertEq(U(1).hp, 2, 'Sootpup at 2 hp');
  act(1, 11, { path: [{ x: 6, y: 5 }, { x: 6, y: 4 }] });            // Shadekit
  act(1, 10, { path: [{ x: 1, y: 5 }, { x: 1, y: 4 }] });            // Slithrin
  endTurn(1);

  // ---- P0 turn 3: Sootpup takes the KO it needs to evolve ----
  act(0, 1, { attack: { kind: 'basic', target: { x: 2, y: 4 } } });  // Zapkitt KO
  assertEq(U(7).pos, null, "Zapkitt KO'd");
  assertEq(U(1).kos, 1, 'KO credited to Sootpup');
  act(0, 3, { attack: { kind: 'basic', target: { x: 6, y: 4 } } });  // Shriket -> Shadekit 4->2 (dealt 4)
  assertEq(U(3).dealt, 4, 'Shriket has dealt 4 (evolution threshold)');
  act(0, 4, { path: [{ x: 1, y: 2 }, { x: 1, y: 3 }] });             // Mystikit
  endTurn(0);

  // ---- P1 turn 3: light retaliation ----
  act(1, 9, { attack: { kind: 'basic', target: { x: 5, y: 4 } } });  // Pupfloe -> Shriket 4->2
  act(1, 10, { attack: { kind: 'basic', target: { x: 1, y: 3 } } }); // Slithrin -> Mystikit 4->2
  act(1, 11, { path: [{ x: 6, y: 3 }] });                            // Shadekit
  endTurn(1);

  // ---- P0 turn 4 start: THREE evolutions, +2-capped refresh asserted ----
  // (checkInvariants verified the formula; pin the exact expectations too)
  assert(U(0).stage === 1 && U(0).hp === 6, 'Wyrmlet->Galewyrm at 4+2=6/6');
  assert(U(1).stage === 1 && U(1).hp === 4, 'Sootpup->Hellhowl at 2+2=4/7 — NOT a full heal');
  assert(U(3).stage === 1 && U(3).hp === 4, 'Shriket->Butcherbeak at 2+2=4/5');

  // Galewyrm steps aside and uses its weakened Special (Single, no effect/rider).
  act(0, 0, { path: [{ x: 3, y: 4 }], attack: { kind: 'special', dir: { dx: 0, dy: 1 } } });
  assertEq(U(6).hp, 2, 'Gale Breath: 2 damage to Cinderling at range 2');

  // Hellhowl lines up the cone: near square = Floecub(4,4), far row holds Pupfloe(5,5).
  step(0, { t: 'activate', unitId: 1 });
  assertEq(GM.effectiveSpeed(cur, 1), 5, 'Hellhowl speed 5');
  assert(GM.reachable(cur, 1).some(r => r.x === 4 && r.y === 3), 'Hellhowl can reach (4,3)');
  step(0, { t: 'move', path: [{ x: 3, y: 3 }, { x: 4, y: 3 }] });
  tr('  P1 Hellhowl moves to (4,3)');
  const pv0 = GM.previewAttack(cur, 1, { kind: 'special', dir: { dx: 0, dy: 1 } });
  assert(pv0.legal && pv0.needsFocus, 'cone over two Ice units needs a focus pick');
  assertEq(pv0.focusEligible.slice().sort(), [8, 9], 'both Ice units focus-eligible');
  expectThrows(() => GM.applyAction(cur, 0, { t: 'attack', kind: 'special', dir: { dx: 0, dy: 1 } }),
    'declaring the cone without the required focus');
  const pv1 = GM.previewAttack(cur, 1, { kind: 'special', dir: { dx: 0, dy: 1 }, focus: 9 });
  assert(pv1.legal, 'cone with focus is legal');
  assertEq(pv1.hits.find(h => h.unitId === 9).dmg, 6, 'focused Pupfloe takes 3x2=6');
  assertEq(pv1.hits.find(h => h.unitId === 8).dmg, 3, 'unfocused Floecub takes 3');
  step(0, { t: 'attack', kind: 'special', dir: { dx: 0, dy: 1 }, focus: 9 });
  tr('  P1 Hellhowl cones N with focus on Pupfloe');
  assertEq(U(9).pos, null, "Pupfloe KO'd by the super-effective focus (2hp vs 6)");
  assertEq(U(8).hp, 1, 'Floecub 4->1');
  assertEq(U(8).pos, { x: 4, y: 5 }, 'Floecub pushed 1 away from the attacker');
  assertEq(U(8).burn, { n: 1, ticks: 2 }, 'Burn 1 landed on the near-square unit');
  assertEq(U(8).burnBy, 1, 'burn attributed to Hellhowl');
  step(0, { t: 'endActivation' });

  act(0, 3, { attack: { kind: 'basic', target: { x: 6, y: 3 } } }); // Butcherbeak -> Shadekit KO
  assertEq(U(11).pos, null, "Shadekit KO'd");
  const dealtBefore = U(1).dealt, kosBefore = U(1).kos;
  endTurn(0);

  // ---- P1 turn 4 start: Burn tick KOs Floecub, credited to Hellhowl ----
  assertEq(U(8).pos, null, "burn tick (1 dmg) KO'd the 1-hp Floecub at its turn start");
  assertEq(U(1).dealt, dealtBefore + 1, 'burn tick damage credited to Hellhowl');
  assertEq(U(1).kos, kosBefore + 1, 'burn-tick KO credited to Hellhowl');
  // P1 banks the whole turn: a legal ZERO-activation turn.
  tr('  P2 passes (0 activations)');
  endTurn(1);

  // ---- P0 turn 5 start: Guppling -> Leviadon (survived 4) ----
  assert(U(2).stage === 1 && U(2).hp === 5, 'Guppling->Leviadon at 3+2=5/8 — NOT a full heal');
  act(0, 1, { path: [{ x: 4, y: 4 }, { x: 4, y: 5 }, { x: 3, y: 5 }],
    attack: { kind: 'basic', target: { x: 3, y: 6 } } });            // Hellhowl -> Cinderling KO
  assertEq(U(6).pos, null, "Cinderling KO'd");
  act(0, 2, { path: [{ x: 4, y: 3 }] });                            // Leviadon next to Galewyrm
  // End with only 2 activations used; Hungry Depths is mandatory — bite an ally.
  step(0, { t: 'endTurn' });
  activationCounts.push(2);
  assertEq(cur.turn.pendingAuras, [2], 'Hungry Depths pending for Leviadon');
  expectThrows(() => GM.applyAction(cur, 0, { t: 'endTurn' }),
    'ending the turn with auras pending');
  assertEq(GM.pendingAuras(cur),
    [{ unitId: 2, kind: 'hungryDepths', needsTarget: true, targets: [0, 3] }],
    'GM.pendingAuras: mandatory bite, adjacent Galewyrm(0) and Butcherbeak(3)');
  expectThrows(() => GM.applyAction(cur, 0, { t: 'aura', unitId: 2 }),
    'omitting the mandatory Hungry Depths target');
  step(0, { t: 'aura', unitId: 2, target: 0 });
  tr('  P1 Leviadon bites ally Galewyrm (1 dmg, heals 3)');
  assertEq(U(0).hp, 5, 'Galewyrm bitten for 1 (6->5)');
  assertEq(U(2).hp, 8, 'Leviadon healed 3 for an ally bite (5->8)');
  tr('— P2 turn 5 —');

  // ---- P1 turn 5: lone Slithrin retreats (1 activation) ----
  act(1, 10, { path: [{ x: 1, y: 5 }, { x: 1, y: 6 }] });
  endTurn(1);

  // ====== MID-GAME SNAPSHOT (start of P0 turn 6) ======
  const midState = cur;
  const midIndex = actions.length;
  tr('  [mid-game snapshot taken: ' + midIndex + ' actions so far]');

  // ---- P0 turn 6: chase (1 activation) ----
  act(0, 1, { path: [{ x: 2, y: 5 }] , attack: { kind: 'basic', target: { x: 1, y: 6 } } });
  assertEq(U(10).hp, 2, 'Slithrin 4->2');
  step(0, { t: 'endTurn' });
  activationCounts.push(1);
  assertEq(cur.turn.pendingAuras, [2], 'Hungry Depths pending again');
  step(0, { t: 'aura', unitId: 2, target: 0 });
  tr('  P1 Leviadon bites ally Galewyrm again (heal capped at max)');
  assertEq(U(0).hp, 4, 'Galewyrm bitten again (5->4)');
  assertEq(U(2).hp, 8, 'Leviadon heal capped at max HP (stays 8)');
  tr('— P2 turn 6 —');

  // ---- P1 turn 6: Slithrin's Water Basic is super-effective vs Fire — 2x2=4 KOs Hellhowl ----
  act(1, 10, { attack: { kind: 'basic', target: { x: 2, y: 5 } } });
  assert(U(1).pos === null && U(1).hp === 0,
    "Hellhowl (4 hp, Fire) KO'd by Slithrin's super-effective Water Basic (2x2=4)");
  assertEq(U(10).dealt, 6, 'Slithrin credited 2+4 dealt');
  assertEq(U(10).kos, 1, 'KO credited to Slithrin');
  endTurn(1);

  // ---- P0 turn 7: the kill — win mid-activation ----
  act(0, 0, { path: [{ x: 2, y: 4 }, { x: 2, y: 5 }],
    attack: { kind: 'basic', target: { x: 1, y: 6 } } });            // Galewyrm finishes Slithrin
  tr('  P1 Galewyrm finishes Slithrin — game over');
  assertEq(cur.phase, 'over', 'game over on the last KO');
  assertEq(cur.winner, 0, 'P1 wins');
  assert(cur.units.filter(u => u.owner === 1).every(u => u.pos === null && u.hp === 0),
    "all 6 P2 units KO'd");
  assertEq(U(10).stage, 0, 'Slithrin hit dealt 4 but died before its evolution turn started');
  expectThrows(() => GM.applyAction(cur, 0, { t: 'endActivation' }),
    'any battle action after the game is over');
  assertEq(cur.playerTurns, [7, 6], '13 battle turns played (7 + 6)');

  // ---------- coverage checks ----------
  assertEq(evolutionsSeen.length, 4, 'four evolutions observed with +2-capped refresh');
  assert(activationCounts.includes(3), 'a 3-activation turn happened');
  assert(activationCounts.includes(2), 'a 2-activation turn happened');
  assert(activationCounts.includes(1), 'a 1-activation turn happened');
  assert(activationCounts.includes(0), 'a 0-activation turn happened');
  assert(activationCounts.every(n => n <= 3), 'no turn exceeded 3 activations');

  // ---------- (a) mid-game JSON round-trip + identical remaining replay ----------
  const finalJson = JSON.stringify(cur);
  const rest = actions.slice(midIndex);
  const viaOriginal = replay(midState, rest);
  const viaRoundTrip = replay(JSON.parse(JSON.stringify(midState)), rest);
  assert(JSON.stringify(viaOriginal) === finalJson,
    'replaying the remaining actions on the original mid-game state diverged');
  assert(JSON.stringify(viaRoundTrip) === finalJson,
    'replaying the remaining actions on the JSON round-tripped copy diverged');
  tr('  [mid-game round-trip + ' + rest.length + '-action replay: identical final JSON]');

  // ---------- (b) full-game determinism from createGame ----------
  const fresh = replay(GM.createGame(SEED, COIN_WINNER), actions);
  assert(JSON.stringify(fresh) === finalJson,
    'fresh replay of the entire ' + actions.length + '-action game diverged');
  tr('  [full ' + actions.length + '-action replay from createGame: identical final JSON]');
}

try {
  main();
  process.exit(0);
} catch (err) {
  console.log('=== PLAYTHROUGH TRACE ===');
  for (const line of TRACE) console.log(line);
  if (cur && cur.log) {
    console.log('=== ENGINE LOG (tail) ===');
    for (const e of cur.log.slice(-20)) console.log('  ' + e.msg);
  }
  console.error('\nPLAYTHROUGH FAILED: ' + err.message);
  console.error(err.stack.split('\n').slice(1, 4).join('\n'));
  process.exit(1);
}
