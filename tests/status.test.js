// tests/status.test.js — SPEC §3 status effects & riders (Push, Pin, Burn, Poison,
// Chill/Hard Freeze, Hex, Lure, Recoil, Lunge, Blink).
//
// INDEPENDENCE: every expected value below is derived from SPEC.md + CONTRACT.md +
// PATCH-V8.md (max HP per stage recomputed from data.js, which PATCH-V8 §3 makes
// authoritative; no damage numbers changed in v8). engine.js was NOT consulted.
// Damage math and spec citations live in test names/comments.
//
// Pin/burn state notes (CONTRACT "State shape", normative):
//   pinnedTurn = playerTurns[victim.owner] + 1 at application; blocked while
//   playerTurns[owner] === pinnedTurn; cleared to 0 at end of that owner turn.
//   burn = { n, ticks } (ticks start at 2). Tests assert burn.n / burn.ticks
//   individually (the engine may track the applier separately for attribution).
const { GM, DATA, assert, assertEq, assertThrows, mkBattle, play, act, endTurn, unit, at } =
  require('./helpers.js');

function assertPos(u, x, y, msg) {
  assert(u.pos && u.pos.x === x && u.pos.y === y,
    `${msg || 'position'}: expected (${x},${y}), got ${JSON.stringify(u.pos)}`);
}

const T = [];
function test(name, fn) { T.push({ name, fn }); }

// ---------------------------------------------------------------- Push 1

test('Push 1: Tidal Ram shoves victim 1 directly away orthogonally (SPEC §3; 3 dmg Water vs Grass no SE, 5-3=2)', () => {
  let s = mkBattle({ units: [
    { form: 'Bulwhark', owner: 0, x: 3, y: 3 },   // Tidal Ram: Single 3, 3 dmg, Push 1, Lunge
    { form: 'Mosskit', owner: 1, x: 3, y: 5 },    // Grass, 5 hp (PATCH-V8 §3)
  ] });
  s = act(s, 0, 0, { attack: { kind: 'special', dir: { dx: 0, dy: 1 } } }); // lunge omitted (optional)
  assertEq(unit(s, 1).hp, 2, 'Tidal Ram 3 dmg, no doubling: 5-3=2');
  assertPos(unit(s, 1), 3, 6, 'pushed from (3,5) to (3,6), directly away');
  assertPos(unit(s, 0), 3, 3, 'attacker stayed (lunge declined)');
});

test('Push 1: Burst (Maelstrom) pushes each hit enemy directly away, including diagonally (DEV-PIN 14 sign vector)', () => {
  let s = mkBattle({ units: [
    { form: 'Leviadon', owner: 0, x: 3, y: 3 },   // Maelstrom: Burst, 3 dmg, Push 1
    { form: 'Mosskit', owner: 1, x: 4, y: 4 },    // diagonal neighbor
    { form: 'Hootle', owner: 1, x: 3, y: 4 },     // orthogonal neighbor; Psychic/Grass: no SE for Water -> no focus
  ] });
  s = act(s, 0, 0, { attack: { kind: 'special' } });
  assertEq(unit(s, 1).hp, 2, 'Maelstrom 3 dmg: 5-3=2');
  assertEq(unit(s, 2).hp, 2, 'Maelstrom 3 dmg: 5-3=2');
  assertPos(unit(s, 1), 5, 5, 'diagonal push (4,4) -> (5,5), sign vector (+1,+1)');
  assertPos(unit(s, 2), 3, 5, 'orthogonal push (3,4) -> (3,5)');
});

test('Push 1 CANCELLED when destination square is occupied (SPEC §3 Push)', () => {
  let s = mkBattle({ units: [
    { form: 'Leviadon', owner: 0, x: 3, y: 3 },
    { form: 'Mosskit', owner: 1, x: 4, y: 4 },    // push destination (5,5)...
    { form: 'Bulwhark', owner: 1, x: 5, y: 5 },   // ...occupied (Chebyshev 2 from attacker: not hit by Burst)
  ] });
  s = act(s, 0, 0, { attack: { kind: 'special' } });
  assertEq(unit(s, 1).hp, 2, 'damage still applies: 5-3=2');
  assertPos(unit(s, 1), 4, 4, 'push cancelled entirely, victim stays');
  assertEq(unit(s, 2).hp, 14, 'blocker outside Burst untouched (Bulwhark max 14)');
});

test('Push 1 CANCELLED when destination is off-board (SPEC §3 Push)', () => {
  let s = mkBattle({ units: [
    { form: 'Leviadon', owner: 0, x: 6, y: 6 },
    { form: 'Mosskit', owner: 1, x: 7, y: 7 },    // push to (8,8) = off-board
  ] });
  s = act(s, 0, 0, { attack: { kind: 'special' } });
  assertEq(unit(s, 1).hp, 2, 'damage still applies: 5-3=2');
  assertPos(unit(s, 1), 7, 7, 'off-board push cancelled, victim stays');
});

// ---------------------------------------------------------------- Pin

