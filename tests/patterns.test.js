// Pattern geometry + focus tests. Expected values derived ONLY from SPEC.md §3/§6/§7
// and CONTRACT.md (DEV-PINS cited inline) — engine.js was NOT consulted.
// PATCH-V8: max HP per stage comes from data.js (PATCH-V8 §3 — authoritative);
// damage numbers are unchanged. HP figures below recomputed accordingly.
//
// Damage references (SPEC §6):
//   Stormbolt (Fulgurlynx, Electric)  Single 3, 4 dmg, Pin
//   Mindclaw  (Velvesper, Psychic)    Single 1, 3 dmg, Blink 2
//   Sunlance  (Grovewarden, Grass)    Lance 3, 3 dmg
//   Magma Stream (Pyroclasm, Fire)    Lance 3, 3 dmg, Burn 2, Recoil 2
//   Marrow Hurl (Ossiyena, Ground)    Lance 2, 1 dmg, Poison
//   Glacial Gore (Gravewinter, Ice)   Cone, 3 dmg, Chill 1 per enemy hit
//   Scorching Howl (Hellhowl, Fire)   Cone, 3 dmg, Push 1, Burn 1 (near square only)
//   Quill Burst (Galvaquill, Electric) Burst, 2 dmg
//   Maelstrom (Leviadon, Water)       Burst, 3 dmg, Push 1
//   Seed Mortar (Bombloom, Grass)     Bomb 2, 2 dmg, Pin (center only)
//   Arc Volley (Dynamoth, Electric)   Scatter R2 N3, 2 dmg each
//   Telegrab (Archistrix)             range 3, relocate 2, Telesmash 1→2→3
//   Telegrab (Parliowl)               range 2, relocate 1, no Telesmash
//
// mkBattle defaults: turn 0, playerTurns [1,0]. A Pin landing on an owner-1 unit
// sets pinnedTurn = playerTurns[1] + 1 = 1 (CONTRACT pin timing model).
const { GM, DATA, assert, assertEq, assertThrows, mkBattle, play, act, endTurn, unit, at } = require('./helpers.js');

// previewAttack on a mid-activation state (the moment the UI would call it).
function previewMid(state, player, unitId, params) {
  const s = GM.applyAction(state, player, { t: 'activate', unitId });
  return GM.previewAttack(s, unitId, params);
}

