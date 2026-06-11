// SPEC §3 traits — Talonlock, Tyrantbane, Backstab/Skulk, Static Quills, Butcher,
// Thorn-root, Telegrab. All expected values derived from PATCH-V8.md + SPEC.md +
// CONTRACT.md, with max HP taken from data.js (PATCH-V8 §3) — engine.js not consulted.
// Damage pipeline (CONTRACT "Damage pipeline"): base → ×2 at most once → flat adds
// (Backstab +2 / Butcher +2 / Glacial Gore) → Dread −1 (min 1) → Hex +1.
// Pin model (CONTRACT): pinnedTurn = playerTurns[owner]+1 at application; "Pinned" status
// holds from application until cleared at end of owner-turn #pinnedTurn. mkBattle defaults:
// turn 0, playerTurns [1,0] — so owner-0 pinned NOW = pinnedTurn 1; an owner-1 unit with
// pinnedTurn 1 counts as Pinned during player 0's current turn.
const { GM, DATA, assert, assertEq, assertThrows, mkBattle, play, act, endTurn, unit, at } =
  require('./helpers.js');

const T = [];

// ---------------------------------------------------------------- TALONLOCK

T.push({
  name: 'Talonlock: Stoop Strike pin lands -> lunge MANDATORY; omitting lungeTo throws when a legal square exists (SPEC §3 Forced lock)',
  fn() {
    // Peregale (3,3) hits Bulwhark (3,5) at range 2; Flying vs Water = neutral, 2 dmg, Pin lands.
    // Empty squares 8-adj to (3,5) exist (e.g. (3,4)) -> declining the lunge is illegal.
    const s0 = mkBattle({ units: [
      { form: 'Peregale', owner: 0, x: 3, y: 3 },
      { form: 'Bulwhark', owner: 1, x: 3, y: 5 },
    ]});
    const s1 = GM.applyAction(s0, 0, { t: 'activate', unitId: 0 });
    assertThrows(() => GM.applyAction(s1, 0, { t: 'attack', kind: 'special', dir: { dx: 0, dy: 1 } }),
      'Stoop Strike without lungeTo must throw when pin lands and a legal lunge square exists');
  },
});

T.push({
  name: 'Talonlock: mandatory lunge relocates Peregale adjacent; self-root set (rootedTurn=playerTurns[0]+1=2), victim pinned (pinnedTurn=1); dmg 2 (SPEC §3 Forced lock + Self-root)',
  fn() {
    const s0 = mkBattle({ units: [
      { form: 'Peregale', owner: 0, x: 3, y: 3 },
      { form: 'Bulwhark', owner: 1, x: 3, y: 5 },
    ]});
    const s = act(s0, 0, 0, { attack: { kind: 'special', dir: { dx: 0, dy: 1 }, lungeTo: { x: 3, y: 4 } } });
    assertEq(unit(s, 1).hp, 12, 'Stoop Strike 2 dmg, no doubling (Flying vs Water, target not pinned): 14−2');
    assertEq(unit(s, 1).pinnedTurn, 1, 'victim pinned: playerTurns[1]+1 = 0+1');
    assertEq(unit(s, 0).pos, { x: 3, y: 4 }, 'Peregale lunged adjacent to pinned target');
    assertEq(unit(s, 0).rootedTurn, 2, 'self-root: blocks Peregale movement on its controller next turn (playerTurns[0]+1)');
  },
});

T.push({
  name: 'Talonlock: rooted Peregale cannot normal-move on its controller\'s next turn; root clears at that turn\'s end (SPEC §3 Self-root)',
  fn() {
    // rootedTurn 1 === playerTurns[0] (default 1) -> rooted RIGHT NOW.
    const s0 = mkBattle({ units: [
      { form: 'Peregale', owner: 0, x: 3, y: 3, rootedTurn: 1 },
      { form: 'Bulwhark', owner: 1, x: 7, y: 7 },
    ]});
    const s1 = GM.applyAction(s0, 0, { t: 'activate', unitId: 0 });
    assertThrows(() => GM.applyAction(s1, 0, { t: 'move', path: [{ x: 3, y: 4 }] }),
      'rooted unit must not be able to move');
    // Root clears at the end of owner-turn #1.
    const s2 = endTurn(act(s0, 0, 0, {}), 0);
    assertEq(unit(s2, 0).rootedTurn, 0, 'root cleared at end of the turn it applied to');
  },
});

T.push({
  name: 'Talonlock: pin lands but NO legal lunge square -> Peregale stays put, no root, lunge not required (SPEC §3 "If no such square exists/is legal")',
  fn() {
    // Target cornered at (7,7); its 8-adj squares: (6,6) and (6,7) occupied, (7,6) is Peregale
    // itself (not empty) -> zero legal lunge destinations.
    const s0 = mkBattle({ units: [
      { form: 'Peregale', owner: 0, x: 7, y: 6 },
      { form: 'Bulwhark', owner: 1, x: 7, y: 7 },
      { form: 'Mosskit',  owner: 1, x: 6, y: 6 },
      { form: 'Snapling', owner: 1, x: 6, y: 7 },
    ]});
    const s = act(s0, 0, 0, { attack: { kind: 'special', dir: { dx: 0, dy: 1 } } }); // no lungeTo: legal here
    assertEq(unit(s, 1).hp, 12, 'Stoop Strike still deals 2 (14−2)');
    assertEq(unit(s, 1).pinnedTurn, 1, 'pin still lands');
    assertEq(unit(s, 0).pos, { x: 7, y: 6 }, 'Peregale stays put');
    assertEq(unit(s, 0).rootedTurn, 0, 'no lock -> no self-root');
  },
});

T.push({
  name: 'Talonlock Predator: Peregale Basic ×2 vs a unit pinned by ANY source (pin is source-agnostic state): 2×2=4 (SPEC §3 Predator)',
  fn() {
    // pinnedTurn preset models a pin from Stormbolt / Seed Mortar / Butcherbeak equally.
    const s0 = mkBattle({ units: [
      { form: 'Peregale', owner: 0, x: 3, y: 3 },
      { form: 'Bulwhark', owner: 1, x: 3, y: 4, pinnedTurn: 1 },
    ]});
    const s = act(s0, 0, 0, { attack: { kind: 'basic', target: { x: 3, y: 4 } } });
    assertEq(unit(s, 1).hp, 10, 'Basic 2 doubled by Predator vs Pinned (Water target: no super-effective in play): 14−4');
  },
});

T.push({
  name: 'Talonlock ×2 cap: pinned GRASS unit hit by Peregale Basic = 4 not 8 (super-effective + Predator double once; SPEC §3 global cap)',
  fn() {
    const s0 = mkBattle({ units: [
      { form: 'Peregale',    owner: 0, x: 3, y: 3 },
      { form: 'Grovewarden', owner: 1, x: 3, y: 4, pinnedTurn: 1 },
    ]});
    const s = act(s0, 0, 0, { attack: { kind: 'basic', target: { x: 3, y: 4 } } });
    assertEq(unit(s, 1).hp, 10, 'Flying beats Grass AND Predator: still 2×2=4, never ×4 (14−4=10)');
  },
});