test('Pin (Stormbolt): victim cannot move on its controller\'s next turn, CAN attack, clears at that turn\'s end (SPEC §3 Pin)', () => {
  let s = mkBattle({ units: [
    { form: 'Fulgurlynx', owner: 0, x: 4, y: 3 },  // Stormbolt: Single 3, 4 dmg, Pin
    { form: 'Grovewarden', owner: 1, x: 4, y: 4 }, // Grass 14hp; Electric beats Water/Flying only -> no SE
  ] });
  s = act(s, 0, 0, { attack: { kind: 'special', dir: { dx: 0, dy: 1 } } });
  assertEq(unit(s, 1).hp, 10, 'Stormbolt 4 dmg, no doubling: 14-4=10');
  // pinnedTurn = playerTurns[1] + 1 = 0 + 1 = 1 (CONTRACT pin timing model)
  assertEq(unit(s, 1).pinnedTurn, 1, 'pin set for victim-owner turn 1');
  s = endTurn(s, 0);
  s = GM.applyAction(s, 1, { t: 'activate', unitId: 1 });
  assertThrows(() => GM.applyAction(s, 1, { t: 'move', path: [{ x: 4, y: 5 }] }),
    'pinned unit moving must be rejected');
  s = GM.applyAction(s, 1, { t: 'attack', kind: 'basic', target: { x: 4, y: 3 } }); // Basic 2, Grass vs Electric no SE
  assertEq(unit(s, 0).hp, 7, 'pinned unit can still attack: 9-2=7');
  s = GM.applyAction(s, 1, { t: 'endActivation' });
  s = endTurn(s, 1);
  assertEq(unit(s, 1).pinnedTurn, 0, 'pin cleared at end of the pinned turn');
  s = endTurn(s, 0);
  s = act(s, 1, 1, { path: [{ x: 4, y: 5 }] });
  assertPos(unit(s, 1), 4, 5, 'victim moves freely on its following turn');
});

test('Pin clears at end of victim\'s turn whether or not the unit was activated (SPEC §3 Pin)', () => {
  // Turn 1 = player 1's turn; playerTurns [1,1]; pinnedTurn 1 = pinned RIGHT NOW for owner 1.
  let s = mkBattle({ turn: 1, units: [
    { form: 'Tavrik', owner: 0, x: 0, y: 0 },
    { form: 'Bulwhark', owner: 1, x: 2, y: 2, pinnedTurn: 1 },     // activated this turn
    { form: 'Grovewarden', owner: 1, x: 5, y: 5, pinnedTurn: 1 },  // never activated
  ] });
  s = GM.applyAction(s, 1, { t: 'activate', unitId: 1 });
  assertThrows(() => GM.applyAction(s, 1, { t: 'move', path: [{ x: 2, y: 3 }] }),
    'pinned-now unit must not move');
  s = GM.applyAction(s, 1, { t: 'endActivation' });
  s = endTurn(s, 1);
  assertEq(unit(s, 1).pinnedTurn, 0, 'activated pinned unit: pin cleared');
  assertEq(unit(s, 2).pinnedTurn, 0, 'never-activated pinned unit: pin cleared too');
});

test('Seed Mortar pins ONLY the center-square unit; plus-shape neighbors take damage unpinned (SPEC §3 Seed Mortar exception)', () => {
  let s = mkBattle({ units: [
    { form: 'Bombloom', owner: 0, x: 4, y: 2 },    // Seed Mortar: Bomb 2, 2 dmg, Pin center only; Grass
    { form: 'Grovewarden', owner: 1, x: 4, y: 4 }, // center square; Grass vs Grass no SE -> 2 dmg
    { form: 'Bulwhark', owner: 1, x: 3, y: 4 },    // plus arm; Water: Grass beats Water, sole eligible -> auto-focus x2 = 4
  ] });
  s = act(s, 0, 0, { attack: { kind: 'special', target: { x: 4, y: 4 } } });
  assertEq(unit(s, 1).hp, 12, 'center unit: 14-2=12');
  assertEq(unit(s, 2).hp, 10, 'arm unit super-effective focus: 14-(2*2)=10');
  assertEq(unit(s, 1).pinnedTurn, 1, 'center unit pinned (playerTurns[1]+1 = 1)');
  assertEq(unit(s, 2).pinnedTurn, 0, 'non-center hit unit NOT pinned');
});

// ---------------------------------------------------------------- Burn

