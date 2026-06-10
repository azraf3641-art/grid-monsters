// flow.test.js — game flow: Draft, Placement, Activations, Evolution, Win.
// INDEPENDENCE: every expected value below is derived from SPEC.md + CONTRACT.md
// only (engine.js never consulted). Spec citations live in test names/comments.
const { GM, DATA, assert, assertEq, assertThrows, mkBattle, play, act, endTurn, unit, at } = require('./helpers.js');

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

// Full legal draft, coinWinner = 0. Order per SPEC §1 / CONTRACT:
// [W, L] tyrant picks, then snake L W W L L W W L L W with W=0, L=1
// → players [0,1, 1,0,0,1, 1,0,0,1, 1,0].
const DRAFT_PICKS = [
  [0, 'cinderling'], [1, 'wyrmlet'],            // tyrant phase
  [1, 'sootpup'], [0, 'snapling'], [0, 'guppling'], [1, 'mosskit'],
  [1, 'podling'], [0, 'zapkitt'], [0, 'coilbug'], [1, 'gritling'],
  [1, 'cacklet'], [0, 'falchick'],              // snake L W W L L W W L L W
];
// Teams: P0 = cinderling, snapling, guppling, zapkitt, coilbug, falchick
//        P1 = wyrmlet, sootpup, mosskit, podling, gritling, cacklet
function draftedState() {
  let s = GM.createGame(123, 0);
  for (const [p, lineId] of DRAFT_PICKS) s = GM.applyAction(s, p, { t: 'pick', lineId });
  return s;
}

// 4 P0 base units spread on row 0 plus one far-away P1 unit; P0's turn.
function actBoard() {
  return mkBattle({ units: [
    { form: 'Zapkitt', owner: 0, x: 0, y: 0 },
    { form: 'Mosskit', owner: 0, x: 2, y: 0 },
    { form: 'Snapling', owner: 0, x: 4, y: 0 },
    { form: 'Gritling', owner: 0, x: 6, y: 0 },
    { form: 'Wyrmlet', owner: 1, x: 7, y: 7 },
  ] });
}

// ---------------------------------------------------------------------------
// DRAFT — SPEC §1
// ---------------------------------------------------------------------------

test('draft: order is [winner, loser] tyrant picks then snake L W W L L W W L L W (SPEC §1)', () => {
  const s1 = GM.createGame(7, 1);
  assertEq(s1.phase, 'draft');
  assertEq(s1.draft.pickIndex, 0);
  // winner=1, loser=0 → [1,0] + snake [0,1,1,0,0,1,1,0,0,1]
  assertEq(s1.draft.order, [1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1]);
  const s0 = GM.createGame(7, 0);
  // winner=0, loser=1 → [0,1] + snake [1,0,0,1,1,0,0,1,1,0]
  assertEq(s0.draft.order, [0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0]);
});

test('draft: tyrant phase — winner picks first, both picks must be tyrant lines, non-tyrant/duplicate/wrong-player throw (SPEC §1)', () => {
  let s = GM.createGame(1, 0);
  assertThrows(() => GM.applyAction(s, 1, { t: 'pick', lineId: 'wyrmlet' }), 'flip loser may not pick first');
  assertThrows(() => GM.applyAction(s, 0, { t: 'pick', lineId: 'sootpup' }), 'tyrant-phase pick must be a tyrant line');
  s = GM.applyAction(s, 0, { t: 'pick', lineId: 'cinderling' });
  assertEq(s.draft.cutTyrant, null, 'no cut until the 2nd tyrant pick');
  assertThrows(() => GM.applyAction(s, 1, { t: 'pick', lineId: 'cinderling' }), 'already-picked tyrant');
  assertThrows(() => GM.applyAction(s, 1, { t: 'pick', lineId: 'mosskit' }), 'loser tyrant pick must also be a tyrant line');
  s = GM.applyAction(s, 1, { t: 'pick', lineId: 'wyrmlet' });
  assertEq(s.draft.cutTyrant, 'frostfawn', 'remaining tyrant is cut after the 2nd tyrant pick');
});