module.exports = [

  // ───────────────────────── Single ─────────────────────────

  {
    name: 'Single: projectile stops at FIRST enemy within R — Stormbolt 4 dmg, enemy behind it shielded (SPEC §3)',
    fn() {
      // Fulgurlynx(Electric) at (3,3); Stonehide(Ground, 8hp) at (3,5) and (3,6).
      // Ray N: (3,4) empty, (3,5) first unit = enemy → hit. Electric does not beat Ground → 4 dmg.
      const st = mkBattle({ units: [
        { form: 'Fulgurlynx', owner: 0, x: 3, y: 3 },
        { form: 'Stonehide', owner: 1, x: 3, y: 5 },
        { form: 'Stonehide', owner: 1, x: 3, y: 6 },
      ]});
      const s = act(st, 0, 0, { attack: { kind: 'special', dir: { dx: 0, dy: 1 } } });
      assertEq(unit(s, 1).hp, 4, 'first enemy takes 4 (8→4)');
      assertEq(unit(s, 2).hp, 8, 'enemy behind the first unit is shielded');
      assertEq(unit(s, 1).pinnedTurn, 1, 'Stormbolt Pin: pinnedTurn = playerTurns[1]+1 = 1');
      assertEq(unit(s, 2).pinnedTurn, 0, 'shielded enemy not pinned');
    },
  },

  {
    name: 'Single: diagonal direction legal — Stormbolt NE hits at exactly range 3 (SPEC §3: 8 directions)',
    fn() {
      // (2,2) → NE ray (3,3),(4,4) empty, (5,5) Stonehide = 3rd square (within R3).
      const st = mkBattle({ units: [
        { form: 'Fulgurlynx', owner: 0, x: 2, y: 2 },
        { form: 'Stonehide', owner: 1, x: 5, y: 5 },
      ]});
      const s = act(st, 0, 0, { attack: { kind: 'special', dir: { dx: 1, dy: 1 } } });
      assertEq(unit(s, 1).hp, 4, 'diagonal target takes 4 (8→4)');
      assertEq(unit(s, 1).pinnedTurn, 1, 'pinned');
    },
  },

  {
    name: 'Single: ally is first unit on the ray → shot blocked, ILLEGAL declaration (SPEC §3)',
    fn() {
      const st = mkBattle({ units: [
        { form: 'Fulgurlynx', owner: 0, x: 3, y: 3 },
        { form: 'Zapkitt', owner: 0, x: 3, y: 4 },     // ally body blocks
        { form: 'Stonehide', owner: 1, x: 3, y: 5 },   // enemy behind ally
      ]});
      assertThrows(() => act(st, 0, 0, { attack: { kind: 'special', dir: { dx: 0, dy: 1 } } }),
        'single through an ally body must be rejected');
    },
  },

  {
    name: 'Single: first unit beyond range R → illegal; non-direction vector → illegal (DEV-PIN 1)',
    fn() {
      // Stormbolt R3; enemy at distance 4 — ray within R is empty → attack hits no enemy.
      const st = mkBattle({ units: [
        { form: 'Fulgurlynx', owner: 0, x: 3, y: 3 },
        { form: 'Stonehide', owner: 1, x: 3, y: 7 },
      ]});
      assertThrows(() => act(st, 0, 0, { attack: { kind: 'special', dir: { dx: 0, dy: 1 } } }),
        'enemy beyond R: no unit within range → illegal');
      assertThrows(() => act(st, 0, 0, { attack: { kind: 'special', dir: { dx: 1, dy: 2 } } }),
        '(1,2) is not one of the 8 directions');
    },
  },

  {
    name: 'Single: attack-into-nothing illegal — Mindclaw at empty square cannot grant a free Blink (DEV-PIN 1)',
    fn() {
      // Mindclaw R1: (3,4) is empty, only enemy is 2 away → declaration hits no enemy.
      const st = mkBattle({ units: [
        { form: 'Velvesper', owner: 0, x: 3, y: 3 },
        { form: 'Snapling', owner: 1, x: 3, y: 5 },
      ]});
      assertThrows(() => act(st, 0, 0, {
        attack: { kind: 'special', dir: { dx: 0, dy: 1 }, blinkTo: { x: 5, y: 3 } },
      }), 'Mindclaw into empty square must throw — no free Blink');
    },
  },

  {
    name: 'Single: super-effective auto-doubles its one target — Stormbolt 8 vs Flying, 4 vs Ground (§7 Electric beats Flying)',
    fn() {
      const a = mkBattle({ units: [
        { form: 'Fulgurlynx', owner: 0, x: 3, y: 3 },
        { form: 'Galewyrm', owner: 1, x: 3, y: 4 },   // Flying, 7hp
      ]});
      const sa = act(a, 0, 0, { attack: { kind: 'special', dir: { dx: 0, dy: 1 } } });
      assert(unit(sa, 1).pos === null, 'Galewyrm: 4×2=8 ≥ 7hp → KO, pos null');

      const b = mkBattle({ units: [
        { form: 'Fulgurlynx', owner: 0, x: 3, y: 3 },
        { form: 'Stonehide', owner: 1, x: 3, y: 4 },  // Ground, 8hp — not doubled
      ]});
      const sb = act(b, 0, 0, { attack: { kind: 'special', dir: { dx: 0, dy: 1 } } });
      assertEq(unit(sb, 1).hp, 4, 'Stonehide takes plain 4 (8→4)');
    },
  },

  // ───────────────────────── Lance ─────────────────────────

  {
    name: 'Lance: hits EVERY enemy in first R squares, pierces enemies — Sunlance 3 dmg to all three, 4th square untouched',
    fn() {
      // Grovewarden(Grass) R3 N from (3,3): squares (3,4),(3,5),(3,6). Enemy at (3,7) is beyond R.
      // Types Flying/Flying/Psychic — Grass beats none of them → no doubling anywhere.
      const st = mkBattle({ units: [
        { form: 'Grovewarden', owner: 0, x: 3, y: 3 },
        { form: 'Wyrmlet', owner: 1, x: 3, y: 4 },
        { form: 'Falchick', owner: 1, x: 3, y: 5 },
        { form: 'Hootle', owner: 1, x: 3, y: 6 },
        { form: 'Hootle', owner: 1, x: 3, y: 7 },
      ]});
      const s = act(st, 0, 0, { attack: { kind: 'special', dir: { dx: 0, dy: 1 } } });
      assertEq(unit(s, 1).hp, 2, '1st enemy 5→2 (pierce does not stop)');
      assertEq(unit(s, 2).hp, 2, '2nd enemy 5→2');
      assertEq(unit(s, 3).hp, 2, '3rd enemy 5→2');
      assertEq(unit(s, 4).hp, 5, 'square 4 is beyond R3 — untouched');
    },
  },

  {
    name: 'Lance: passes over ally harmlessly — Magma Stream burns both enemies (Burn 2, 2 ticks), ally takes nothing, Recoil 2 (SPEC §3/§6)',
    fn() {
      // Pyroclasm(Fire) R3 N from (3,3): ally on (3,4), enemies (Water — Fire doesn't beat) on (3,5),(3,6).
      const st = mkBattle({ units: [
        { form: 'Pyroclasm', owner: 0, x: 3, y: 3 },
        { form: 'Mosskit', owner: 0, x: 3, y: 4 },    // ally on the path
        { form: 'Snapling', owner: 1, x: 3, y: 5 },
        { form: 'Snapling', owner: 1, x: 3, y: 6 },
      ]});
      const s = act(st, 0, 0, { attack: { kind: 'special', dir: { dx: 0, dy: 1 } } });
      assertEq(unit(s, 1).hp, 5, 'ally on lance path takes 0');
      assert(unit(s, 1).burn === null, 'ally gets no Burn (friendly fire off)');
      assertEq(unit(s, 2).hp, 2, 'enemy beyond ally takes 3 (5→2)');
      assertEq(unit(s, 3).hp, 2, 'second enemy takes 3 (5→2)');
      assert(unit(s, 2).burn && unit(s, 2).burn.n === 2 && unit(s, 2).burn.ticks === 2, 'Burn 2 / 2 ticks on enemy 1');
      assert(unit(s, 3).burn && unit(s, 3).burn.n === 2 && unit(s, 3).burn.ticks === 2, 'Burn 2 / 2 ticks on enemy 2');
      assertEq(unit(s, 0).hp, 7, 'Recoil 2: Pyroclasm 9→7');
      assertEq(unit(s, 0).dealt, 6, 'dealt credit 3+3 (DEV-PIN 8)');
    },
  },

  {
    name: 'Lance: path containing only an ally hits no enemy → illegal (DEV-PIN 1)',
    fn() {
      const st = mkBattle({ units: [
        { form: 'Grovewarden', owner: 0, x: 3, y: 3 },
        { form: 'Mosskit', owner: 0, x: 3, y: 5 },     // only an ally on the N path
        { form: 'Snapling', owner: 1, x: 0, y: 0 },    // enemy exists, but not on this ray
      ]});
      assertThrows(() => act(st, 0, 0, { attack: { kind: 'special', dir: { dx: 0, dy: 1 } } }),
        'lance hitting zero enemies must be rejected');
    },
  },

  {
    name: 'Lance: range limit — Marrow Hurl R2 hits only the first 2 squares; Poison 1 stack each, no damage doubling (Ground vs Water)',
    fn() {
      const st = mkBattle({ units: [
        { form: 'Ossiyena', owner: 0, x: 3, y: 3 },
        { form: 'Snapling', owner: 1, x: 3, y: 4 },
        { form: 'Snapling', owner: 1, x: 3, y: 5 },
        { form: 'Snapling', owner: 1, x: 3, y: 6 },   // 3rd square — beyond R2
      ]});
      const s = act(st, 0, 0, { attack: { kind: 'special', dir: { dx: 0, dy: 1 } } });
      assertEq(unit(s, 1).hp, 4, 'square 1: 1 dmg (5→4)');
      assertEq(unit(s, 2).hp, 4, 'square 2: 1 dmg (5→4)');
      assertEq(unit(s, 1).poison, 1, 'Poison stack on hit 1');
      assertEq(unit(s, 2).poison, 1, 'Poison stack on hit 2');
      assertEq(unit(s, 3).hp, 5, 'beyond R2: untouched');
      assertEq(unit(s, 3).poison, 0, 'beyond R2: no poison');
    },
  },

  {
    name: 'Lance focus: only the FIRST unit hit is ×2-eligible — Sunlance: near Water enemy auto-doubled (6), far Water enemy takes 3 (SPEC §3)',
    fn() {
      // Grass beats Water; both hit units are Water but only the nearest is eligible
      // → exactly 1 eligible → auto-focus, no focus field needed.
      const st = mkBattle({ units: [
        { form: 'Grovewarden', owner: 0, x: 3, y: 3 },
        { form: 'Snapling', owner: 1, x: 3, y: 4 },   // first hit: 3×2=6 ≥ 5hp → KO
        { form: 'Snapling', owner: 1, x: 3, y: 5 },   // second hit: plain 3
      ]});
      const p = previewMid(st, 0, 0, { t: 'attack', kind: 'special', dir: { dx: 0, dy: 1 } });
      assert(!p.needsFocus, 'one eligible → auto-resolve, needsFocus false');
      assertEq([...p.focusEligible].sort((a, b) => a - b), [1], 'only the first-hit unit is eligible');
      const s = act(st, 0, 0, { attack: { kind: 'special', dir: { dx: 0, dy: 1 } } });
      assert(unit(s, 1).pos === null, 'first hit doubled: 6 ≥ 5hp → KO');
      assertEq(unit(s, 2).hp, 2, 'second hit NOT doubled: 5−3=2');
    },
  },

  // ───────────────────────── Cone ─────────────────────────

  {
    name: 'Cone: exact hit set = near square + 3 squares in the row beyond (filled 4-square triangle) — Glacial Gore, Chill 1 each (SPEC §3)',
    fn() {
      // Gravewinter at (3,3), cone N → hits (3,4),(2,5),(3,5),(4,5) ONLY.
      // Targets are Water (Ice beats Grass/Ground/Flying) → no doubling, no focus.
      const st = mkBattle({ units: [
        { form: 'Gravewinter', owner: 0, x: 3, y: 3 },
        { form: 'Snapling', owner: 1, x: 3, y: 4 },   // near
        { form: 'Snapling', owner: 1, x: 2, y: 5 },   // beyond-left
        { form: 'Snapling', owner: 1, x: 3, y: 5 },   // beyond-mid
        { form: 'Snapling', owner: 1, x: 4, y: 5 },   // beyond-right
        { form: 'Snapling', owner: 1, x: 2, y: 4 },   // NOT a cone square
        { form: 'Snapling', owner: 1, x: 3, y: 6 },   // NOT a cone square
      ]});
      const s = act(st, 0, 0, { attack: { kind: 'special', dir: { dx: 0, dy: 1 } } });
      for (const id of [1, 2, 3, 4]) {
        assertEq(unit(s, id).hp, 2, `cone square unit ${id} takes 3 (5→2)`);
        assertEq(unit(s, id).chill, 1, `cone square unit ${id} gains Chill 1`);
      }
      assertEq(unit(s, 5).hp, 5, '(2,4) diagonal-adjacent is NOT in the cone');
      assertEq(unit(s, 6).hp, 5, '(3,6) third row is NOT in the cone');
      assertEq(unit(s, 5).chill, 0, 'no chill outside the cone');
      assertEq(unit(s, 6).chill, 0, 'no chill outside the cone');
    },
  },

  {
    name: 'Cone: direction chosen freely regardless of facing (DEV-PIN 6) — Scorching Howl fired S while facing N; near-square Burn; Push cancelled into ally; ally on hit square unaffected',
    fn() {
      // Hellhowl(Fire) at (3,3), default facing N, declares cone S → hits (3,2),(2,1),(3,1),(4,1).
      // Gritling(Ground — Fire doesn't beat) on near square (3,2): 3 dmg.
      // Push away from attacker = (3,1), occupied by ALLY → push cancelled (SPEC §3, DEV-PIN 14).
      // Burn 1 lands on the near-square enemy only (DEV-PIN 13). Ally on (3,1) hit square: nothing.
      const st = mkBattle({ units: [
        { form: 'Hellhowl', owner: 0, x: 3, y: 3 },
        { form: 'Gritling', owner: 1, x: 3, y: 2 },
        { form: 'Sootpup', owner: 0, x: 3, y: 1 },
      ]});
      const s = act(st, 0, 0, { attack: { kind: 'special', dir: { dx: 0, dy: -1 } } });
      assertEq(unit(s, 1).hp, 2, 'near enemy takes 3 (5→2) despite attacker facing N');
      assert(unit(s, 1).pos.x === 3 && unit(s, 1).pos.y === 2, 'push cancelled — destination occupied');
      assert(unit(s, 1).burn && unit(s, 1).burn.n === 1 && unit(s, 1).burn.ticks === 2, 'Burn 1 / 2 ticks on near-square enemy');
      assertEq(unit(s, 2).hp, 5, 'ally on cone square takes 0');
      assert(unit(s, 2).burn === null, 'ally never burned');
      assertEq(unit(s, 0).facing, 'N', 'attacking does not change facing');
    },
  },

  {
    name: 'Cone: off-board truncation — attacker at x=0 hits the remaining on-board cone squares',
    fn() {
      // Gravewinter at (0,3), cone N → on-board squares (0,4),(0,5),(1,5); (-1,5) doesn't exist.
      const st = mkBattle({ units: [
        { form: 'Gravewinter', owner: 0, x: 0, y: 3 },
        { form: 'Snapling', owner: 1, x: 0, y: 4 },
        { form: 'Snapling', owner: 1, x: 1, y: 5 },
        { form: 'Snapling', owner: 1, x: 2, y: 5 },   // outside the truncated cone
      ]});
      const s = act(st, 0, 0, { attack: { kind: 'special', dir: { dx: 0, dy: 1 } } });
      assertEq(unit(s, 1).hp, 2, 'near square hit (5→2)');
      assertEq(unit(s, 2).hp, 2, 'on-board beyond square hit (5→2)');
      assertEq(unit(s, 3).hp, 5, '(2,5) is not a cone square');
    },
  },

  {
    name: 'Cone: fully off-board cone → illegal (DEV-PIN 1); diagonal cone direction → illegal (SPEC §3: 4 orthogonal facings)',
    fn() {
      const st = mkBattle({ units: [
        { form: 'Hellhowl', owner: 0, x: 3, y: 7 },
        { form: 'Gritling', owner: 1, x: 3, y: 5 },
      ]});
      assertThrows(() => act(st, 0, 0, { attack: { kind: 'special', dir: { dx: 0, dy: 1 } } }),
        'cone N from y=7 has zero on-board squares → must throw');
      assertThrows(() => act(st, 0, 0, { attack: { kind: 'special', dir: { dx: 1, dy: 1 } } }),
        'cone direction must be one of the 4 cardinals');
    },
  },

  {
    name: 'Cone focus: 2 eligible enemies → needsFocus true, missing focus rejected, chosen focus doubled exactly once (Glacial Gore vs 2 Flying)',
    fn() {
      // Ice beats Flying. Wyrmlets (5hp) on (3,4) and (2,5) — both in cone N from (3,3).
      const st = mkBattle({ units: [
        { form: 'Gravewinter', owner: 0, x: 3, y: 3 },
        { form: 'Wyrmlet', owner: 1, x: 3, y: 4 },
        { form: 'Wyrmlet', owner: 1, x: 2, y: 5 },
      ]});
      const s1 = GM.applyAction(st, 0, { t: 'activate', unitId: 0 });
      const p = GM.previewAttack(s1, 0, { t: 'attack', kind: 'special', dir: { dx: 0, dy: 1 } });
      assert(p.needsFocus === true, '2 super-effective-eligible hits → needsFocus');
      assertEq([...p.focusEligible].sort((a, b) => a - b), [1, 2], 'both Flying units eligible');
      assertThrows(() => GM.applyAction(s1, 0, { t: 'attack', kind: 'special', dir: { dx: 0, dy: 1 } }),
        'omitting focus with ≥2 eligible must throw');
      const s2 = GM.applyAction(s1, 0, { t: 'attack', kind: 'special', dir: { dx: 0, dy: 1 }, focus: 1 });
      assert(unit(s2, 1).pos === null, 'focus unit doubled: 3×2=6 ≥ 5hp → KO');
      assertEq(unit(s2, 2).hp, 2, 'other hit unit takes plain 3 (5→2) — at most ONE unit doubled');
    },
  },

  // ───────────────────────── Burst ─────────────────────────

  {
    name: 'Burst: hits exactly the 8 adjacent squares — Quill Burst 2 dmg each, distance-2 enemy untouched (SPEC §3)',
    fn() {
      const adj = [[2, 2], [3, 2], [4, 2], [2, 3], [4, 3], [2, 4], [3, 4], [4, 4]];
      // Gritlings are Ground — Electric beats Water/Flying only → 0 eligible, no focus.
      const st = mkBattle({ units: [
        { form: 'Galvaquill', owner: 0, x: 3, y: 3 },
        ...adj.map(([x, y]) => ({ form: 'Gritling', owner: 1, x, y })),
        { form: 'Gritling', owner: 1, x: 3, y: 5 },   // 2 away — not hit
      ]});
      const s = act(st, 0, 0, { attack: { kind: 'special' } });
      for (let id = 1; id <= 8; id++) assertEq(unit(s, id).hp, 3, `adjacent enemy ${id} takes 2 (5→3)`);
      assertEq(unit(s, 9).hp, 5, 'non-adjacent enemy untouched');
    },
  },

  {
    name: 'Burst: friendly fire off — Maelstrom damages and pushes adjacent enemies only; adjacent allies untouched and unmoved (SPEC §3)',
    fn() {
      // Leviadon(Water) at (3,3). Enemies Mosskit(Grass — Water doesn't beat) at (4,3),(3,2):
      // 3 dmg each, pushed 1 away (DEV-PIN 14 sign vector): (4,3)→(5,3), (3,2)→(3,1).
      const st = mkBattle({ units: [
        { form: 'Leviadon', owner: 0, x: 3, y: 3 },
        { form: 'Guppling', owner: 0, x: 2, y: 3 },
        { form: 'Guppling', owner: 0, x: 3, y: 4 },
        { form: 'Mosskit', owner: 1, x: 4, y: 3 },
        { form: 'Mosskit', owner: 1, x: 3, y: 2 },
      ]});
      const s = act(st, 0, 0, { attack: { kind: 'special' } });
      assertEq(unit(s, 3).hp, 2, 'enemy E takes 3 (5→2)');
      assertEq(unit(s, 4).hp, 2, 'enemy S takes 3 (5→2)');
      assert(unit(s, 3).pos.x === 5 && unit(s, 3).pos.y === 3, 'enemy E pushed to (5,3)');
      assert(unit(s, 4).pos.x === 3 && unit(s, 4).pos.y === 1, 'enemy S pushed to (3,1)');
      assertEq(unit(s, 1).hp, 4, 'ally W untouched');
      assertEq(unit(s, 2).hp, 4, 'ally N untouched');
      assert(unit(s, 1).pos.x === 2 && unit(s, 1).pos.y === 3, 'ally W not pushed');
      assert(unit(s, 2).pos.x === 3 && unit(s, 2).pos.y === 4, 'ally N not pushed');
    },
  },

  {
    name: 'Burst: adjacent ally but zero adjacent enemies → illegal (DEV-PIN 1)',
    fn() {
      const st = mkBattle({ units: [
        { form: 'Leviadon', owner: 0, x: 3, y: 3 },
        { form: 'Guppling', owner: 0, x: 3, y: 4 },
        { form: 'Mosskit', owner: 1, x: 0, y: 0 },
      ]});
      assertThrows(() => act(st, 0, 0, { attack: { kind: 'special' } }),
        'burst with no adjacent enemy must throw');
    },
  },

  // ───────────────────────── Bomb ─────────────────────────

  {
    name: 'Bomb: plus-shape = target + 4 orthogonal neighbors; Seed Mortar Pin lands ONLY on the center unit (SPEC §3 pinned exception)',
    fn() {
      // Bombloom at (3,3), target (3,5) (straight N, distance 2 = R).
      // Plus = (3,5),(2,5),(4,5),(3,4),(3,6). Wyrmlets are Flying — Grass beats Water/Ground → no focus.
      const st = mkBattle({ units: [
        { form: 'Bombloom', owner: 0, x: 3, y: 3 },
        { form: 'Wyrmlet', owner: 1, x: 3, y: 5 },   // center
        { form: 'Wyrmlet', owner: 1, x: 2, y: 5 },   // west arm
        { form: 'Wyrmlet', owner: 1, x: 3, y: 6 },   // north arm
        { form: 'Wyrmlet', owner: 1, x: 4, y: 6 },   // NOT in the plus
      ]});
      const s = act(st, 0, 0, { attack: { kind: 'special', target: { x: 3, y: 5 } } });
      assertEq(unit(s, 1).hp, 3, 'center takes 2 (5→3)');
      assertEq(unit(s, 2).hp, 3, 'west arm takes 2 (5→3)');
      assertEq(unit(s, 3).hp, 3, 'north arm takes 2 (5→3)');
      assertEq(unit(s, 4).hp, 5, 'diagonal of center is NOT hit');
      assertEq(unit(s, 1).pinnedTurn, 1, 'center unit pinned (pinnedTurn = 1)');
      assertEq(unit(s, 2).pinnedTurn, 0, 'arm unit NOT pinned (center-only)');
      assertEq(unit(s, 3).pinnedTurn, 0, 'arm unit NOT pinned (center-only)');
    },
  },

  {
    name: 'Bomb: lob ignores intervening units; ally standing on a plus square is unaffected (SPEC §3)',
    fn() {
      // Ally on (3,4) both blocks the straight line AND sits in the plus of target (3,5) — neither matters.
      const st = mkBattle({ units: [
        { form: 'Bombloom', owner: 0, x: 3, y: 3 },
        { form: 'Mosskit', owner: 0, x: 3, y: 4 },
        { form: 'Wyrmlet', owner: 1, x: 3, y: 5 },
      ]});
      const s = act(st, 0, 0, { attack: { kind: 'special', target: { x: 3, y: 5 } } });
      assertEq(unit(s, 2).hp, 3, 'enemy at center takes 2 despite the intervening ally');
      assertEq(unit(s, 2).pinnedTurn, 1, 'center pinned');
      assertEq(unit(s, 1).hp, 5, 'ally on plus square takes 0');
      assertEq(unit(s, 1).pinnedTurn, 0, 'ally never pinned');
    },
  },

  {
    name: 'Bomb: off-line target, beyond-range target, and enemy-less plus are all illegal (SPEC §3 straight-line + DEV-PIN 1)',
    fn() {
      const st = mkBattle({ units: [
        { form: 'Bombloom', owner: 0, x: 3, y: 3 },
        { form: 'Wyrmlet', owner: 1, x: 4, y: 5 },   // (Δ1,Δ2): not row/col/exact diagonal
        { form: 'Wyrmlet', owner: 1, x: 3, y: 6 },   // straight N but distance 3 > R2
      ]});
      assertThrows(() => act(st, 0, 0, { attack: { kind: 'special', target: { x: 4, y: 5 } } }),
        'target not on a straight 8-direction line → illegal');
      assertThrows(() => act(st, 0, 0, { attack: { kind: 'special', target: { x: 3, y: 6 } } }),
        'target beyond R2 → illegal');
      assertThrows(() => act(st, 0, 0, { attack: { kind: 'special', target: { x: 1, y: 3 } } }),
        'legal lob square but plus contains no enemy → illegal (DEV-PIN 1)');
    },
  },

  {
    name: 'Bomb: exact-diagonal target is a legal straight line (CONTRACT geometry: row, column, or exact diagonal)',
    fn() {
      // Target (5,5) from (3,3): Δ(2,2) diagonal, distance 2 = R. Plus = (5,5),(4,5),(6,5),(5,4),(5,6).
      const st = mkBattle({ units: [
        { form: 'Bombloom', owner: 0, x: 3, y: 3 },
        { form: 'Hootle', owner: 1, x: 5, y: 5 },
        { form: 'Hootle', owner: 1, x: 5, y: 4 },
      ]});
      const s = act(st, 0, 0, { attack: { kind: 'special', target: { x: 5, y: 5 } } });
      assertEq(unit(s, 1).hp, 3, 'diagonal center takes 2 (5→3)');
      assertEq(unit(s, 2).hp, 3, 'south arm takes 2 (5→3)');
      assertEq(unit(s, 1).pinnedTurn, 1, 'center pinned');
      assertEq(unit(s, 2).pinnedTurn, 0, 'arm not pinned');
    },
  },

  // ───────────────────────── Scatter ─────────────────────────

  {
    name: 'Scatter: 3 distinct squares, each within Manhattan 2, each hit for 2 (Arc Volley R2 N3)',
    fn() {
      // Dynamoth(Electric) at (3,3). Squares Manhattan distances: (3,5)=2, (4,4)=2, (2,2)=2.
      // Targets Ground/Grass/Psychic — Electric beats Water/Flying → no focus.
      const st = mkBattle({ units: [
        { form: 'Dynamoth', owner: 0, x: 3, y: 3 },
        { form: 'Gritling', owner: 1, x: 3, y: 5 },
        { form: 'Mosskit', owner: 1, x: 4, y: 4 },
        { form: 'Hootle', owner: 1, x: 2, y: 2 },
      ]});
      const s = act(st, 0, 0, { attack: { kind: 'special', squares: [{ x: 3, y: 5 }, { x: 4, y: 4 }, { x: 2, y: 2 }] } });
      assertEq(unit(s, 1).hp, 3, '(3,5) takes 2 (5→3)');
      assertEq(unit(s, 2).hp, 3, '(4,4) takes 2 (5→3)');
      assertEq(unit(s, 3).hp, 3, '(2,2) takes 2 (5→3)');
    },
  },

  {
    name: 'Scatter: duplicate squares rejected (SPEC §3: N DISTINCT squares)',
    fn() {
      const st = mkBattle({ units: [
        { form: 'Dynamoth', owner: 0, x: 3, y: 3 },
        { form: 'Gritling', owner: 1, x: 3, y: 4 },
      ]});
      assertThrows(() => act(st, 0, 0, { attack: { kind: 'special', squares: [{ x: 3, y: 4 }, { x: 3, y: 4 }] } }),
        'choosing the same square twice must throw');
    },
  },

  {
    name: 'Scatter: range is MANHATTAN — (Δ2,Δ2) (Chebyshev 2, Manhattan 4) rejected; (Δ1,Δ1) (Manhattan 2) legal',
    fn() {
      const st = mkBattle({ units: [
        { form: 'Dynamoth', owner: 0, x: 3, y: 3 },
        { form: 'Gritling', owner: 1, x: 5, y: 5 },   // Manhattan 4 > R2
        { form: 'Mosskit', owner: 1, x: 4, y: 4 },    // Manhattan 2 = R
      ]});
      assertThrows(() => act(st, 0, 0, { attack: { kind: 'special', squares: [{ x: 5, y: 5 }] } }),
        'Manhattan 4 square must be rejected even though Chebyshev is 2');
      const s = act(st, 0, 0, { attack: { kind: 'special', squares: [{ x: 4, y: 4 }] } });
      assertEq(unit(s, 2).hp, 3, 'Manhattan-2 diagonal square is legal: 2 dmg (5→3)');
    },
  },

  {
    name: 'Scatter: more than N squares rejected (Arc Volley N=3)',
    fn() {
      const st = mkBattle({ units: [
        { form: 'Dynamoth', owner: 0, x: 3, y: 3 },
        { form: 'Gritling', owner: 1, x: 3, y: 4 },
        { form: 'Gritling', owner: 1, x: 4, y: 3 },
        { form: 'Gritling', owner: 1, x: 3, y: 2 },
        { form: 'Gritling', owner: 1, x: 2, y: 3 },
      ]});
      assertThrows(() => act(st, 0, 0, {
        attack: { kind: 'special', squares: [{ x: 3, y: 4 }, { x: 4, y: 3 }, { x: 3, y: 2 }, { x: 2, y: 3 }] },
      }), '4 squares with N=3 must throw');
    },
  },

  {
    name: 'Scatter: ally square may be chosen but ally is unaffected; selection with NO enemy square is illegal (friendly fire off + DEV-PIN 1)',
    fn() {
      const st = mkBattle({ units: [
        { form: 'Dynamoth', owner: 0, x: 3, y: 3 },
        { form: 'Coilbug', owner: 0, x: 2, y: 3 },    // ally
        { form: 'Gritling', owner: 1, x: 4, y: 3 },   // enemy
      ]});
      const s = act(st, 0, 0, { attack: { kind: 'special', squares: [{ x: 2, y: 3 }, { x: 4, y: 3 }] } });
      assertEq(unit(s, 1).hp, 5, 'ally on chosen square takes 0');
      assertEq(unit(s, 2).hp, 3, 'enemy takes 2 (5→3)');
      assertThrows(() => act(st, 0, 0, { attack: { kind: 'special', squares: [{ x: 2, y: 3 }] } }),
        'scatter hitting only an ally must throw (no enemy hit)');
    },
  },

  // ───────────────────────── Telegrab ─────────────────────────

  {
    name: 'Telegrab: Chebyshev range 3 (diagonal — Manhattan 6), NOT blocked by intervening units; relocate 2; Telesmash 1 on first grab (DEV-PIN 7)',
    fn() {
      // Archistrix at (3,3) grabs the Wyrmlet at (6,6): Chebyshev 3 exactly; bodies at (4,4) and (5,5)
      // sit directly on the line and must not block. Relocate to (6,4): Chebyshev 2 from victim, empty.
      // Telesmash = lifetime count including this grab = 1 → 1 dmg (Psychic: never super-effective).
      const st = mkBattle({ units: [
        { form: 'Archistrix', owner: 0, x: 3, y: 3 },
        { form: 'Hootle', owner: 0, x: 4, y: 4 },
        { form: 'Snapling', owner: 1, x: 5, y: 5 },
        { form: 'Wyrmlet', owner: 1, x: 6, y: 6 },
      ]});
      const s = act(st, 0, 0, { attack: { kind: 'special', targetUnit: 3, relocateTo: { x: 6, y: 4 } } });
      assert(unit(s, 3).pos.x === 6 && unit(s, 3).pos.y === 4, 'victim relocated to (6,4)');
      assertEq(unit(s, 3).hp, 4, 'Telesmash 1st grab = 1 dmg (5→4)');
      assertEq(unit(s, 3).telegrabs, 1, 'lifetime grab counter = 1');
    },
  },

  {
    name: 'Telegrab: target beyond Chebyshev 3 rejected; ally target rejected (DEV-PIN 1: enemy target required)',
    fn() {
      const st = mkBattle({ units: [
        { form: 'Archistrix', owner: 0, x: 3, y: 3 },
        { form: 'Hootle', owner: 0, x: 4, y: 4 },     // ally
        { form: 'Wyrmlet', owner: 1, x: 3, y: 7 },    // Chebyshev 4
      ]});
      assertThrows(() => act(st, 0, 0, { attack: { kind: 'special', targetUnit: 2, relocateTo: null } }),
        'Chebyshev 4 > range 3 must throw');
      assertThrows(() => act(st, 0, 0, { attack: { kind: 'special', targetUnit: 1, relocateTo: null } }),
        'telegrabbing an ally must throw');
    },
  },

  {
    name: 'Telegrab (Parliowl): range 2 Chebyshev, relocate ≤1, null relocate leaves victim in place, NO Telesmash damage, counter still increments (DEV-PIN 7)',
    fn() {
      const st = mkBattle({ units: [
        { form: 'Parliowl', owner: 0, x: 3, y: 3 },
        { form: 'Wyrmlet', owner: 1, x: 5, y: 5 },    // Chebyshev 2 — in range
        { form: 'Wyrmlet', owner: 1, x: 6, y: 6 },    // Chebyshev 3 — out of range
      ]});
      const s = act(st, 0, 0, { attack: { kind: 'special', targetUnit: 1, relocateTo: null } });
      assert(unit(s, 1).pos.x === 5 && unit(s, 1).pos.y === 5, 'relocateTo null → victim stays put');
      assertEq(unit(s, 1).hp, 5, 'weakened grab deals 0 damage');
      assertEq(unit(s, 1).telegrabs, 1, 'lifetime counter increments anyway');
      assertThrows(() => act(st, 0, 0, { attack: { kind: 'special', targetUnit: 1, relocateTo: { x: 5, y: 3 } } }),
        'relocation Chebyshev 2 > relocate 1 must throw');
      assertThrows(() => act(st, 0, 0, { attack: { kind: 'special', targetUnit: 2, relocateTo: null } }),
        'Chebyshev 3 > range 2 must throw');
    },
  },

  // ───────────────────────── Basic ─────────────────────────

  {
    name: 'Basic: 2 dmg, doubled iff attacker type beats target — Fire Basic deals 4 to a Grass (5→1); plain 2 to Water via diagonal adjacency (§7)',
    fn() {
      const a = mkBattle({ units: [
        { form: 'Cinderling', owner: 0, x: 3, y: 3 },
        { form: 'Mosskit', owner: 1, x: 3, y: 4 },    // Grass: 2×2=4 → 5→1 (plain 2 would leave 3)
      ]});
      const sa = act(a, 0, 0, { attack: { kind: 'basic', target: { x: 3, y: 4 } } });
      assertEq(unit(sa, 1).hp, 1, 'Fire basic vs Grass doubled: 2×2=4 (5→1)');

      const b = mkBattle({ units: [
        { form: 'Cinderling', owner: 0, x: 3, y: 3 },
        { form: 'Snapling', owner: 1, x: 4, y: 4 },   // diagonal-adjacent Water
      ]});
      const sb = act(b, 0, 0, { attack: { kind: 'basic', target: { x: 4, y: 4 } } });
      assertEq(unit(sb, 1).hp, 3, 'Fire basic vs Water: plain 2 (5→3), diagonal target legal');
    },
  },

  {
    name: 'Basic: non-adjacent enemy, ally, and empty adjacent square are all illegal targets (SPEC §3 + DEV-PIN 1)',
    fn() {
      const st = mkBattle({ units: [
        { form: 'Cinderling', owner: 0, x: 3, y: 3 },
        { form: 'Mosskit', owner: 0, x: 2, y: 3 },     // adjacent ally
        { form: 'Snapling', owner: 1, x: 3, y: 5 },    // enemy 2 away
      ]});
      assertThrows(() => act(st, 0, 0, { attack: { kind: 'basic', target: { x: 3, y: 5 } } }),
        'basic at a non-adjacent enemy must throw');
      assertThrows(() => act(st, 0, 0, { attack: { kind: 'basic', target: { x: 2, y: 3 } } }),
        'basic at an ally must throw (basics target enemies only)');
      assertThrows(() => act(st, 0, 0, { attack: { kind: 'basic', target: { x: 4, y: 3 } } }),
        'basic at an empty square must throw');
    },
  },

  {
    name: 'Basic: Guppling deals 1; evolved Leviadon deals the standard 2 (SPEC §6 + DEV-PIN 21)',
    fn() {
      const a = mkBattle({ units: [
        { form: 'Guppling', owner: 0, x: 3, y: 3 },
        { form: 'Snapling', owner: 1, x: 3, y: 4 },   // Water vs Water — no doubling
      ]});
      const sa = act(a, 0, 0, { attack: { kind: 'basic', target: { x: 3, y: 4 } } });
      assertEq(unit(sa, 1).hp, 4, 'Guppling basic = 1 (5→4)');

      const b = mkBattle({ units: [
        { form: 'Leviadon', owner: 0, x: 3, y: 3 },
        { form: 'Wyrmlet', owner: 1, x: 3, y: 4 },    // Water vs Flying — no doubling
      ]});
      const sb = act(b, 0, 0, { attack: { kind: 'basic', target: { x: 3, y: 4 } } });
      assertEq(unit(sb, 1).hp, 3, 'Leviadon basic = 2 (5→3)');
    },
  },

  // ───────────────────────── Focus enforcement (multi-hit) ─────────────────────────

  {
    name: 'Focus: ≥2 eligible → previewAttack needsFocus true; applyAction without focus throws; chosen focus doubled, other takes base (Quill Burst vs 2 Water)',
    fn() {
      // Galvaquill(Electric) — beats Water. Two Snaplings hit → both eligible.
      const st = mkBattle({ units: [
        { form: 'Galvaquill', owner: 0, x: 3, y: 3 },
        { form: 'Snapling', owner: 1, x: 2, y: 3 },
        { form: 'Snapling', owner: 1, x: 4, y: 3 },
      ]});
      const s1 = GM.applyAction(st, 0, { t: 'activate', unitId: 0 });
      const p = GM.previewAttack(s1, 0, { t: 'attack', kind: 'special' });
      assert(p.needsFocus === true, 'two eligible hits → needsFocus');
      assertEq([...p.focusEligible].sort((a, b) => a - b), [1, 2], 'both Water units eligible');
      assertThrows(() => GM.applyAction(s1, 0, { t: 'attack', kind: 'special' }),
        'missing focus with 2 eligible must throw');
      const s2 = GM.applyAction(s1, 0, { t: 'attack', kind: 'special', focus: 1 });
      assertEq(unit(s2, 1).hp, 1, 'focused Snapling doubled: 2×2=4 (5→1)');
      assertEq(unit(s2, 2).hp, 3, 'unfocused Snapling takes base 2 (5→3) — only ONE unit doubled');
    },
  },

  {
    name: 'Focus: exactly 1 eligible → auto-double with no focus field; ineligible co-target takes base damage',
    fn() {
      // Quill Burst hits Snapling(Water, eligible) and Gritling(Ground, not eligible).
      const st = mkBattle({ units: [
        { form: 'Galvaquill', owner: 0, x: 3, y: 3 },
        { form: 'Snapling', owner: 1, x: 2, y: 3 },
        { form: 'Gritling', owner: 1, x: 3, y: 4 },
      ]});
      const p = previewMid(st, 0, 0, { t: 'attack', kind: 'special' });
      assert(!p.needsFocus, 'single eligible hit → auto-resolve');
      assertEq([...p.focusEligible].sort((a, b) => a - b), [1], 'only the Water unit is eligible');
      const s = act(st, 0, 0, { attack: { kind: 'special' } });
      assertEq(unit(s, 1).hp, 1, 'Snapling auto-doubled: 2×2=4 (5→1)');
      assertEq(unit(s, 2).hp, 3, 'Gritling takes base 2 (5→3)');
    },
  },

  {
    name: 'Focus: focus naming an ineligible hit unit is rejected (must be one of the eligible units)',
    fn() {
      // Two eligible Snaplings force a focus pick, but the pick names the hit-but-ineligible Gritling.
      const st = mkBattle({ units: [
        { form: 'Galvaquill', owner: 0, x: 3, y: 3 },
        { form: 'Snapling', owner: 1, x: 2, y: 3 },
        { form: 'Snapling', owner: 1, x: 4, y: 3 },
        { form: 'Gritling', owner: 1, x: 3, y: 4 },
      ]});
      assertThrows(() => act(st, 0, 0, { attack: { kind: 'special', focus: 3 } }),
        'focus on an ineligible (Ground vs Electric) hit unit must throw');
    },
  },
];