test('Burn 2 (Magma Stream): 2 dmg at start of each of victim\'s next 2 turns even if never activated; ticks credit the burner (SPEC §3 Burn + attribution)', () => {
  let s = mkBattle({ units: [
    { form: 'Pyroclasm', owner: 0, x: 4, y: 3 },  // Magma Stream: Lance 3, 3 dmg, Burn 2, Recoil 2; Fire
    { form: 'Bulwhark', owner: 1, x: 4, y: 4 },   // Water 14hp; Fire vs Water no SE
  ] });
  s = act(s, 0, 0, { attack: { kind: 'special', dir: { dx: 0, dy: 1 } } });
  assertEq(unit(s, 1).hp, 11, 'attack: 14-3=11');
  assertEq(unit(s, 1).burn.n, 2, 'Burn 2 applied');
  assertEq(unit(s, 1).burn.ticks, 2, 'tick counter starts at 2');
  assertEq(unit(s, 0).hp, 7, 'Recoil 2: 9-2=7');
  assertEq(unit(s, 0).dealt, 3, 'attack damage credited');
  s = endTurn(s, 0); // victim's turn 1 starts; victim is NEVER activated in this test
  assertEq(unit(s, 1).hp, 9, 'first tick at victim turn start (step 2): 11-2=9');
  assertEq(unit(s, 1).burn.ticks, 1, 'one tick remaining');
  assertEq(unit(s, 0).dealt, 5, 'burn tick credits the burner: 3+2=5');
  s = endTurn(s, 1);
  s = endTurn(s, 0); // victim's turn 2 starts
  assertEq(unit(s, 1).hp, 7, 'second tick: 9-2=7');
  assertEq(unit(s, 1).burn, null, 'burn removed after 2nd tick');
  assertEq(unit(s, 0).dealt, 7, 'burner credited 3+2+2=7');
  s = endTurn(s, 1);
  s = endTurn(s, 0); // victim's turn 3 starts
  assertEq(unit(s, 1).hp, 7, 'no third tick');
});

test('Burn-tick KO credits the unit that applied the Burn (SPEC §3 damage attribution)', () => {
  let s = mkBattle({ units: [
    { form: 'Pyroclasm', owner: 0, x: 4, y: 3 },
    { form: 'Bulwhark', owner: 1, x: 4, y: 4, hp: 5 },  // 5-3=2 after attack; first tick 2 -> 0 KO
    { form: 'Grovewarden', owner: 1, x: 0, y: 7 },      // bystander so the game doesn't end
  ] });
  s = act(s, 0, 0, { attack: { kind: 'special', dir: { dx: 0, dy: 1 } } });
  assertEq(unit(s, 1).hp, 2, '5-3=2');
  s = endTurn(s, 0); // victim turn start: tick 2 -> KO
  assertEq(unit(s, 1).pos, null, 'victim KO\'d by burn tick at its own turn start');
  assertEq(unit(s, 0).kos, 1, 'burn-tick KO credited to Pyroclasm');
  assertEq(unit(s, 0).dealt, 5, 'dealt = 3 attack + 2 tick (DEV-PIN 8: actual HP removed)');
});

test('Burn never stacks: reapplying Burn 1 over an existing Burn 2 resets ticks to 2 and keeps the HIGHER per-tick value (SPEC §3 Burn)', () => {
  let s = mkBattle({ units: [
    { form: 'Hellhowl', owner: 0, x: 4, y: 3 },                              // Scorching Howl: Cone 3, Push 1, Burn 1 near-only
    { form: 'Bulwhark', owner: 1, x: 4, y: 4, burn: { n: 2, ticks: 1 } },    // existing Burn 2 with 1 tick left
  ] });
  // Cone N from (4,3): near square (4,4) = victim -> burn applies; Fire vs Water no SE -> 3 dmg.
  s = act(s, 0, 0, { attack: { kind: 'special', dir: { dx: 0, dy: 1 } } });
  assertEq(unit(s, 1).hp, 11, '14-3=11');
  assertPos(unit(s, 1), 4, 5, 'pushed (4,4) -> (4,5)');
  assertEq(unit(s, 1).burn.n, 2, 'higher N kept (2 over incoming 1)');
  assertEq(unit(s, 1).burn.ticks, 2, 'ticks reset to 2');
});

test('Burn reapply: Magma Stream\'s Burn 2 over an existing Burn 1 upgrades per-tick to 2 and resets ticks (SPEC §3 Burn)', () => {
  let s = mkBattle({ units: [
    { form: 'Pyroclasm', owner: 0, x: 4, y: 3 },
    { form: 'Bulwhark', owner: 1, x: 4, y: 4, burn: { n: 1, ticks: 1 } },
  ] });
  s = act(s, 0, 0, { attack: { kind: 'special', dir: { dx: 0, dy: 1 } } });
  assertEq(unit(s, 1).burn.n, 2, 'higher incoming N wins');
  assertEq(unit(s, 1).burn.ticks, 2, 'ticks reset to 2');
});

// ------------------------------------------------ Scorching Howl near-square burn