test('draft: snake starts with the flip loser; cut tyrant and taken lines undraftable; out-of-turn picks throw (SPEC §1)', () => {
  let s = GM.createGame(1, 0);
  s = GM.applyAction(s, 0, { t: 'pick', lineId: 'cinderling' });
  s = GM.applyAction(s, 1, { t: 'pick', lineId: 'wyrmlet' });
  // pick 3 (first snake pick) belongs to the flip LOSER (player 1)
  assertThrows(() => GM.applyAction(s, 0, { t: 'pick', lineId: 'sootpup' }), 'winner may not open the snake');
  assertThrows(() => GM.applyAction(s, 1, { t: 'pick', lineId: 'frostfawn' }), 'cut tyrant is undraftable');
  assertThrows(() => GM.applyAction(s, 1, { t: 'pick', lineId: 'cinderling' }), 'tyrant already picked');
  s = GM.applyAction(s, 1, { t: 'pick', lineId: 'sootpup' });
  // pick 4 is the winner's (snake L W ...)
  assertThrows(() => GM.applyAction(s, 1, { t: 'pick', lineId: 'mosskit' }), 'loser may not pick twice in a row here');
  assertThrows(() => GM.applyAction(s, 0, { t: 'pick', lineId: 'sootpup' }), 'taken non-tyrant line');
  s = GM.applyAction(s, 0, { t: 'pick', lineId: 'snapling' });
  assertEq(s.draft.teams[0].length, 2);
  assert(s.draft.teams[0].includes('cinderling') && s.draft.teams[0].includes('snapling'), 'P0 team so far');
  assert(s.draft.teams[1].includes('wyrmlet') && s.draft.teams[1].includes('sootpup'), 'P1 team so far');
});

test('draft: after 12 picks — 6 lines each, exactly one tyrant per team, exactly 12 of 24 lines unused, phase placement (SPEC §1)', () => {
  const s = draftedState();
  assertEq(s.phase, 'placement');
  assertEq(s.draft.pickIndex, 12);
  const [t0, t1] = s.draft.teams;
  assertEq(t0.length, 6);
  assertEq(t1.length, 6);
  assertEq(t0.filter(id => DATA.tyrants.includes(id)).length, 1, 'P0 fields exactly one tyrant');
  assertEq(t1.filter(id => DATA.tyrants.includes(id)).length, 1, 'P1 fields exactly one tyrant');
  const picked = new Set([...t0, ...t1]);
  assertEq(picked.size, 12, 'no shared/duplicate lines');
  assertEq(DATA.lines.length - picked.size, 12, 'twelve of the twenty-four sit out');
  assertEq(s.draft.cutTyrant, 'frostfawn');
  assert(!picked.has(s.draft.cutTyrant), 'cut tyrant is among the unused');
  assertThrows(() => GM.applyAction(s, 0, { t: 'pick', lineId: 'tavrik' }), 'no 13th pick');
});

// ---------------------------------------------------------------------------
// PLACEMENT — SPEC §1 (P0 back rows y0-1, P1 y6-7 per CONTRACT coords)
// ---------------------------------------------------------------------------

test('placement: P0 places first; foreign rows, enemy rows, foreign lines, occupied squares and early P1 actions all throw (SPEC §1)', () => {
  let s = draftedState();
  assertThrows(() => GM.applyAction(s, 1, { t: 'place', lineId: 'wyrmlet', x: 0, y: 7 }), 'P1 cannot place before P0 confirms');
  assertThrows(() => GM.applyAction(s, 1, { t: 'confirm' }), 'P1 cannot confirm before P0');
  assertThrows(() => GM.applyAction(s, 0, { t: 'place', lineId: 'cinderling', x: 0, y: 2 }), 'y=2 is not a P0 back row');
  assertThrows(() => GM.applyAction(s, 0, { t: 'place', lineId: 'cinderling', x: 0, y: 7 }), 'enemy back row is foreign');
  assertThrows(() => GM.applyAction(s, 0, { t: 'place', lineId: 'wyrmlet', x: 0, y: 0 }), 'not P0\'s drafted line');
  s = GM.applyAction(s, 0, { t: 'place', lineId: 'cinderling', x: 0, y: 0 });
  assertThrows(() => GM.applyAction(s, 0, { t: 'place', lineId: 'snapling', x: 0, y: 0 }), 'occupied square');
});