T.push({
  name: 'Talonlock Predator applies to Stoop Strike too: 2×2=4 vs pinned target, re-pins, lunge still mandatory (SPEC §3 Predator)',
  fn() {
    const s0 = mkBattle({ units: [
      { form: 'Peregale', owner: 0, x: 3, y: 3 },
      { form: 'Bulwhark', owner: 1, x: 3, y: 5, pinnedTurn: 1 },
    ]});
    const s = act(s0, 0, 0, { attack: { kind: 'special', dir: { dx: 0, dy: 1 }, lungeTo: { x: 3, y: 4 } } });
    assertEq(unit(s, 1).hp, 10, 'Stoop Strike 2 ×2 Predator = 4 (14−4)');
    assertEq(unit(s, 1).pinnedTurn, 1, 're-applied pin: playerTurns[1]+1 = 1');
    assertEq(unit(s, 0).pos, { x: 3, y: 4 }, 'mandatory lunge executed');
  },
});

T.push({
  name: 'Talonlock concert: Butcherbeak Impale pins, then Peregale Basic same turn deals 2×2=4 (SPEC §3 Butcher "designed concert")',
  fn() {
    const s0 = mkBattle({ units: [
      { form: 'Butcherbeak', owner: 0, x: 2, y: 3 },
      { form: 'Peregale',    owner: 0, x: 4, y: 3 },
      { form: 'Bulwhark',    owner: 1, x: 3, y: 3 },
    ]});
    let s = act(s0, 0, 0, { attack: { kind: 'special', dir: { dx: 1, dy: 0 } } }); // Impale
    assertEq(unit(s, 2).hp, 12, 'Impale 2, no Butcher bonus (its own pin lands after damage): 14−2');
    assertEq(unit(s, 2).pinnedTurn, 1, 'Impale pin landed');
    s = act(s, 0, 1, { attack: { kind: 'basic', target: { x: 3, y: 3 } } });
    assertEq(unit(s, 2).hp, 8, 'Peregale Basic doubled vs the now-Pinned unit: 12−4=8');
  },
});

T.push({
  name: 'Talonlock override: Stoop Strike incl. lunge usable while Peregale itself is pinned, but normal move blocked (SPEC §3 Override, DEV-PIN 4)',
  fn() {
    // Peregale pinned RIGHT NOW: owner 0, pinnedTurn 1 === playerTurns[0].
    const s0 = mkBattle({ units: [
      { form: 'Peregale', owner: 0, x: 3, y: 3, pinnedTurn: 1 },
      { form: 'Bulwhark', owner: 1, x: 3, y: 5 },
    ]});
    const s1 = GM.applyAction(s0, 0, { t: 'activate', unitId: 0 });
    assertThrows(() => GM.applyAction(s1, 0, { t: 'move', path: [{ x: 4, y: 3 }] }),
      'pinned unit must not normal-move');
    const s2 = GM.applyAction(s1, 0, { t: 'attack', kind: 'special', dir: { dx: 0, dy: 1 }, lungeTo: { x: 2, y: 5 } });
    assertEq(unit(s2, 1).hp, 12, 'Stoop Strike resolves (2 dmg) while attacker pinned (14−2)');
    assertEq(unit(s2, 0).pos, { x: 2, y: 5 }, 'built-in lunge movement allowed despite pin');
    assertEq(unit(s2, 0).rootedTurn, 2, 'lock adjacent -> self-root');
  },
});

T.push({
  name: 'Talonlock DEV-PIN 17: Stoop Strike KOs target -> no pin, lunge OPTIONAL (omit OK; or take the corpse square); no self-root',
  fn() {
    const s0 = mkBattle({ units: [
      { form: 'Peregale', owner: 0, x: 3, y: 3 },
      { form: 'Bulwhark', owner: 1, x: 3, y: 5, hp: 2 },
      { form: 'Mosskit',  owner: 1, x: 7, y: 7 }, // keeps the game alive after the KO
    ]});
    const pre = GM.applyAction(s0, 0, { t: 'activate', unitId: 0 });
    // a) Declining the lunge is legal — no pin landed, so nothing is mandatory.
    const sa = GM.applyAction(pre, 0, { t: 'attack', kind: 'special', dir: { dx: 0, dy: 1 } });
    assertEq(unit(sa, 1).pos, null, 'target KO\'d (2 dmg vs 2 hp)');
    assertEq(unit(sa, 0).pos, { x: 3, y: 3 }, 'Peregale stayed (lunge declined)');
    assertEq(unit(sa, 0).rootedTurn, 0, 'no pin -> no self-root');
    // b) Optional lunge may take the KO'd target's square (SPEC §3 Lunge rider).
    const sb = GM.applyAction(pre, 0, { t: 'attack', kind: 'special', dir: { dx: 0, dy: 1 }, lungeTo: { x: 3, y: 5 } });
    assertEq(unit(sb, 0).pos, { x: 3, y: 5 }, 'Peregale may take the corpse square');
    assertEq(unit(sb, 0).rootedTurn, 0, 'still no self-root on a KO');
  },
});

T.push({
  name: 'Immediate root forfeits the unused move (DEV-PIN 25 / PATCH-V8 §1): Stoop Strike lock-on with move unspent -> move spent and blocked; without a root the move survives the attack (DEV-PIN 24)',
  fn() {
    // (a) Pin lands + lock-on with the move still unspent: root applies immediately, move forfeited.
    const s0 = mkBattle({ units: [
      { form: 'Peregale', owner: 0, x: 3, y: 3 },
      { form: 'Bulwhark', owner: 1, x: 3, y: 5 },
    ]});
    let s = GM.applyAction(s0, 0, { t: 'activate', unitId: 0 });
    s = GM.applyAction(s, 0, { t: 'attack', kind: 'special', dir: { dx: 0, dy: 1 }, lungeTo: { x: 3, y: 4 } });
    assertEq(unit(s, 0).rootedTurn, 2, 'self-root applied immediately on lock-on');
    assertEq(s.turn.current.moved, true, 'engine marks the activation\'s move as spent (CONTRACT DEV-PIN 25)');
    assertThrows(() => GM.applyAction(s, 0, { t: 'move', path: [{ x: 2, y: 4 }] }),
      'move after lock-on must throw — forfeited despite DEV-PIN 24 free order');
    // (b) Control — free order without a root: attack-then-move is legal (DEV-PIN 24).
    const c0 = mkBattle({ units: [
      { form: 'Peregale', owner: 0, x: 3, y: 3 },
      { form: 'Bulwhark', owner: 1, x: 3, y: 4 },
    ]});
    let c = GM.applyAction(c0, 0, { t: 'activate', unitId: 0 });
    c = GM.applyAction(c, 0, { t: 'attack', kind: 'basic', target: { x: 3, y: 4 } });
    c = GM.applyAction(c, 0, { t: 'move', path: [{ x: 2, y: 3 }] });
    assertEq(unit(c, 0).pos, { x: 2, y: 3 }, 'attack-then-move legal when no root triggered');
    // (c) Control — pin lands but NO legal lunge square -> no lock, no root, move kept.
    const n0 = mkBattle({ units: [
      { form: 'Peregale', owner: 0, x: 7, y: 6 },
      { form: 'Bulwhark', owner: 1, x: 7, y: 7 },
      { form: 'Mosskit',  owner: 1, x: 6, y: 6 },
      { form: 'Snapling', owner: 1, x: 6, y: 7 },
    ]});
    let n = GM.applyAction(n0, 0, { t: 'activate', unitId: 0 });
    n = GM.applyAction(n, 0, { t: 'attack', kind: 'special', dir: { dx: 0, dy: 1 } });
    assertEq(unit(n, 0).rootedTurn, 0, 'no lock -> no root');
    n = GM.applyAction(n, 0, { t: 'move', path: [{ x: 7, y: 5 }] });
    assertEq(unit(n, 0).pos, { x: 7, y: 5 }, 'move NOT forfeited when the root never applied');
  },
});