test('Scorching Howl: Burn 1 lands ONLY on the enemy occupying the cone\'s near square; far-row enemies get damage+push but no burn (SPEC §3/§6)', () => {
  let s = mkBattle({ units: [
    { form: 'Hellhowl', owner: 0, x: 4, y: 2 },     // Cone N: near (4,3); far row (3,4),(4,4),(5,4)
    { form: 'Bulwhark', owner: 1, x: 4, y: 3 },     // near square; Water: 3 dmg
    { form: 'Grovewarden', owner: 1, x: 3, y: 4 },  // far row; Grass: Fire SE sole eligible -> auto-focus 3*2=6
  ] });
  s = act(s, 0, 0, { attack: { kind: 'special', dir: { dx: 0, dy: 1 } } });
  assertEq(unit(s, 1).hp, 11, 'near: 14-3=11');
  assertEq(unit(s, 2).hp, 8, 'far, super-effective focus: 14-6=8');
  assertEq(unit(s, 1).burn.n, 1, 'near-square enemy burned (Burn 1)');
  assertEq(unit(s, 1).burn.ticks, 2, 'fresh burn: 2 ticks');
  assertEq(unit(s, 2).burn, null, 'far-row enemy NOT burned');
  assertPos(unit(s, 1), 4, 4, 'near victim pushed (4,3) -> (4,4)');
  assertPos(unit(s, 2), 2, 5, 'far victim pushed away on sign vector (-1,+1): (3,4) -> (2,5)');
});

test('Scorching Howl: EMPTY near square = zero burn even with an enemy in the far row; damage and push still apply (SPEC §3)', () => {
  let s = mkBattle({ units: [
    { form: 'Hellhowl', owner: 0, x: 4, y: 2 },     // near (4,3) empty
    { form: 'Bulwhark', owner: 1, x: 4, y: 4 },     // far row
  ] });
  s = act(s, 0, 0, { attack: { kind: 'special', dir: { dx: 0, dy: 1 } } });
  assertEq(unit(s, 1).hp, 11, '14-3=11');
  assertPos(unit(s, 1), 4, 5, 'pushed (4,4) -> (4,5)');
  assertEq(unit(s, 1).burn, null, 'no burn: near square was empty');
});

test('Scorching Howl: ALLY on the near square = no burn anywhere; ally unaffected (friendly fire off); far enemy still hit (SPEC §3)', () => {
  let s = mkBattle({ units: [
    { form: 'Hellhowl', owner: 0, x: 4, y: 2 },
    { form: 'Mosskit', owner: 0, x: 4, y: 3 },      // ally on near square
    { form: 'Bulwhark', owner: 1, x: 4, y: 4 },     // enemy in far row (satisfies DEV-PIN 1)
  ] });
  s = act(s, 0, 0, { attack: { kind: 'special', dir: { dx: 0, dy: 1 } } });
  assertEq(unit(s, 1).hp, 5, 'ally takes no damage (Mosskit max 5)');
  assertPos(unit(s, 1), 4, 3, 'ally not pushed');
  assertEq(unit(s, 1).burn, null, 'ally not burned');
  assertEq(unit(s, 2).hp, 11, 'far enemy: 14-3=11');
  assertEq(unit(s, 2).burn, null, 'no burn: near square held an ally');
});

// ---------------------------------------------------------------- Poison

test('Poison deals NO damage of its own: Marrow Hurl = 1 attack dmg + 1 stack only (SPEC §3 Poison)', () => {
  let s = mkBattle({ units: [
    { form: 'Ossiyena', owner: 0, x: 4, y: 3 },   // Marrow Hurl: Lance 2, 1 dmg, Poison; Ground vs Water no SE
    { form: 'Bulwhark', owner: 1, x: 4, y: 4 },
  ] });
  s = act(s, 0, 0, { attack: { kind: 'special', dir: { dx: 0, dy: 1 } } });
  assertEq(unit(s, 1).hp, 13, 'exactly the 1 attack damage: 14-1=13 (poison adds none)');
  assertEq(unit(s, 1).poison, 1, 'one stack applied');
});

test('3rd poison stack = instant KO regardless of HP; stacks shared across appliers; KO credits the 3rd-stack applier (SPEC §3 Poison)', () => {
  // Victim already has 2 stacks (e.g. from Ossiyena); Servenom's first bite supplies the 3rd.
  let s = mkBattle({ units: [
    { form: 'Servenom', owner: 0, x: 4, y: 3 },                 // Venom Fang: Single 1, 2 dmg, Poison; Water vs Water no SE
    { form: 'Bulwhark', owner: 1, x: 4, y: 4, poison: 2 },      // FULL 14 hp
    { form: 'Grovewarden', owner: 1, x: 0, y: 7 },              // bystander so the game doesn't end
  ] });
  s = act(s, 0, 0, { attack: { kind: 'special', dir: { dx: 0, dy: 1 } } });
  assertEq(unit(s, 1).pos, null, 'executed at 12 remaining hp by the 3rd stack');
  assertEq(unit(s, 0).kos, 1, 'KO credited to Servenom (the 3rd-stack applier)');
  assertEq(unit(s, 0).dealt, 2, 'only the 2 attack dmg counts as dealt (DEV-PIN 8: poison credits no damage)');
  assertEq(s.winner, null, 'game continues');
});