test('placement: re-place moves the line, unplace vacates, confirm requires all 6, no placing after confirm (SPEC §1, CONTRACT)', () => {
  let s = draftedState();
  s = GM.applyAction(s, 0, { t: 'place', lineId: 'cinderling', x: 0, y: 0 });
  s = GM.applyAction(s, 0, { t: 'place', lineId: 'cinderling', x: 3, y: 1 }); // re-place = move
  assertEq(at(s, 0, 0), null, 're-placing vacates the old square');
  assert(at(s, 3, 1) && at(s, 3, 1).lineId === 'cinderling', 'line now on the new square');
  s = GM.applyAction(s, 0, { t: 'place', lineId: 'snapling', x: 0, y: 0 });
  s = GM.applyAction(s, 0, { t: 'place', lineId: 'guppling', x: 1, y: 0 });
  s = GM.applyAction(s, 0, { t: 'place', lineId: 'zapkitt', x: 2, y: 0 });
  s = GM.applyAction(s, 0, { t: 'place', lineId: 'coilbug', x: 3, y: 0 });
  s = GM.applyAction(s, 0, { t: 'place', lineId: 'falchick', x: 4, y: 0 });
  s = GM.applyAction(s, 0, { t: 'unplace', lineId: 'falchick' });
  assertEq(at(s, 4, 0), null, 'unplace vacates the square');
  assertThrows(() => GM.applyAction(s, 0, { t: 'confirm' }), 'confirm requires all 6 placed');
  s = GM.applyAction(s, 0, { t: 'place', lineId: 'falchick', x: 4, y: 0 });
  s = GM.applyAction(s, 0, { t: 'confirm' });
  assertEq(s.placement.confirmed[0], true);
  assertEq(s.placement.current, 1, 'P0 confirmed, now P1 places');
  assertThrows(() => GM.applyAction(s, 0, { t: 'place', lineId: 'falchick', x: 5, y: 0 }), 'no placing after own confirm');
  assertThrows(() => GM.applyAction(s, 0, { t: 'unplace', lineId: 'falchick' }), 'no unplacing after own confirm');
});

test('placement: both confirm → battle with 12 base-form units at base HP, P0\'s turn, playerTurns [1,0] (SPEC §1/§6)', () => {
  let s = draftedState();
  for (const [id, x, y] of [['cinderling', 0, 0], ['snapling', 1, 0], ['guppling', 2, 0], ['zapkitt', 3, 0], ['coilbug', 4, 1], ['falchick', 5, 1]])
    s = GM.applyAction(s, 0, { t: 'place', lineId: id, x, y });
  s = GM.applyAction(s, 0, { t: 'confirm' });
  assertThrows(() => GM.applyAction(s, 1, { t: 'place', lineId: 'wyrmlet', x: 0, y: 1 }), 'P1 cannot use P0 rows');
  for (const [id, x, y] of [['wyrmlet', 0, 7], ['sootpup', 1, 7], ['mosskit', 2, 7], ['podling', 3, 7], ['gritling', 4, 6], ['cacklet', 5, 6]])
    s = GM.applyAction(s, 1, { t: 'place', lineId: id, x, y });
  s = GM.applyAction(s, 1, { t: 'confirm' });
  assertEq(s.phase, 'battle');
  assertEq(s.turn.player, 0, 'P0 moves first');
  assertEq(s.playerTurns, [1, 0]);
  assertEq(s.units.filter(u => u.pos).length, 12);
  for (const u of s.units) {
    assertEq(u.stage, 0, `unit ${u.id} (${u.lineId}) enters at base form`);
    const line = DATA.lines.find(l => l.id === u.lineId);
    assertEq(u.hp, line.stages[0].hp, `unit ${u.id} (${u.lineId}) enters at base HP`);
  }
  // the two non-4 base HPs per SPEC §6: Guppling 3, Zapkitt 3
  assertEq(at(s, 2, 0).hp, 3, 'Guppling base HP 3');
  assertEq(at(s, 3, 0).hp, 3, 'Zapkitt base HP 3');
});