// ---------------------------------------------------------------- TYRANTBANE

T.push({
  name: 'Tyrantbane: Magma Stream deals 0 to Tavrik, no burn; the Lance passes THROUGH and hits the unit beyond; recoil still applies (SPEC §3 Tyrant-proof)',
  fn() {
    // Pyroclasm (Rival) lances N: (3,4) Tavrik immune, (3,5) Snapling takes 3 + Burn 2.
    const s0 = mkBattle({ turn: 1, units: [
      { form: 'Pyroclasm', owner: 1, x: 3, y: 3 },
      { form: 'Tavrik',    owner: 0, x: 3, y: 4 },
      { form: 'Snapling',  owner: 0, x: 3, y: 5 },
    ]});
    const s = act(s0, 1, 0, { attack: { kind: 'special', dir: { dx: 0, dy: 1 } } });
    assertEq(unit(s, 1).hp, 8, 'Tavrik: 0 damage from a Rival Special');
    assertEq(unit(s, 1).burn, null, 'Tavrik: no Burn from a Rival Special');
    assertEq(unit(s, 2).hp, 2, 'Snapling beyond Tavrik takes the full 3 (immune, not a wall; Fire vs Water neutral): 5−3');
    assertEq(unit(s, 2).burn, { n: 2, ticks: 2 }, 'Snapling burned normally');
    assertEq(unit(s, 0).hp, 7, 'Recoil 2 on Pyroclasm unaffected: 9−2');
  },
});

T.push({
  name: 'Tyrantbane: Local Storm deals 0 to Tavrik from BOTH a friendly and an enemy Tempestdrake (SPEC §3 Tyrant-proof, regardless of side)',
  fn() {
    // Friendly Tempestdrake: end of owner 0's turn — adjacent ally Mosskit takes 1, Tavrik 0.
    const sa0 = mkBattle({ units: [
      { form: 'Tempestdrake', owner: 0, x: 3, y: 3 },
      { form: 'Tavrik',       owner: 0, x: 3, y: 4 },
      { form: 'Mosskit',      owner: 0, x: 4, y: 4 },
      { form: 'Bulwhark',     owner: 1, x: 7, y: 7 },
    ]});
    const sa = endTurn(sa0, 0);
    assertEq(unit(sa, 1).hp, 8, 'friendly Local Storm: Tavrik untouched');
    assertEq(unit(sa, 2).hp, 4, 'control: adjacent non-Tavrik ally takes 1 (5−1)');
    // Enemy Tempestdrake: end of owner 1's turn — its own Mosskit takes 1, enemy Tavrik 0.
    const sb0 = mkBattle({ turn: 1, units: [
      { form: 'Tempestdrake', owner: 1, x: 3, y: 3 },
      { form: 'Mosskit',      owner: 1, x: 4, y: 4 },
      { form: 'Tavrik',       owner: 0, x: 3, y: 4 },
    ]});
    const sb = endTurn(sb0, 1);
    assertEq(unit(sb, 2).hp, 8, 'enemy Local Storm: Tavrik untouched');
    assertEq(unit(sb, 1).hp, 4, 'control: Tempestdrake\'s own adjacent ally takes 1 (5−1)');
  },
});

T.push({
  name: 'Tyrantbane: Dread Presence neither −1 on Tavrik\'s attack nor start-of-turn Chill on Tavrik; control unit IS chilled (SPEC §3/§5)',
  fn() {
    // (a) No −1: Tavrik Basic adjacent to Gravewinter (Rival) = 2 ×2 close-kill = 4, NOT 4−1=3.
    const sa0 = mkBattle({ units: [
      { form: 'Tavrik',      owner: 0, x: 3, y: 3 },
      { form: 'Gravewinter', owner: 1, x: 3, y: 4 },
    ]});
    const sa = act(sa0, 0, 0, { attack: { kind: 'basic', target: { x: 3, y: 4 } } });
    assertEq(unit(sa, 1).hp, 11, '15 − (2×2) = 11; Dread −1 must NOT apply to Tavrik');
    // (b) No Chill: start of owner 0's turn, units adjacent to enemy Gravewinter gain Chill — not Tavrik.
    const sb0 = mkBattle({ turn: 1, units: [
      { form: 'Gravewinter', owner: 1, x: 3, y: 4 },
      { form: 'Tavrik',      owner: 0, x: 3, y: 3 },
      { form: 'Mosskit',     owner: 0, x: 4, y: 4 },
    ]});
    const sb = endTurn(sb0, 1);
    assertEq(unit(sb, 1).chill, 0, 'Tavrik immune to Dread Presence Chill');
    assertEq(unit(sb, 2).chill, 1, 'control: adjacent non-Tavrik enemy gains 1 Chill stack');
  },
});

T.push({
  name: 'Tyrantbane: a Rival\'s BASIC hits Tavrik normally for 2 (SPEC §3 "Basics affect Tavrik normally")',
  fn() {
    const s0 = mkBattle({ turn: 1, units: [
      { form: 'Tempestdrake', owner: 1, x: 3, y: 4 },
      { form: 'Tavrik',       owner: 0, x: 3, y: 3 },
    ]});
    const s = act(s0, 1, 0, { attack: { kind: 'basic', target: { x: 3, y: 3 } } });
    assertEq(unit(s, 1).hp, 6, 'Tavrik 8−2: no immunity vs Rival Basics (Flying vs Fire neutral)');
  },
});