test('Poison stacks never expire across turns (SPEC §3 Poison)', () => {
  let s = mkBattle({ units: [
    { form: 'Tavrik', owner: 0, x: 0, y: 0 },
    { form: 'Bulwhark', owner: 1, x: 4, y: 4, poison: 2 },
  ] });
  s = endTurn(s, 0);
  s = endTurn(s, 1);
  s = endTurn(s, 0); // a full round plus another opponent turn
  assertEq(unit(s, 1).poison, 2, 'stacks persist untouched');
});

// ---------------------------------------------------------------- Chill / Hard Freeze

test('Chill: each stack is -2 Speed on the victim\'s next turn (Floefang 4-2=2); stacks clear at that turn\'s end (SPEC §3 Chill)', () => {
  let s = mkBattle({ turn: 1, units: [
    { form: 'Tavrik', owner: 0, x: 0, y: 0 },
    { form: 'Floefang', owner: 1, x: 4, y: 4, chill: 1 },  // its turn NOW; speed 4 -> 2
  ] });
  assertEq(GM.effectiveSpeed(s, 1), 2, 'one stack: 4-2=2');
  assert(!GM.isFrozen(s, 1), 'speed 2 > 0: not frozen');
  s = GM.applyAction(s, 1, { t: 'activate', unitId: 1 });
  assertThrows(() => GM.applyAction(s, 1, {
    t: 'move', path: [{ x: 4, y: 5 }, { x: 4, y: 6 }, { x: 4, y: 7 }],
  }), '3-step move exceeds chilled speed 2');
  s = GM.applyAction(s, 1, { t: 'move', path: [{ x: 4, y: 5 }, { x: 4, y: 6 }] });
  assertPos(unit(s, 1), 4, 6, '2-step move legal');
  s = GM.applyAction(s, 1, { t: 'endActivation' });
  s = endTurn(s, 1);
  assertEq(unit(s, 1).chill, 0, 'chill cleared at end of victim\'s turn');
  assertEq(GM.effectiveSpeed(s, 1), 4, 'speed restored');
});

test('Hard Freeze: a single stack zeroes a Speed-2 base (2-2=0) — no move, no attack; clears at turn end (SPEC §3 Chill)', () => {
  let s = mkBattle({ turn: 1, units: [
    { form: 'Tavrik', owner: 0, x: 4, y: 3 },
    { form: 'Mosskit', owner: 1, x: 4, y: 4, chill: 1 },   // speed 2 - 2 = 0 -> Hard Frozen
  ] });
  assert(GM.isFrozen(s, 1), 'speed-2 base Hard Freezes from ONE stack');
  s = GM.applyAction(s, 1, { t: 'activate', unitId: 1 }); // activation itself allowed (DEV-PIN 16)
  assertThrows(() => GM.applyAction(s, 1, { t: 'move', path: [{ x: 4, y: 5 }] }),
    'Hard Frozen unit cannot move');
  assertThrows(() => GM.applyAction(s, 1, { t: 'attack', kind: 'basic', target: { x: 4, y: 3 } }),
    'Hard Frozen unit cannot attack');
  s = GM.applyAction(s, 1, { t: 'endActivation' });
  s = endTurn(s, 1);
  assertEq(unit(s, 1).chill, 0, 'stacks cleared');
  assert(!GM.isFrozen(s, 1), 'freeze over at end of that turn');
});

test('Hard Frozen takes x2 from Fire attacks during the WHOLE frozen window, before its own turn (DEV-PIN 3): Fire basic 2*2=4', () => {
  // Bulwhark speed 3 with 2 stacks: 3-4 <= 0 -> frozen the moment the stacks would zero it.
  let s = mkBattle({ units: [
    { form: 'Tavrik', owner: 0, x: 4, y: 3 },                 // Fire, Basic 2; Fire vs Water no SE
    { form: 'Bulwhark', owner: 1, x: 4, y: 4, chill: 2 },
  ] });
  assert(GM.isFrozen(s, 1), 'frozen mid-window before its own turn');
  s = act(s, 0, 0, { attack: { kind: 'basic', target: { x: 4, y: 4 } } });
  assertEq(unit(s, 1).hp, 10, 'frozen-Fire doubling: 14-(2*2)=10');
});

test('Hard Frozen takes NORMAL damage from non-Fire attacks (SPEC §3 Chill: the x2 is Fire-only)', () => {
  let s = mkBattle({ units: [
    { form: 'Snapling', owner: 0, x: 4, y: 3 },               // Water, Basic 2; Water vs Water no SE
    { form: 'Bulwhark', owner: 1, x: 4, y: 4, chill: 2 },     // frozen
  ] });
  s = act(s, 0, 0, { attack: { kind: 'basic', target: { x: 4, y: 4 } } });
  assertEq(unit(s, 1).hp, 12, 'no doubling for non-Fire: 14-2=12');
});