// ---------------------------------------------------------------------------
// ACTIVATIONS — SPEC §1 turn loop, DEV-PIN 16
// ---------------------------------------------------------------------------

test('activations: up to 3 DIFFERENT units; an empty activation (no move, no attack) still consumes one; the 4th throws (SPEC §1, DEV-PIN 16)', () => {
  let s = actBoard();
  s = act(s, 0, 0, {});
  assertEq(s.turn.activationsUsed, 1, 'empty activation consumed one of 3');
  s = act(s, 0, 1, {});
  s = act(s, 0, 2, {});
  assertEq(s.turn.activationsUsed, 3);
  assertThrows(() => GM.applyAction(s, 0, { t: 'activate', unitId: 3 }), '4th activation must throw');
  s = endTurn(s, 0);
  assertEq(s.turn.player, 1, 'endTurn after a full 3 is legal');
});

test('activations: re-activating the same unit in one turn throws; a different unit is fine (SPEC §1)', () => {
  let s = act(actBoard(), 0, 0, {});
  assertThrows(() => GM.applyAction(s, 0, { t: 'activate', unitId: 0 }), 'a unit cannot be activated twice in one turn');
  s = GM.applyAction(s, 0, { t: 'activate', unitId: 1 });
  assertEq(s.turn.activationsUsed, 2);
});

test('activations: endTurn legal with zero or fewer than 3 activations; turn passes, playerTurns increments (SPEC §1, CONTRACT turn pass)', () => {
  let s = endTurn(actBoard(), 0); // zero activations banked
  assertEq(s.turn.player, 1);
  assertEq(s.playerTurns, [1, 1], 'P1\'s first turn started');
  assertEq(s.turn.activationsUsed, 0, 'fresh counter for the new turn');
  let s2 = act(actBoard(), 0, 0, {}); // exactly one activation
  s2 = endTurn(s2, 0);
  assertEq(s2.turn.player, 1, 'one activation then endTurn is legal');
});

test('activations: per-unit order is move then attack — moving after attacking throws, second attack throws (SPEC §1)', () => {
  let s = mkBattle({ units: [
    { form: 'Zapkitt', owner: 0, x: 3, y: 3 },
    { form: 'Mosskit', owner: 1, x: 3, y: 4 },
    { form: 'Gritling', owner: 1, x: 7, y: 7 },
  ] });
  s = GM.applyAction(s, 0, { t: 'activate', unitId: 0 });
  s = GM.applyAction(s, 0, { t: 'attack', kind: 'basic', target: { x: 3, y: 4 } });
  assertEq(unit(s, 1).hp, 2, 'basic 2; Electric does not beat Grass (SPEC §7) so no ×2');
  assertThrows(() => GM.applyAction(s, 0, { t: 'move', path: [{ x: 2, y: 3 }] }), 'move after attack must throw');
  assertThrows(() => GM.applyAction(s, 0, { t: 'attack', kind: 'basic', target: { x: 3, y: 4 } }), 'at most one attack per activation');
});

test('activations: actions from the non-active player throw; activating an enemy unit throws (SPEC §1, CONTRACT)', () => {
  const s = actBoard(); // P0's turn; unit 4 belongs to P1
  assertThrows(() => GM.applyAction(s, 1, { t: 'activate', unitId: 4 }), 'not P1\'s turn');
  assertThrows(() => GM.applyAction(s, 1, { t: 'endTurn' }), 'non-active player cannot end the turn');
  assertThrows(() => GM.applyAction(s, 0, { t: 'activate', unitId: 4 }), 'cannot activate an enemy unit');
});

// ---------------------------------------------------------------------------
// EVOLUTION — SPEC §4, §3 attribution, DEV-PINs 8/9
// ---------------------------------------------------------------------------