T.push({
  name: 'Tyrantbane: non-rival auras affect Tavrik normally — Hungry Depths bites it for 1, Earthquake displaces it (SPEC §3 parenthetical)',
  fn() {
    // Hungry Depths: only Tavrik adjacent -> mandatory bite; enemy bite heals Leviadon 2.
    const sa0 = mkBattle({ turn: 1, units: [
      { form: 'Leviadon', owner: 1, x: 3, y: 4, hp: 5 },
      { form: 'Tavrik',   owner: 0, x: 3, y: 3 },
    ]});
    const sa = endTurn(sa0, 1, [{ unitId: 0, target: 1 }]);
    assertEq(unit(sa, 1).hp, 7, 'Hungry Depths deals 1 to Tavrik (non-rival aura): 8−1');
    assertEq(unit(sa, 0).hp, 7, 'Leviadon heals 2 for an enemy bite: 5+2');
    // Earthquake: Tavrik at (4,4), all 4 orthogonal squares empty -> it MUST move exactly 1 step.
    const sb0 = mkBattle({ turn: 1, units: [
      { form: 'Terradon', owner: 1, x: 5, y: 5 },
      { form: 'Tavrik',   owner: 0, x: 4, y: 4 },
    ]});
    const sb = endTurn(sb0, 1);
    const p = unit(sb, 1).pos;
    assert(p !== null, 'Tavrik alive');
    assertEq(Math.abs(p.x - 4) + Math.abs(p.y - 4), 1,
      'Earthquake moved Tavrik exactly 1 orthogonal square (all 4 destinations were open)');
  },
});

T.push({
  name: 'Tyrantbane close kill: Tavrik Basic 4 vs adjacent Tempestdrake (Rival) but 2 vs adjacent Galewyrm (middle form, no doubling) (SPEC §3 Close kill)',
  fn() {
    const s0 = mkBattle({ units: [
      { form: 'Tavrik',       owner: 0, x: 3, y: 3 },
      { form: 'Tempestdrake', owner: 1, x: 3, y: 4 },
      { form: 'Galewyrm',     owner: 1, x: 4, y: 3 },
    ]});
    const sa = act(s0, 0, 0, { attack: { kind: 'basic', target: { x: 3, y: 4 } } });
    assertEq(unit(sa, 1).hp, 9, 'vs Rival from 8-adjacency: 2×2=4 (13−4)');
    const sb = act(s0, 0, 0, { attack: { kind: 'basic', target: { x: 4, y: 3 } } });
    assertEq(unit(sb, 2).hp, 5, 'vs non-rival Galewyrm: plain 2 (7−2), no close-kill doubling');
  },
});

T.push({
  name: 'Tyrantbane: Napebite declared at a Rival 2 squares away THROWS (illegal declaration, not zero damage); same range vs non-rival is legal (SPEC §3 Close kill)',
  fn() {
    const s0 = mkBattle({ units: [
      { form: 'Tavrik',       owner: 0, x: 3, y: 3 },
      { form: 'Tempestdrake', owner: 1, x: 3, y: 5 }, // range 2 N
      { form: 'Galewyrm',     owner: 1, x: 5, y: 3 }, // range 2 E
    ]});
    const s1 = GM.applyAction(s0, 0, { t: 'activate', unitId: 0 });
    assertThrows(() => GM.applyAction(s1, 0, { t: 'attack', kind: 'special', dir: { dx: 0, dy: 1 } }),
      'Napebite at a Rival at range 2 must be an illegal declaration');
    const s2 = GM.applyAction(s1, 0, { t: 'attack', kind: 'special', dir: { dx: 1, dy: 0 } });
    assertEq(unit(s2, 2).hp, 5, 'Napebite at non-rival Galewyrm at range 2 is legal: 7−2');
  },
});

T.push({
  name: 'Tyrantbane: Napebite from adjacency vs a Rival deals 2×2=4 (SPEC §3 Close kill applies to Basic AND Napebite)',
  fn() {
    const s0 = mkBattle({ units: [
      { form: 'Tavrik',       owner: 0, x: 3, y: 3 },
      { form: 'Tempestdrake', owner: 1, x: 3, y: 4 },
    ]});
    const s = act(s0, 0, 0, { attack: { kind: 'special', dir: { dx: 0, dy: 1 } } });
    assertEq(unit(s, 1).hp, 9, 'Napebite first square = adjacent Rival: doubled, 13−4');
  },
});

T.push({
  name: 'Tyrantbane: pre-evolutions are ordinary — Flarewyrm\'s Special hits Tavrik for 2 (no immunity; SPEC §3 "pre-evolutions are ordinary targets")',
  fn() {
    const s0 = mkBattle({ turn: 1, units: [
      { form: 'Flarewyrm', owner: 1, x: 3, y: 5 },
      { form: 'Tavrik',    owner: 0, x: 3, y: 3 },
    ]});
    const s = act(s0, 1, 0, { attack: { kind: 'special', dir: { dx: 0, dy: -1 } } }); // Ember Stream range 2
    assertEq(unit(s, 1).hp, 6, 'Tavrik takes 2 from a non-Rival pre-evolution Special (Fire vs Fire neutral): 8−2');
  },
});

T.push({
  name: 'Tyrantbane Blood Scent: effectiveSpeed 6 with an ENEMY Rival final on board; 4 vs middle form; 4 with only a FRIENDLY Rival; reverts to 4 the moment the enemy Rival is KO\'d (SPEC §3 Blood Scent, DEV-PIN 18)',
  fn() {
    const withEnemyFinal = mkBattle({ units: [
      { form: 'Tavrik',       owner: 0, x: 1, y: 1 },
      { form: 'Tempestdrake', owner: 1, x: 6, y: 6 },
    ]});
    assertEq(GM.effectiveSpeed(withEnemyFinal, 0), 6, 'enemy Rival final alive -> Speed 6');
    const withEnemyMiddle = mkBattle({ units: [
      { form: 'Tavrik',   owner: 0, x: 1, y: 1 },
      { form: 'Galewyrm', owner: 1, x: 6, y: 6 },
    ]});
    assertEq(GM.effectiveSpeed(withEnemyMiddle, 0), 4, 'middle form carries no Rival keyword -> Speed 4');
    const withFriendly = mkBattle({ units: [
      { form: 'Tavrik',       owner: 0, x: 1, y: 1 },
      { form: 'Tempestdrake', owner: 0, x: 2, y: 1 },
      { form: 'Mosskit',      owner: 1, x: 6, y: 6 },
    ]});
    assertEq(GM.effectiveSpeed(withFriendly, 0), 4, 'a friendly tyrant does not trigger Blood Scent');
    // Revert on KO: Tavrik close-kills a 4-hp Tempestdrake (2×2=4).
    const s0 = mkBattle({ units: [
      { form: 'Tavrik',       owner: 0, x: 3, y: 3 },
      { form: 'Tempestdrake', owner: 1, x: 3, y: 4, hp: 4 },
      { form: 'Mosskit',      owner: 1, x: 7, y: 7 },
    ]});
    const s1 = GM.applyAction(s0, 0, { t: 'activate', unitId: 0 });
    assertEq(GM.effectiveSpeed(s1, 0), 6, 'still 6 before the KO');
    const s2 = GM.applyAction(s1, 0, { t: 'attack', kind: 'basic', target: { x: 3, y: 4 } });
    assertEq(unit(s2, 1).pos, null, 'Tempestdrake KO\'d (4−4)');
    assertEq(GM.effectiveSpeed(s2, 0), 4, 'Speed reverts to 4 immediately on the KO');
  },
});