test('Global x2 cap: Fire attack on a Hard Frozen GRASS unit (super-effective + frozen-Fire) is still x2, never x4: 14-4=10 (SPEC §3 cap)', () => {
  let s = mkBattle({ units: [
    { form: 'Tavrik', owner: 0, x: 4, y: 3 },                   // Fire Basic 2; Fire beats Grass
    { form: 'Grovewarden', owner: 1, x: 4, y: 4, chill: 2 },    // speed 3 - 4 <= 0 -> frozen
  ] });
  assert(GM.isFrozen(s, 1), 'frozen');
  s = act(s, 0, 0, { attack: { kind: 'basic', target: { x: 4, y: 4 } } });
  assertEq(unit(s, 1).hp, 10, 'capped at one doubling: 14-(2*2)=10, not 14-(2*4)=6');
});

// ---------------------------------------------------------------- Hex

test('Hex: +1 damage on attacks; window = until end of victim\'s 2nd own turn (DEV-PIN 2), spanning opponent turns; then expires', () => {
  let s = mkBattle({ units: [
    { form: 'Tavrik', owner: 0, x: 4, y: 3 },                  // Fire Basic 2; Fire vs Water no SE
    { form: 'Guppling', owner: 0, x: 3, y: 4 },                // Water Basic 1 (the §6 exception)
    { form: 'Bulwhark', owner: 1, x: 4, y: 4, hexTurns: 2 },   // freshly hexed
  ] });
  s = act(s, 0, 0, { attack: { kind: 'basic', target: { x: 4, y: 4 } } });
  assertEq(unit(s, 2).hp, 11, 'hexed: 2+1=3, 14-3=11');
  s = endTurn(s, 0);
  s = endTurn(s, 1); // victim's 1st own turn ends -> hexTurns 1
  assertEq(unit(s, 2).hexTurns, 1, 'window half elapsed, still active');
  s = act(s, 0, 0, { attack: { kind: 'basic', target: { x: 4, y: 4 } } });
  assertEq(unit(s, 2).hp, 8, 'still hexed across the round: 11-3=8');
  s = endTurn(s, 0);
  s = endTurn(s, 1); // victim's 2nd own turn ends -> hex expires
  assertEq(unit(s, 2).hexTurns, 0, 'expired at end of 2nd own turn');
  s = act(s, 0, 1, { attack: { kind: 'basic', target: { x: 4, y: 4 } } });
  assertEq(unit(s, 2).hp, 7, 'no more +1: Guppling basic 1, 8-1=7');
});

test('Hex: +1 on Burn ticks too — Burn 2 ticks 3 on a hexed victim (SPEC §3 Hex)', () => {
  let s = mkBattle({ units: [
    { form: 'Tavrik', owner: 0, x: 0, y: 0 },
    { form: 'Bulwhark', owner: 1, x: 4, y: 4, burn: { n: 2, ticks: 2 }, hexTurns: 2 },
  ] });
  s = endTurn(s, 0); // victim's turn starts: burn tick = 2 + 1 hex = 3
  assertEq(unit(s, 1).hp, 11, '14-(2+1)=11');
  assertEq(unit(s, 1).burn.ticks, 1, 'tick consumed normally');
});

test('Hex: +1 on aura damage — Local Storm deals 1+1=2 to a hexed adjacent enemy (SPEC §3 Hex / §5)', () => {
  let s = mkBattle({ units: [
    { form: 'Tempestdrake', owner: 0, x: 4, y: 3 },            // Local Storm: 1 dmg to every unit within 1 at end of turn
    { form: 'Bulwhark', owner: 1, x: 4, y: 4, hexTurns: 2 },
  ] });
  s = endTurn(s, 0); // helper auto-resolves the pending Local Storm aura
  assertEq(unit(s, 1).hp, 12, 'hexed aura damage: 14-(1+1)=12');
});

test('Hex does NOT boost Poison (no damage to boost): hexed Marrow Hurl victim takes exactly 1+1=2 and gains 1 stack (SPEC §3 Hex)', () => {
  let s = mkBattle({ units: [
    { form: 'Ossiyena', owner: 0, x: 4, y: 3 },
    { form: 'Bulwhark', owner: 1, x: 4, y: 4, hexTurns: 2 },
  ] });
  s = act(s, 0, 0, { attack: { kind: 'special', dir: { dx: 0, dy: 1 } } });
  assertEq(unit(s, 1).hp, 12, 'attack 1 + hex 1 = 2 only; poison itself adds nothing: 14-2=12');
  assertEq(unit(s, 1).poison, 1, 'stack applied as normal');
});

// ---------------------------------------------------------------- Lure

test('Lure (Lure Light): pull 1 directly toward the attacker, then Hex applies — 1 dmg, (4,4)->(4,3), hexTurns 2 (SPEC §3 Lure)', () => {
  let s = mkBattle({ units: [
    { form: 'Mawlantern', owner: 0, x: 4, y: 1 },    // Lure Light: Single 3, 1 dmg, Lure; Dark vs Grass no SE
    { form: 'Grovewarden', owner: 1, x: 4, y: 4 },
  ] });
  s = act(s, 0, 0, { attack: { kind: 'special', dir: { dx: 0, dy: 1 } } });
  assertEq(unit(s, 1).hp, 13, '14-1=13');
  assertPos(unit(s, 1), 4, 3, 'pulled 1 toward attacker');
  assertEq(unit(s, 1).hexTurns, 2, 'Hex applied after the pull');
});