test('evolution: "survived" counts own turns completed (increments at end of own turn); Snapling survived 2 → Shellbrook at start of next own turn (SPEC §4)', () => {
  let s = mkBattle({ units: [
    { form: 'Snapling', owner: 0, x: 0, y: 0, survived: 1 },
    { form: 'Mosskit', owner: 1, x: 7, y: 7 },
  ] });
  s = endTurn(s, 0);
  assertEq(unit(s, 0).survived, 2, 'survived ticks at end of OWN turn');
  assertEq(unit(s, 0).stage, 0, 'no evolution during the opponent\'s turn');
  s = endTurn(s, 1); // start of P0's next turn: step 1 evolution
  assertEq(unit(s, 0).stage, 1, 'survived 2 ≥ 2 → Shellbrook, and only ONE stage (survived 5 not met)');
  assertEq(unit(s, 0).hp, 5, '4 +2 refresh capped at new max 5');
});

test('evolution: damaged middle does not full-heal — Shellbrook 2hp survived 5 → Bulwhark at 4/8; new Special live immediately: Tidal Ram 3 ×2 (Water>Ground) KOs 4hp Gritling (SPEC §4 steps 1-3)', () => {
  let s = mkBattle({ turn: 1, units: [
    { form: 'Shellbrook', owner: 0, x: 3, y: 3, hp: 2, survived: 5 },
    { form: 'Gritling', owner: 1, x: 3, y: 5 },
    { form: 'Cacklet', owner: 1, x: 0, y: 7 },
  ] });
  s = endTurn(s, 1); // start of P0's turn → evolve
  assertEq(unit(s, 0).stage, 2, 'survived 5 ≥ 5 → Bulwhark');
  assertEq(unit(s, 0).hp, 4, '2 +2 = 4, capped refresh is NOT a full heal to 8');
  // Tidal Ram (Single 3, 3 dmg): first unit N within 3 is the enemy Gritling at (3,5); ×2 = 6 ≥ 4hp
  s = act(s, 0, 0, { attack: { kind: 'special', dir: { dx: 0, dy: 1 } } });
  assertEq(unit(s, 1).pos, null, 'new-stage Special usable the same turn');
  assertEq(unit(s, 0).dealt, 4, 'dealt = actual HP removed, capped at remaining 4 not 6 (DEV-PIN 8)');
});

test('evolution: "dealt" includes the ×2 but caps at HP removed — Cinderling basic 2 ×2 (Fire>Grass) vs 3hp Mosskit credits 3; dealt 3 → Flarewyrm next own turn start (SPEC §4, §7, DEV-PIN 8)', () => {
  let s = mkBattle({ units: [
    { form: 'Cinderling', owner: 0, x: 3, y: 3 },
    { form: 'Mosskit', owner: 1, x: 3, y: 4, hp: 3 },
    { form: 'Gritling', owner: 1, x: 7, y: 7 },
  ] });
  s = act(s, 0, 0, { attack: { kind: 'basic', target: { x: 3, y: 4 } } });
  assertEq(unit(s, 1).pos, null, '2 doubled to 4 KOs the 3hp Mosskit (undoubled 2 would not)');
  assertEq(unit(s, 0).dealt, 3, 'credit = actual HP removed (3), not overkill 4');
  assertEq(unit(s, 0).kos, 1);
  s = endTurn(s, 0);
  assertEq(unit(s, 0).stage, 0, 'still base during opponent\'s turn');
  s = endTurn(s, 1);
  assertEq(unit(s, 0).stage, 1, 'dealt 3 ≥ 3 → Flarewyrm at start of own turn');
  assertEq(unit(s, 0).hp, 5, '4 +2 capped at 5');
});