// ---------------------------------------------------------------- BACKSTAB / SKULK

T.push({
  name: 'Backstab rear trigger: attacker on a diagonal rear square -> +2 flat: Basic 2+2=4 vs Bulwhark (SPEC §3 Backstab (a); rear per CONTRACT facing rules)',
  fn() {
    // Defender owner 1 faces 'S' (default) -> rear = the 3 squares at y+1: (2,4),(3,4),(4,4).
    const s0 = mkBattle({ units: [
      { form: 'Pantherebus', owner: 0, x: 2, y: 4 },
      { form: 'Bulwhark',    owner: 1, x: 3, y: 3 },
    ]});
    const s = act(s0, 0, 0, { attack: { kind: 'basic', target: { x: 3, y: 3 } } });
    assertEq(unit(s, 1).hp, 10, 'Dark vs Water neutral: 2 + 2 backstab = 4 (14−4)');
  },
});

T.push({
  name: 'Backstab flanking trigger: defender adjacent to ANOTHER attacker-allied unit -> +2 even from the front; control without flanker = plain 2 (SPEC §3 Backstab (b))',
  fn() {
    // Defender (3,3) faces S -> attacker at (3,2) is in FRONT (rear trigger off).
    const flanked = mkBattle({ units: [
      { form: 'Pantherebus', owner: 0, x: 3, y: 2 },
      { form: 'Bulwhark',    owner: 1, x: 3, y: 3 },
      { form: 'Mosskit',     owner: 0, x: 4, y: 3 }, // ally of attacker, 8-adj to defender
    ]});
    const sa = act(flanked, 0, 0, { attack: { kind: 'basic', target: { x: 3, y: 3 } } });
    assertEq(unit(sa, 1).hp, 10, 'flanking: 2+2=4 (14−4)');
    // Control: no flanker, front attack -> the attacker itself is not "another unit".
    const alone = mkBattle({ units: [
      { form: 'Pantherebus', owner: 0, x: 3, y: 2 },
      { form: 'Bulwhark',    owner: 1, x: 3, y: 3 },
      { form: 'Mosskit',     owner: 0, x: 7, y: 7 },
    ]});
    const sb = act(alone, 0, 0, { attack: { kind: 'basic', target: { x: 3, y: 3 } } });
    assertEq(unit(sb, 1).hp, 12, 'no trigger: plain 2 (14−2)');
  },
});

T.push({
  name: 'Backstab math order: +2 added AFTER doubling — rear Basic vs Psychic beside enemy Gravewinter = (2×2)+2−1 = 5, leaving 1 hp (wrong order (2+2)×2−1=7 would KO) (SPEC §3 Backstab; CONTRACT pipeline)',
  fn() {
    // Archistrix at (3,3) faces S -> rear includes (3,4). hp: 6 override (v8 max is 9)
    // keeps the discriminator: right order deals 5 (survives at 1), wrong order 7 (KO).
    // Gravewinter (4,5) is 8-adj to the ATTACKER (3,4) -> Dread −1 on the attack.
    const s0 = mkBattle({ units: [
      { form: 'Pantherebus', owner: 0, x: 3, y: 4 },
      { form: 'Archistrix',  owner: 1, x: 3, y: 3, hp: 6 },
      { form: 'Gravewinter', owner: 1, x: 4, y: 5 },
    ]});
    const s = act(s0, 0, 0, { attack: { kind: 'basic', target: { x: 3, y: 3 } } });
    assert(unit(s, 1).pos !== null, 'Archistrix must survive: damage is 5, not 7');
    assertEq(unit(s, 1).hp, 1, 'Dark beats Psychic: (2×2) + 2 backstab − 1 Dread = 5; 6−5=1');
  },
});

T.push({
  name: 'Backstab spec example: Night Fang from the rear vs Psychic = (3×2)+2 = 8, KOs a 6-hp Archistrix (SPEC §3 Backstab math)',
  fn() {
    const s0 = mkBattle({ units: [
      { form: 'Pantherebus', owner: 0, x: 3, y: 4 },
      // facing S, rear square (3,4); hp: 6 keeps the spec example's "6-hp Archistrix"
      // (v8 max is 9 — at full HP the 8 damage would no longer KO).
      { form: 'Archistrix',  owner: 1, x: 3, y: 3, hp: 6 },
      { form: 'Bulwhark',    owner: 1, x: 7, y: 7 },
    ]});
    const s = act(s0, 0, 0, { attack: { kind: 'special', dir: { dx: 0, dy: -1 } } }); // Night Fang range 1, lunge declined
    assertEq(unit(s, 1).pos, null, '8 ≥ 6: super-effective doubled THEN +2');
  },
});

T.push({
  name: 'Skulk/Backstab trait presence: Shadekit none, Duskpard skulk only, Pantherebus skulk+backstab (SPEC §6 line 16)',
  fn() {
    const line = DATA.lines.find(l => l.id === 'shadekit');
    assertEq(line.stages[0].traits, [], 'Shadekit: no traits');
    assert(line.stages[1].traits.includes('skulk'), 'Duskpard has skulk (only non-final trait in the game)');
    assert(!line.stages[1].traits.includes('backstab'), 'Duskpard does NOT have backstab');
    assert(line.stages[2].traits.includes('skulk'), 'Pantherebus keeps skulk');
    assert(line.stages[2].traits.includes('backstab'), 'Pantherebus gains backstab');
  },
});

// ---------------------------------------------------------------- STATIC QUILLS

T.push({
  name: 'Static Quills: adjacent attacker that damages Galvaquill takes exactly 1 after the attack; reflect credits no one (SPEC §3 Static Quills, DEV-PIN 11)',
  fn() {
    const s0 = mkBattle({ turn: 1, units: [
      { form: 'Bulwhark',   owner: 1, x: 3, y: 4 },
      { form: 'Galvaquill', owner: 0, x: 3, y: 3 },
    ]});
    const s = act(s0, 1, 0, { attack: { kind: 'basic', target: { x: 3, y: 3 } } });
    assertEq(unit(s, 1).hp, 10, 'Galvaquill takes the Basic 2 (12−2)');
    assertEq(unit(s, 0).hp, 13, 'attacker takes exactly 1 reflect (14−1), once per attack — not per damage point');
    assertEq(unit(s, 1).dealt, 0, 'reflect credits no one: Galvaquill\'s dealt counter stays 0');
  },
});