test('Lure pull CANCELLED when the destination is occupied (attacker\'s own square) — Hex still applies (SPEC §3 Lure)', () => {
  let s = mkBattle({ units: [
    { form: 'Mawlantern', owner: 0, x: 4, y: 3 },
    { form: 'Grovewarden', owner: 1, x: 4, y: 4 },   // pull destination (4,3) = attacker: occupied -> cancel
  ] });
  s = act(s, 0, 0, { attack: { kind: 'special', dir: { dx: 0, dy: 1 } } });
  assertEq(unit(s, 1).hp, 13, '14-1=13');
  assertPos(unit(s, 1), 4, 4, 'pull cancelled, victim stays');
  assertEq(unit(s, 1).hexTurns, 2, 'Hex applies regardless of the cancelled pull');
});

test('Hex reapplication resets the window to 2 (SPEC §3 Hex "reapplying resets duration")', () => {
  let s = mkBattle({ units: [
    { form: 'Mawlantern', owner: 0, x: 4, y: 1 },
    { form: 'Grovewarden', owner: 1, x: 4, y: 4, hexTurns: 1 },  // old hex about to expire
  ] });
  s = act(s, 0, 0, { attack: { kind: 'special', dir: { dx: 0, dy: 1 } } });
  assertEq(unit(s, 1).hexTurns, 2, 'reset to a fresh 2-turn window');
});

// ---------------------------------------------------------------- Recoil

test('Recoil 2 applies AFTER the attack resolves, even though the target died, and can self-KO the attacker (SPEC §3 Recoil)', () => {
  let s = mkBattle({ units: [
    { form: 'Pyroclasm', owner: 0, x: 4, y: 3, hp: 2 },   // Magma Stream Recoil 2 will zero it
    { form: 'Mosskit', owner: 1, x: 4, y: 4 },            // Grass 5hp: Fire SE sole eligible -> 3*2=6 -> KO
    { form: 'Tavrik', owner: 0, x: 0, y: 0 },             // bystanders: neither side is wiped
    { form: 'Grovewarden', owner: 1, x: 7, y: 7 },
  ] });
  s = play(s, [
    [0, { t: 'activate', unitId: 0 }],
    [0, { t: 'attack', kind: 'special', dir: { dx: 0, dy: 1 } }],
  ]);
  assertEq(unit(s, 1).pos, null, 'target KO\'d: 5 - min(6,...) -> dead');
  assertEq(unit(s, 0).pos, null, 'recoil still applied and self-KO\'d the attacker: 2-2=0');
  assertEq(unit(s, 0).dealt, 5, 'dealt capped at victim\'s remaining 5 hp (DEV-PIN 8), x2 included');
  assertEq(s.winner, null, 'no winner: both sides still have units');
});

// ---------------------------------------------------------------- Lunge

test('Lunge legality keys off the target\'s FINAL (post-push) position: adjacent-to-old-square only is illegal (SPEC §3 Lunge)', () => {
  let s = mkBattle({ units: [
    { form: 'Bulwhark', owner: 0, x: 3, y: 3 },   // Tidal Ram: 3 dmg, Push 1, Lunge
    { form: 'Mosskit', owner: 1, x: 3, y: 5 },    // 5-3=2 hp; pushed (3,5) -> (3,6)
  ] });
  s = GM.applyAction(s, 0, { t: 'activate', unitId: 0 });
  // (3,4) is 8-adj to the ORIGINAL square (3,5) but Chebyshev 2 from the final (3,6): illegal.
  assertThrows(() => GM.applyAction(s, 0, {
    t: 'attack', kind: 'special', dir: { dx: 0, dy: 1 }, lungeTo: { x: 3, y: 4 },
  }), 'lunge must be adjacent to the FINAL position');
  // (2,7) is 8-adj to the final (3,6) and empty: legal.
  s = GM.applyAction(s, 0, {
    t: 'attack', kind: 'special', dir: { dx: 0, dy: 1 }, lungeTo: { x: 2, y: 7 },
  });
  assertPos(unit(s, 1), 3, 6, 'victim pushed to final square');
  assertPos(unit(s, 0), 2, 7, 'attacker lunged adjacent to the final square');
});

test('Lunge may take the KO\'d target\'s own square (SPEC §3 Lunge): Pounce x2 vs Electric KOs Zapkitt, Pumarok takes (4,4)', () => {
  let s = mkBattle({ units: [
    { form: 'Pumarok', owner: 0, x: 4, y: 2 },      // Pounce: Single 2, 3 dmg, Lunge; Ground beats Electric -> 3*2=6
    { form: 'Zapkitt', owner: 1, x: 4, y: 4 },      // 4 hp, takes 6 -> KO
    { form: 'Grovewarden', owner: 1, x: 0, y: 7 },  // bystander
  ] });
  s = act(s, 0, 0, { attack: { kind: 'special', dir: { dx: 0, dy: 1 }, lungeTo: { x: 4, y: 4 } } });
  assertEq(unit(s, 1).pos, null, 'target KO\'d');
  assertPos(unit(s, 0), 4, 4, 'attacker took the corpse\'s square');
});