test('evolution credit: Magma Stream — 3 lance dmg credits attacker; Burn 2 tick at victim\'s turn start credits the burner (capped, KO credited); Recoil 2 credits no one (SPEC §3 attribution, DEV-PIN 8)', () => {
  let s = mkBattle({ units: [
    { form: 'Pyroclasm', owner: 0, x: 3, y: 3 },
    { form: 'Snapling', owner: 1, x: 3, y: 4 }, // Water 4hp — Fire does not double vs Water
    { form: 'Mosskit', owner: 1, x: 7, y: 7 },
  ] });
  s = act(s, 0, 0, { attack: { kind: 'special', dir: { dx: 0, dy: 1 } } });
  assertEq(unit(s, 1).hp, 1, 'lance 3, not super-effective');
  assert(unit(s, 1).burn && unit(s, 1).burn.n === 2 && unit(s, 1).burn.ticks === 2, 'Burn 2 with 2 ticks applied');
  assertEq(unit(s, 0).hp, 4, 'Recoil 2 off Pyroclasm\'s 6');
  assertEq(unit(s, 0).dealt, 3, 'attack damage credited to attacker');
  assertEq(unit(s, 1).dealt, 0, 'recoil damage credits no one');
  s = endTurn(s, 0); // P1 turn start step 2: burn tick 2 vs 1hp → 1 credited, KO
  assertEq(unit(s, 1).pos, null, 'burn tick KO at the victim\'s own turn start');
  assertEq(unit(s, 0).dealt, 4, 'burn tick credits the burner, capped at remaining HP (3+1)');
  assertEq(unit(s, 0).kos, 1, 'burn-tick KO credited to the burner');
});

test('evolution credit: aura damage credits no one — Local Storm deals 1 to adjacent friend AND foe at end of controller\'s turn, dealt stays 0 (SPEC §3 attribution, §5)', () => {
  let s = mkBattle({ units: [
    { form: 'Tempestdrake', owner: 0, x: 3, y: 3 },
    { form: 'Snapling', owner: 0, x: 2, y: 3 },
    { form: 'Mosskit', owner: 1, x: 4, y: 3 },
  ] });
  s = endTurn(s, 0, [{ unitId: 0 }]);
  assertEq(unit(s, 1).hp, 3, 'adjacent ALLY takes 1 (friendly aura fire)');
  assertEq(unit(s, 2).hp, 3, 'adjacent enemy takes 1');
  assertEq(unit(s, 0).hp, 8, 'Tempestdrake itself is not within 1 of itself');
  assertEq(unit(s, 0).dealt, 0, 'aura damage credits no one');
  assertEq(s.turn.player, 1, 'turn passed after the aura subphase');
});

test('evolution: KO condition — Sootpup KOs an enemy → Hellhowl next own turn start at 4+2=6 of 7 (capped, no full heal); new Speed 5 live immediately (SPEC §4, §6 line 2)', () => {
  let s = mkBattle({ units: [
    { form: 'Sootpup', owner: 0, x: 3, y: 3 },
    { form: 'Zapkitt', owner: 1, x: 3, y: 4, hp: 2 },
    { form: 'Mosskit', owner: 1, x: 7, y: 7 },
  ] });
  s = act(s, 0, 0, { attack: { kind: 'basic', target: { x: 3, y: 4 } } }); // 2 dmg KO
  assertEq(unit(s, 0).kos, 1);
  s = endTurn(s, 0);
  s = endTurn(s, 1);
  assertEq(unit(s, 0).stage, 1, 'KO condition → Hellhowl');
  assertEq(unit(s, 0).hp, 6, '4 +2 = 6, NOT max 7');
  // Hellhowl Speed 5 (base Sootpup was 2): a 5-step move is legal right now
  s = act(s, 0, 0, { path: [{ x: 3, y: 4 }, { x: 3, y: 5 }, { x: 3, y: 6 }, { x: 3, y: 7 }, { x: 2, y: 7 }] });
  assertEq(unit(s, 0).pos, { x: 2, y: 7 }, 'new Speed live the same turn');
});