T.push({
  name: 'Static Quills: ranged (non-adjacent) attack does NOT trigger the reflect (SPEC §3 "attack made from an adjacent square")',
  fn() {
    const s0 = mkBattle({ turn: 1, units: [
      { form: 'Fulgurlynx', owner: 1, x: 3, y: 6 },
      { form: 'Galvaquill', owner: 0, x: 3, y: 3 },
    ]});
    const s = act(s0, 1, 0, { attack: { kind: 'special', dir: { dx: 0, dy: -1 } } }); // Stormbolt range 3
    assertEq(unit(s, 1).hp, 8, 'Stormbolt 4 dmg (Electric vs Electric neutral): 12−4');
    assertEq(unit(s, 1).pinnedTurn, 2, 'Stormbolt pin: playerTurns[0]+1 = 2');
    assertEq(unit(s, 0).hp, 9, 'no reflect at range');
  },
});

T.push({
  name: 'Static Quills: Burn ticks and auras do NOT trigger the reflect (SPEC §3 "Does not trigger on Burn/Poison ticks or auras")',
  fn() {
    // Burn tick at start of Galvaquill's turn, with an enemy standing adjacent: no reflect.
    const burnState = mkBattle({ turn: 1, units: [
      { form: 'Bulwhark',   owner: 1, x: 3, y: 4 },
      { form: 'Galvaquill', owner: 0, x: 3, y: 3, burn: { n: 2, ticks: 2 } },
    ]});
    const sa = endTurn(burnState, 1);
    assertEq(unit(sa, 1).hp, 10, 'burn ticked 2 at Galvaquill\'s turn start (12−2)');
    assertEq(unit(sa, 0).hp, 14, 'no reflect on a burn tick');
    // Local Storm aura damage from an adjacent enemy Tempestdrake: no reflect.
    const auraState = mkBattle({ turn: 1, units: [
      { form: 'Tempestdrake', owner: 1, x: 3, y: 4 },
      { form: 'Galvaquill',   owner: 0, x: 3, y: 3 },
    ]});
    const sb = endTurn(auraState, 1);
    assertEq(unit(sb, 1).hp, 11, 'Local Storm dealt 1 to Galvaquill (12−1)');
    assertEq(unit(sb, 0).hp, 13, 'no reflect on aura damage');
  },
});

// ---------------------------------------------------------------- BUTCHER

T.push({
  name: 'Butcher: Butcherbeak Basic = 2+2 = 4 vs a unit Peregale pinned (real Stoop Strike pin, same turn) (SPEC §3 Butcher; acceptance §17)',
  fn() {
    const s0 = mkBattle({ units: [
      { form: 'Peregale',    owner: 0, x: 3, y: 3 },
      { form: 'Butcherbeak', owner: 0, x: 4, y: 5 },
      { form: 'Bulwhark',    owner: 1, x: 3, y: 5 },
    ]});
    // Peregale pins (mandatory lunge to (2,4), still 8-adj to (3,5)).
    let s = act(s0, 0, 0, { attack: { kind: 'special', dir: { dx: 0, dy: 1 }, lungeTo: { x: 2, y: 4 } } });
    assertEq(unit(s, 2).hp, 12, 'Stoop Strike 2 (target was not pinned yet): 14−2');
    s = act(s, 0, 1, { attack: { kind: 'basic', target: { x: 3, y: 5 } } });
    assertEq(unit(s, 2).hp, 8, 'Butcher +2 flat vs Pinned: 2+2=4 (Dark vs Water: no doubling), 12−4');
  },
});

T.push({
  name: 'Butcher: Impale\'s OWN pin lands after its damage — first Impale 2 (no +2), a second attack gets 2+2=4 (SPEC §3 Butcher)',
  fn() {
    const s0 = mkBattle({ units: [
      { form: 'Butcherbeak', owner: 0, x: 2, y: 3 },
      { form: 'Butcherbeak', owner: 0, x: 4, y: 3 },
      { form: 'Bulwhark',    owner: 1, x: 3, y: 3 },
    ]});
    let s = act(s0, 0, 0, { attack: { kind: 'special', dir: { dx: 1, dy: 0 } } });
    assertEq(unit(s, 2).hp, 12, 'first Impale: plain 2 — its pin lands after damage (14−2)');
    assertEq(unit(s, 2).pinnedTurn, 1, 'pin landed (playerTurns[1]+1)');
    s = act(s, 0, 1, { attack: { kind: 'special', dir: { dx: -1, dy: 0 } } });
    assertEq(unit(s, 2).hp, 8, 'second Impale vs now-Pinned target: 2+2=4 (12−4)');
  },
});

// ---------------------------------------------------------------- THORN-ROOT / v8 BUTCHERBEAK

T.push({
  name: 'Thorn-root (DEV-PIN 26 / PATCH-V8 §2): Impale\'s pin roots Butcherbeak immediately (no lunge, move forfeited); rooted next turn it may attack — Impale included — but not move; clears at that turn\'s end',
  fn() {
    const s0 = mkBattle({ units: [
      { form: 'Butcherbeak', owner: 0, x: 3, y: 3 },
      { form: 'Bulwhark',    owner: 1, x: 3, y: 4 },
    ]});
    let s = GM.applyAction(s0, 0, { t: 'activate', unitId: 0 });
    s = GM.applyAction(s, 0, { t: 'attack', kind: 'special', dir: { dx: 0, dy: 1 } }); // Impale, range 1
    assertEq(unit(s, 1).hp, 12, 'Impale 2 (Dark vs Water neutral): 14−2');
    assertEq(unit(s, 1).pinnedTurn, 1, 'Impale pin landed on the victim (playerTurns[1]+1)');
    assertEq(unit(s, 0).rootedTurn, 2, 'thorn-root: rooted for owner-turn 2 (playerTurns[0]+1)');
    assertEq(unit(s, 0).pos, { x: 3, y: 3 }, 'no forced lunge on thorn-root (Impale is melee)');
    assertThrows(() => GM.applyAction(s, 0, { t: 'move', path: [{ x: 2, y: 3 }] }),
      'unused move forfeited the moment the root applies (DEV-PIN 25)');
    s = GM.applyAction(s, 0, { t: 'endActivation' });
    s = endTurn(s, 0);          // -> player 1's turn (victim pinned through it; pin clears at its end)
    s = endTurn(s, 1);          // -> player 0's turn 2: Butcherbeak is rooted NOW
    const a = GM.applyAction(s, 0, { t: 'activate', unitId: 0 });
    assertThrows(() => GM.applyAction(a, 0, { t: 'move', path: [{ x: 2, y: 3 }] }),
      'rooted: cannot move during its controller\'s next turn');
    // Impale is usable while rooted (victim's pin expired at the end of ITS turn -> plain 2, no Butcher +2).
    const b = GM.applyAction(a, 0, { t: 'attack', kind: 'special', dir: { dx: 0, dy: 1 } });
    assertEq(unit(b, 1).hp, 10, 'Impale while rooted: 12−2');
    // Root clears at the end of owner-turn 2 (attack with the Basic so no new pin re-roots).
    let c = GM.applyAction(a, 0, { t: 'attack', kind: 'basic', target: { x: 3, y: 4 } });
    c = GM.applyAction(c, 0, { t: 'endActivation' });
    c = endTurn(c, 0);
    assertEq(unit(c, 0).rootedTurn, 0, 'root cleared at the end of the turn it applied to');
  },
});