test('Lunge is OPTIONAL: omitting lungeTo leaves the attacker in place (SPEC §3 riders)', () => {
  let s = mkBattle({ units: [
    { form: 'Pumarok', owner: 0, x: 4, y: 2 },
    { form: 'Grovewarden', owner: 1, x: 4, y: 4 },  // Ground vs Grass no SE: 14-3=11
  ] });
  s = act(s, 0, 0, { attack: { kind: 'special', dir: { dx: 0, dy: 1 } } });
  assertEq(unit(s, 1).hp, 11, 'Pounce 3 dmg: 14-3=11');
  assertPos(unit(s, 0), 4, 2, 'attacker stayed put');
});

test('Lunge to an OCCUPIED square is rejected (SPEC §3: "any empty square adjacent")', () => {
  let s = mkBattle({ units: [
    { form: 'Pumarok', owner: 0, x: 4, y: 2 },
    { form: 'Grovewarden', owner: 1, x: 4, y: 4 },
    { form: 'Hootle', owner: 1, x: 5, y: 5 },        // adjacent to the target but occupied
  ] });
  s = GM.applyAction(s, 0, { t: 'activate', unitId: 0 });
  assertThrows(() => GM.applyAction(s, 0, {
    t: 'attack', kind: 'special', dir: { dx: 0, dy: 1 }, lungeTo: { x: 5, y: 5 },
  }), 'lunge destination must be empty');
});

// ---------------------------------------------------------------- Blink 2

test('Blink 2 (Mindclaw rider): teleport to an empty square within Chebyshev 2, IGNORING blockers in between (SPEC §3 Blink)', () => {
  let s = mkBattle({ units: [
    { form: 'Velvesper', owner: 0, x: 4, y: 3 },   // Mindclaw: Single 1, 3 dmg, Blink 2; Psychic SE vs nothing
    { form: 'Bulwhark', owner: 1, x: 4, y: 4 },
    { form: 'Tavrik', owner: 0, x: 5, y: 3 },      // body directly between (4,3) and (6,3): ignored
  ] });
  s = act(s, 0, 0, { attack: { kind: 'special', dir: { dx: 0, dy: 1 }, blinkTo: { x: 6, y: 3 } } });
  assertEq(unit(s, 1).hp, 11, 'Mindclaw 3 dmg: 14-3=11');
  assertPos(unit(s, 0), 6, 3, 'blinked through the blocker to Chebyshev-2 square');
});

test('Blink 2 rejections: Chebyshev 3 illegal, occupied destination illegal; omitting blinkTo is legal (SPEC §3 Blink optional)', () => {
  let s = mkBattle({ units: [
    { form: 'Velvesper', owner: 0, x: 4, y: 3 },
    { form: 'Bulwhark', owner: 1, x: 4, y: 4 },
    { form: 'Tavrik', owner: 0, x: 5, y: 3 },
  ] });
  s = GM.applyAction(s, 0, { t: 'activate', unitId: 0 });
  assertThrows(() => GM.applyAction(s, 0, {
    t: 'attack', kind: 'special', dir: { dx: 0, dy: 1 }, blinkTo: { x: 7, y: 3 },
  }), 'Chebyshev 3 exceeds Blink 2');
  assertThrows(() => GM.applyAction(s, 0, {
    t: 'attack', kind: 'special', dir: { dx: 0, dy: 1 }, blinkTo: { x: 5, y: 3 },
  }), 'must land on an EMPTY square');
  s = GM.applyAction(s, 0, { t: 'attack', kind: 'special', dir: { dx: 0, dy: 1 } });
  assertEq(unit(s, 1).hp, 11, 'attack resolved: 14-3=11');
  assertPos(unit(s, 0), 4, 3, 'blink declined: attacker stayed');
});

test('Pinned unit may still use the Blink rider — Pin blocks only the move step (DEV-PIN 4)', () => {
  let s = mkBattle({ turn: 1, units: [
    { form: 'Bulwhark', owner: 0, x: 4, y: 5 },
    { form: 'Velvesper', owner: 1, x: 4, y: 4, pinnedTurn: 1 },  // pinned RIGHT NOW (playerTurns[1] = 1)
  ] });
  s = GM.applyAction(s, 1, { t: 'activate', unitId: 1 });
  assertThrows(() => GM.applyAction(s, 1, { t: 'move', path: [{ x: 3, y: 4 }] }),
    'normal movement blocked by Pin');
  s = GM.applyAction(s, 1, { t: 'attack', kind: 'special', dir: { dx: 0, dy: 1 }, blinkTo: { x: 2, y: 4 } });
  assertEq(unit(s, 0).hp, 11, 'Mindclaw 3 dmg: 14-3=11');
  assertPos(unit(s, 1), 2, 4, 'rider movement allowed while pinned');
});

module.exports = T;