test('evolution: allyKo condition — Cacklet sees an allied KO and becomes Ossiyena at the start of its controller\'s next turn, hp 4+2=6 (SPEC §4)', () => {
  let s = mkBattle({ units: [
    { form: 'Zapkitt', owner: 0, x: 3, y: 3 },
    { form: 'Shadekit', owner: 1, x: 3, y: 4, hp: 2 },
    { form: 'Cacklet', owner: 1, x: 7, y: 7 },
  ] });
  s = act(s, 0, 0, { attack: { kind: 'basic', target: { x: 3, y: 4 } } }); // 2 dmg KO (Electric≠>Dark)
  assertEq(unit(s, 1).pos, null);
  assertEq(unit(s, 2).allyKoSeen, true, 'ally KO recorded while Cacklet in play');
  s = endTurn(s, 0); // start of P1's turn: Cacklet evolves
  assertEq(unit(s, 2).stage, 1, 'allyKo → Ossiyena');
  assertEq(unit(s, 2).hp, 6, '4 +2 capped at Ossiyena max 6');
});

test('evolution: multi-stage lines evolve one stage per condition, repeating while met — Cinderling dealt 7 → Flarewyrm → Pyroclasm in one turn start, hp min(4+2,5)=5 then min(5+2,6)=6 (DEV-PIN 9)', () => {
  let s = mkBattle({ turn: 1, units: [
    { form: 'Cinderling', owner: 0, x: 0, y: 0, dealt: 7 },
    { form: 'Mosskit', owner: 1, x: 7, y: 7 },
  ] });
  s = endTurn(s, 1); // start of P0's turn: dealt 7 satisfies both thresholds (3, then 7)
  assertEq(unit(s, 0).stage, 2, 'both stages, one at a time');
  assertEq(unit(s, 0).hp, 6, 'two capped +2 refreshes: 4→5→6');
});

test('evolution: Tavrik never evolves regardless of counters (SPEC §6 line 13: single stage, no evolution tracking)', () => {
  let s = mkBattle({ turn: 1, units: [
    { form: 'Tavrik', owner: 0, x: 0, y: 0, survived: 9, dealt: 9, kos: 3, allyKoSeen: true },
    { form: 'Mosskit', owner: 1, x: 7, y: 7 },
  ] });
  s = endTurn(s, 1);
  assertEq(unit(s, 0).stage, 0, 'still Tavrik');
  assertEq(unit(s, 0).hp, 5);
});

test('evolution: Pin and Burn markers persist through evolution — evolve first, then burn ticks 2; pin still blocks move but not attack (SPEC §4; §1 start-of-turn order 1-then-2)', () => {
  // P1's turn (playerTurns [1,1]); pinnedTurn 2 = playerTurns[0]+1 → pinned during P0's upcoming turn
  let s = mkBattle({ turn: 1, units: [
    { form: 'Snapling', owner: 0, x: 0, y: 0, survived: 2, burn: { n: 2, ticks: 2 }, pinnedTurn: 2 },
    { form: 'Mosskit', owner: 1, x: 1, y: 0 },
  ] });
  s = endTurn(s, 1); // P0 turn start: (1) evolve 4→min(4+2,5)=5, then (2) burn tick −2 → 3
  const u = unit(s, 0);
  assertEq(u.stage, 1, 'evolved to Shellbrook');
  assertEq(u.hp, 3, 'refreshed to 5 BEFORE the 2-dmg burn tick (start-of-turn step order)');
  assert(u.burn && u.burn.n === 2 && u.burn.ticks === 1, 'burn survives evolution, one tick spent');
  assertEq(u.pinnedTurn, 2, 'pin survives evolution');
  let s2 = GM.applyAction(s, 0, { t: 'activate', unitId: 0 });
  assertThrows(() => GM.applyAction(s2, 0, { t: 'move', path: [{ x: 0, y: 1 }] }), 'pinned unit cannot move on its controller\'s turn');
  s2 = GM.applyAction(s2, 0, { t: 'attack', kind: 'basic', target: { x: 1, y: 0 } });
  assertEq(unit(s2, 1).hp, 2, 'pinned unit may still attack: basic 2 (Water≠>Grass, no ×2)');
});

// ---------------------------------------------------------------------------
// WIN — SPEC §1 Winning, DEV-PIN 15
// ---------------------------------------------------------------------------