T.push({
  name: 'Skulk roster is exactly Duskpard + Pantherebus + Butcherbeak; Butcherbeak carries butcher+skulk+thornRoot and skulks through bodies (DEV-PIN 26 / PATCH-V8 §2)',
  fn() {
    const skulkers = [];
    for (const line of DATA.lines) for (const st of line.stages)
      if (st.traits.includes('skulk')) skulkers.push(st.name);
    assertEq(skulkers.sort(), ['Butcherbeak', 'Duskpard', 'Pantherebus'], 'skulk roster (PATCH-V8 §2)');
    const shriket = DATA.lines.find(l => l.id === 'shriket');
    assertEq(shriket.stages[0].traits, [], 'Shriket (base): no traits');
    const bb = shriket.stages[1].traits;
    assert(bb.includes('butcher') && bb.includes('skulk') && bb.includes('thornRoot'),
      'Butcherbeak has butcher + skulk + thornRoot');
    // Pathing: movement passes THROUGH a body but cannot end on one.
    const p0 = mkBattle({ units: [
      { form: 'Butcherbeak', owner: 0, x: 3, y: 3 },
      { form: 'Bulwhark',    owner: 1, x: 3, y: 4 }, // body on the path
      { form: 'Mosskit',     owner: 1, x: 7, y: 7 },
    ]});
    const p1 = GM.applyAction(p0, 0, { t: 'activate', unitId: 0 });
    assertThrows(() => GM.applyAction(p1, 0, { t: 'move', path: [{ x: 3, y: 4 }] }),
      'skulk still cannot END on an occupied square');
    const p2 = GM.applyAction(p1, 0, { t: 'move', path: [{ x: 3, y: 4 }, { x: 3, y: 5 }] });
    assertEq(unit(p2, 0).pos, { x: 3, y: 5 }, 'Butcherbeak passed through the enemy body and ended beyond it');
  },
});

// ---------------------------------------------------------------- TELEGRAB

T.push({
  name: 'Telegrab: Chebyshev range 3 through blockers; relocate Chebyshev 2 ignoring blockers; counter increments; first Telesmash = 1 (SPEC §3 Telegrab, DEV-PIN 7)',
  fn() {
    // Victim at (5,5): Chebyshev 3 from (2,2) with a unit at (3,3) on the line — not blocked.
    // Relocation (5,5)->(3,5) hops over the unit at (4,5).
    const s0 = mkBattle({ units: [
      { form: 'Archistrix', owner: 0, x: 2, y: 2 },
      { form: 'Bulwhark',   owner: 1, x: 5, y: 5 },
      { form: 'Mosskit',    owner: 1, x: 3, y: 3 },
      { form: 'Snapling',   owner: 1, x: 4, y: 5 },
    ]});
    const s = act(s0, 0, 0, { attack: { kind: 'special', targetUnit: 1, relocateTo: { x: 3, y: 5 } } });
    assertEq(unit(s, 1).pos, { x: 3, y: 5 }, 'relocated 2 (Chebyshev) over an intervening unit');
    assertEq(unit(s, 1).telegrabs, 1, 'lifetime counter incremented');
    assertEq(unit(s, 1).hp, 13, 'Telesmash = min(3, counter incl. this grab) = 1 (14−1); Psychic never super-effective');
  },
});

T.push({
  name: 'Telegrab counter ramp: 2nd grab deals 2, 3rd+ caps at 3 (Archistrix Telesmash = min(3, lifetime count)) (SPEC §3, DEV-PIN 7)',
  fn() {
    const grabbedOnce = mkBattle({ units: [
      { form: 'Archistrix', owner: 0, x: 2, y: 2 },
      { form: 'Bulwhark',   owner: 1, x: 4, y: 4, telegrabs: 1 },
    ]});
    const sa = act(grabbedOnce, 0, 0, { attack: { kind: 'special', targetUnit: 1, relocateTo: null } });
    assertEq(unit(sa, 1).hp, 12, '2nd lifetime grab: 2 dmg (14−2)');
    assertEq(unit(sa, 1).telegrabs, 2, 'counter at 2');
    const grabbedFive = mkBattle({ units: [
      { form: 'Archistrix', owner: 0, x: 2, y: 2 },
      { form: 'Bulwhark',   owner: 1, x: 4, y: 4, telegrabs: 5 },
    ]});
    const sb = act(grabbedFive, 0, 0, { attack: { kind: 'special', targetUnit: 1, relocateTo: null } });
    assertEq(unit(sb, 1).hp, 11, '6th grab still capped: min(3,6)=3 (14−3)');
    assertEq(unit(sb, 1).telegrabs, 6, 'counter keeps counting past the cap');
  },
});

T.push({
  name: 'Telegrab (Parliowl): 0 Telesmash damage but the victim\'s lifetime counter STILL increments; range capped at 2 (SPEC §3 weakened version, DEV-PIN 7)',
  fn() {
    const inRange = mkBattle({ units: [
      { form: 'Parliowl', owner: 0, x: 2, y: 2 },
      { form: 'Bulwhark', owner: 1, x: 4, y: 4 }, // Chebyshev 2
    ]});
    const sa = act(inRange, 0, 0, { attack: { kind: 'special', targetUnit: 1, relocateTo: { x: 4, y: 3 } } });
    assertEq(unit(sa, 1).hp, 14, 'Parliowl deals no Telesmash damage (still at max 14)');
    assertEq(unit(sa, 1).telegrabs, 1, 'but the grab still counts toward the lifetime counter');
    assertEq(unit(sa, 1).pos, { x: 4, y: 3 }, 'relocated 1 (Parliowl relocate = 1)');
    const tooFar = mkBattle({ units: [
      { form: 'Parliowl', owner: 0, x: 2, y: 2 },
      { form: 'Bulwhark', owner: 1, x: 5, y: 5 }, // Chebyshev 3 > 2
    ]});
    const s1 = GM.applyAction(tooFar, 0, { t: 'activate', unitId: 0 });
    assertThrows(() => GM.applyAction(s1, 0, { t: 'attack', kind: 'special', targetUnit: 1, relocateTo: null }),
      'Parliowl Telegrab beyond range 2 must throw');
  },
});