test('win: immediate on last enemy KO via an attack — winner set mid-activation, battle actions thereafter throw (SPEC §1 Winning)', () => {
  let s = mkBattle({ units: [
    { form: 'Zapkitt', owner: 0, x: 3, y: 3 },
    { form: 'Mosskit', owner: 1, x: 3, y: 4, hp: 2 }, // P1's last unit
  ] });
  s = GM.applyAction(s, 0, { t: 'activate', unitId: 0 });
  s = GM.applyAction(s, 0, { t: 'attack', kind: 'basic', target: { x: 3, y: 4 } });
  assertEq(s.winner, 0, 'win the instant the last enemy drops');
  assertEq(s.phase, 'over');
  assertThrows(() => GM.applyAction(s, 0, { t: 'endTurn' }), 'no battle actions once over');
});

test('win: burn tick KOs the last enemy at its own turn start → burner\'s side wins immediately (SPEC §1, §3 Burn timing)', () => {
  let s = mkBattle({ units: [
    { form: 'Zapkitt', owner: 0, x: 0, y: 0 },
    { form: 'Mosskit', owner: 1, x: 7, y: 7, hp: 2, burn: { n: 2, ticks: 2 } }, // P1's last unit
  ] });
  s = endTurn(s, 0); // P1 turn start step 2: 2 burn ≥ 2hp → KO
  assertEq(unit(s, 1).pos, null);
  assertEq(s.winner, 0);
  assertEq(s.phase, 'over');
});

test('win: aura KO counts — Local Storm KOs the 1hp last enemy at end of turn → immediate win (SPEC §5: check win after each aura resolution)', () => {
  let s = mkBattle({ units: [
    { form: 'Tempestdrake', owner: 0, x: 3, y: 3 },
    { form: 'Mosskit', owner: 1, x: 3, y: 4, hp: 1 }, // P1's last unit
  ] });
  s = endTurn(s, 0, [{ unitId: 0 }]);
  assertEq(unit(s, 1).pos, null);
  assertEq(s.winner, 0);
  assertEq(s.phase, 'over');
});

test('win simultaneity: one resolution wipes BOTH sides — Magma Stream 3 KOs the 3hp last defender while Recoil 2 KOs the 2hp last attacker → resolving player (attacker) wins (SPEC §1, DEV-PIN 15)', () => {
  let s = mkBattle({ units: [
    { form: 'Pyroclasm', owner: 0, x: 3, y: 3, hp: 2 }, // P0's last unit, dies to own recoil
    { form: 'Snapling', owner: 1, x: 3, y: 4, hp: 3 },  // P1's last unit, dies to the lance
  ] });
  s = GM.applyAction(s, 0, { t: 'activate', unitId: 0 });
  s = GM.applyAction(s, 0, { t: 'attack', kind: 'special', dir: { dx: 0, dy: 1 } });
  assertEq(s.winner, 0, 'attacker wins the mutual wipe');
  assertEq(s.phase, 'over');
});

test('win: recoil self-KO while the defender survives is a loss — Pyroclasm 2hp recoils out, Bulwhark lives at 8−3=5 → winner 1 (SPEC §3 Recoil can KO the attacker)', () => {
  let s = mkBattle({ units: [
    { form: 'Pyroclasm', owner: 0, x: 3, y: 3, hp: 2 }, // P0's last unit
    { form: 'Bulwhark', owner: 1, x: 3, y: 4 },         // 8hp, survives the lance
  ] });
  s = GM.applyAction(s, 0, { t: 'activate', unitId: 0 });
  s = GM.applyAction(s, 0, { t: 'attack', kind: 'special', dir: { dx: 0, dy: 1 } });
  assertEq(unit(s, 1).hp, 5, 'lance 3, no ×2 (Fire does not beat Water)');
  assertEq(unit(s, 0).pos, null, 'recoil KOs the attacker');
  assertEq(s.winner, 1, 'side with units remaining wins — not simultaneity');
  assertEq(s.phase, 'over');
});

module.exports = tests;