T.push({
  name: 'Telegrab: null relocation is legal, and FORCED when no empty square within relocate range — Telesmash still resolves (SPEC §3, DEV-PIN 7)',
  fn() {
    // Victim cornered at (0,0); every on-board square within Chebyshev 2 is occupied.
    const s0 = mkBattle({ units: [
      { form: 'Archistrix', owner: 0, x: 2, y: 2 },
      { form: 'Bulwhark',   owner: 1, x: 0, y: 0 },
      { form: 'Mosskit',    owner: 0, x: 1, y: 0 },
      { form: 'Snapling',   owner: 0, x: 2, y: 0 },
      { form: 'Podling',    owner: 0, x: 0, y: 1 },
      { form: 'Zapkitt',    owner: 0, x: 1, y: 1 },
      { form: 'Gritling',   owner: 0, x: 2, y: 1 },
      { form: 'Cacklet',    owner: 0, x: 0, y: 2 },
      { form: 'Shadekit',   owner: 0, x: 1, y: 2 },
    ]});
    const s1 = GM.applyAction(s0, 0, { t: 'activate', unitId: 0 });
    assertThrows(() => GM.applyAction(s1, 0, { t: 'attack', kind: 'special', targetUnit: 1, relocateTo: { x: 1, y: 0 } }),
      'relocating onto an occupied square must throw');
    const s2 = GM.applyAction(s1, 0, { t: 'attack', kind: 'special', targetUnit: 1, relocateTo: null });
    assertEq(unit(s2, 1).pos, { x: 0, y: 0 }, 'victim stays in place');
    assertEq(unit(s2, 1).hp, 13, 'Telesmash still resolves: 1st grab = 1 (14−1)');
    assertEq(unit(s2, 1).telegrabs, 1, 'counter still increments');
  },
});

T.push({
  name: 'Telegrab works on Tavrik and on tyrant finals (not a Rival special) (SPEC §3 "Telegrab may target tyrants")',
  fn() {
    // Tavrik is grabbable — Tyrantbane only blocks RIVAL Specials/Auras.
    const vsTavrik = mkBattle({ turn: 1, units: [
      { form: 'Archistrix', owner: 1, x: 3, y: 3 },
      { form: 'Tavrik',     owner: 0, x: 5, y: 5 }, // Chebyshev 2 ≤ 3
    ]});
    const sa = act(vsTavrik, 1, 0, { attack: { kind: 'special', targetUnit: 1, relocateTo: { x: 5, y: 4 } } });
    assertEq(unit(sa, 1).hp, 7, 'Tavrik takes Telesmash 1 (8−1)');
    assertEq(unit(sa, 1).pos, { x: 5, y: 4 }, 'Tavrik relocated');
    assertEq(unit(sa, 1).telegrabs, 1, 'Tavrik counter increments');
    // A Rival final is equally grabbable.
    const vsRival = mkBattle({ units: [
      { form: 'Archistrix',   owner: 0, x: 3, y: 3 },
      { form: 'Tempestdrake', owner: 1, x: 5, y: 5 },
    ]});
    const sb = act(vsRival, 0, 0, { attack: { kind: 'special', targetUnit: 1, relocateTo: null } });
    assertEq(unit(sb, 1).hp, 12, 'Tempestdrake takes Telesmash 1 (13−1)');
    assertEq(unit(sb, 1).telegrabs, 1, 'tyrant counter increments');
  },
});

T.push({
  name: 'Telesmash is an attack: Dread −1 (min 1) applies, Hex +1 applies, never super-effective (DEV-PIN 20; CONTRACT pipeline)',
  fn() {
    // Dread: Archistrix adjacent to enemy Gravewinter; victim on 3rd grab: 3−1 = 2.
    const dread3 = mkBattle({ units: [
      { form: 'Archistrix',  owner: 0, x: 3, y: 3 },
      { form: 'Gravewinter', owner: 1, x: 4, y: 4 },
      { form: 'Bulwhark',    owner: 1, x: 3, y: 6, telegrabs: 2 },
    ]});
    const sa = act(dread3, 0, 0, { attack: { kind: 'special', targetUnit: 2, relocateTo: null } });
    assertEq(unit(sa, 2).hp, 12, '3rd grab: min(3,3)=3, Dread −1 = 2 (14−2)');
    // Dread min-1 clamp: 1st grab 1 − 1 -> still 1.
    const dread1 = mkBattle({ units: [
      { form: 'Archistrix',  owner: 0, x: 3, y: 3 },
      { form: 'Gravewinter', owner: 1, x: 4, y: 4 },
      { form: 'Bulwhark',    owner: 1, x: 3, y: 6 },
    ]});
    const sb = act(dread1, 0, 0, { attack: { kind: 'special', targetUnit: 2, relocateTo: null } });
    assertEq(unit(sb, 2).hp, 13, '1st grab 1 with Dread: clamped to minimum 1 (14−1)');
    // Hex: hexed victim takes 1+1 = 2 on a 1st grab. (Psychic doubles vs nothing — no SE anywhere here.)
    const hexed = mkBattle({ units: [
      { form: 'Archistrix', owner: 0, x: 3, y: 3 },
      { form: 'Bulwhark',   owner: 1, x: 3, y: 6, hexTurns: 2 },
    ]});
    const sc = act(hexed, 0, 0, { attack: { kind: 'special', targetUnit: 1, relocateTo: null } });
    assertEq(unit(sc, 1).hp, 12, 'hexed: 1st-grab Telesmash 1 + 1 Hex = 2 (14−2)');
  },
});

T.push({
  name: 'Telegrab counters survive the victim\'s evolution; v8 refresh heals ceil((8−5)/2)=2 -> 7/8 (SPEC §3 "Counters persist"; PATCH-V8 §4)',
  fn() {
    // Snapling (telegrabs 1, survived 2) evolves to Shellbrook at the start of its owner's turn.
    // v8 refresh: missing HP vs the NEW max 8 is 8−5=3 -> heal ceil(3/2)=2 -> 7/8. Counter persists.
    const s0 = mkBattle({ turn: 1, units: [
      { form: 'Snapling', owner: 0, x: 1, y: 1, telegrabs: 1, survived: 2 },
      { form: 'Bulwhark', owner: 1, x: 7, y: 7 },
    ]});
    const s = endTurn(s0, 1);
    assertEq(unit(s, 0).stage, 1, 'evolved to Shellbrook (survived 2 met)');
    assertEq(unit(s, 0).hp, 7, 'v8 refresh: 5 + ceil((8−5)/2) = 7 of new max 8');
    assertEq(unit(s, 0).telegrabs, 1, 'lifetime Telegrab counter survived evolution');
  },
});

module.exports = T;
