// PATCH-V8 reconciliation tests — covers PATCH-V8.md §6 exactly.
// Authorities: PATCH-V8.md > SPEC.md (AMENDMENTS) > CONTRACT.md (DEV-PINS 24–26).
//
// INDEPENDENCE: every expected value below is derived from the authority text —
// the §3 HP table is transcribed from PATCH-V8.md itself (so this file guards
// data.js); damage numbers from SPEC §6 (unchanged by v8); the evolution-refresh
// numbers are hand-computed from PATCH-V8 §4 (heal ceil(missing/2) vs the NEW
// stage's max, capped); pin/root turn arithmetic from CONTRACT's pinnedTurn /
// rootedTurn model (applied → playerTurns[owner]+1; blocked while equal; cleared
// at that turn's end). Coordinates per CONTRACT: N=(0,+1), E=(+1,0).
//
// Damage facts used (SPEC §6/§7, no v8 changes): Basic 2; Stoop Strike Single 2,
// 2 dmg, Pin, Lunge (Talonlock); Impale Single 1, 2 dmg, Pin (Butcher/Skulk/
// Thorn-root); Magma Stream Lance 3, 3 dmg, Burn 2, Recoil 2. Type chart: Ground
// does not double Water; Flying does not double Water; Dark does not double
// Water; Fire does not double Water — so Bulwhark (Water) takes undoubled hits
// from Pumarok/Peregale/Butcherbeak/Pyroclasm in every scenario below.
const { GM, DATA, lineById, assert, assertEq, assertThrows, mkBattle, play, act, endTurn, unit, at } =
  require('./helpers.js');

// ---------------------------------------------------------------------------
// §6 item: "All 57 max-HP values match §3 exactly (assert against data.js)."
// Transcribed from PATCH-V8.md §3 text — NOT from data.js.
const HP_V8 = {
  // "Bases: all 5, except Guppling 4 and Zapkitt 4. Tavrik (sole stage): 8."
  Cinderling: 5, Sootpup: 5, Snapling: 5, Guppling: 4, Mosskit: 5, Podling: 5,
  Zapkitt: 4, Coilbug: 5, Gritling: 5, Cacklet: 5, Wyrmlet: 5, Falchick: 5,
  Tavrik: 8, Hootle: 5, Mystikit: 5, Shadekit: 5, Glimlure: 5, Frostfawn: 5,
  Floecub: 5, Pupfloe: 5, Quillet: 5, Slithrin: 5, Pebblepaw: 5, Shriket: 5,
  // "Middles: Flarewyrm 6, Shellbrook 8, Thornhide 8, Joltlynx 6, Stonehide 8,
  //  Galewyrm 7, Parliowl 6, Duskpard 6, Rimestag 8, Frostursa 8."
  Flarewyrm: 6, Shellbrook: 8, Thornhide: 8, Joltlynx: 6, Stonehide: 8,
  Galewyrm: 7, Parliowl: 6, Duskpard: 6, Rimestag: 8, Frostursa: 8,
  // "Finals: Pyroclasm 9, Hellhowl 11, Bulwhark 14, Leviadon 13, Grovewarden 14,
  //  Bombloom 11, Fulgurlynx 9, Dynamoth 10, Terradon 14, Ossiyena 10,
  //  Tempestdrake 13, Peregale 10, Archistrix 9, Velvesper 10, Pantherebus 9,
  //  Mawlantern 12, Gravewinter 15, Maulberg 13, Floefang 10, Galvaquill 12,
  //  Servenom 9, Pumarok 10, Butcherbeak 9."
  Pyroclasm: 9, Hellhowl: 11, Bulwhark: 14, Leviadon: 13, Grovewarden: 14,
  Bombloom: 11, Fulgurlynx: 9, Dynamoth: 10, Terradon: 14, Ossiyena: 10,
  Tempestdrake: 13, Peregale: 10, Archistrix: 9, Velvesper: 10, Pantherebus: 9,
  Mawlantern: 12, Gravewinter: 15, Maulberg: 13, Floefang: 10, Galvaquill: 12,
  Servenom: 9, Pumarok: 10, Butcherbeak: 9,
};

function stageName(state, id) {
  const u = unit(state, id);
  return lineById[u.lineId].stages[u.stage].name;
}

module.exports = [

  // ================================================================ 1 · HP table

  {
    name: 'v8 HP: all 57 stage max-HP values in data.js match PATCH-V8 §3 exactly',
    fn() {
      assertEq(Object.keys(HP_V8).length, 57, 'expected table itself must hold 57 entries');
      const seen = {};
      let count = 0;
      for (const line of DATA.lines) {
        for (const st of line.stages) {
          count += 1;
          assert(!(st.name in seen), `duplicate stage name in data.js: ${st.name}`);
          seen[st.name] = true;
          assert(st.name in HP_V8, `data.js stage ${st.name} not in PATCH-V8 §3 table`);
          assertEq(st.hp, HP_V8[st.name], `max HP of ${st.name}`);
        }
      }
      assertEq(count, 57, 'data.js must define exactly 57 stages');
      for (const name of Object.keys(HP_V8)) {
        assert(seen[name], `PATCH-V8 §3 form missing from data.js: ${name}`);
      }
    },
  },

  // ================================================== 2 · Free activation order

  {
    name: 'v8 order: attack-then-move is legal and ends in the same state as move-then-attack (DEV-PIN 24)',
    fn() {
      // Pumarok (Ground, Basic 2) vs Bulwhark (Water, 14 HP) — no doubling.
      // Victim at (4,4) is 8-adjacent to the attacker both at (3,3) and (4,3),
      // so the same {move E, basic at (4,4)} pair is legal in either order.
      const base = mkBattle({ units: [
        { form: 'Pumarok', owner: 0, x: 3, y: 3 },
        { form: 'Bulwhark', owner: 1, x: 4, y: 4 },
      ]});
      const A = play(base, [
        [0, { t: 'activate', unitId: 0 }],
        [0, { t: 'attack', kind: 'basic', target: { x: 4, y: 4 } }],
        [0, { t: 'move', path: [{ x: 4, y: 3 }] }],
        [0, { t: 'endActivation' }],
      ]);
      const B = play(base, [
        [0, { t: 'activate', unitId: 0 }],
        [0, { t: 'move', path: [{ x: 4, y: 3 }] }],
        [0, { t: 'attack', kind: 'basic', target: { x: 4, y: 4 } }],
        [0, { t: 'endActivation' }],
      ]);
      // Absolute expectations, derived: Basic 2, no ×2 → 14−2 = 12; dealt = 2.
      for (const s of [A, B]) {
        assertEq(unit(s, 1).hp, 12, 'Bulwhark takes exactly the Basic 2');
        assertEq(unit(s, 0).pos, { x: 4, y: 3 }, 'attacker ends on the moved-to square');
        assertEq(unit(s, 0).facing, 'E', 'facing = direction of the final move step');
        assertEq(unit(s, 0).dealt, 2, 'damage credit identical in both orders');
      }
      assertEq(A.units, B.units, 'mirrored orders end in identical unit states');
      assertEq(A.turn, B.turn, 'mirrored orders end in identical turn states');
    },
  },

  {
    name: 'v8 order: max one move and one attack per activation, in either order (DEV-PIN 24)',
    fn() {
      const base = mkBattle({ units: [
        { form: 'Pumarok', owner: 0, x: 3, y: 3 },
        { form: 'Bulwhark', owner: 1, x: 4, y: 4 },
      ]});
      // move → attack: second move and second attack both refused.
      let s = play(base, [
        [0, { t: 'activate', unitId: 0 }],
        [0, { t: 'move', path: [{ x: 4, y: 3 }] }],
      ]);
      assertThrows(() => GM.applyAction(s, 0, { t: 'move', path: [{ x: 5, y: 3 }] }),
        'second move in one activation must throw');
      s = GM.applyAction(s, 0, { t: 'attack', kind: 'basic', target: { x: 4, y: 4 } });
      assertThrows(() => GM.applyAction(s, 0, { t: 'attack', kind: 'basic', target: { x: 4, y: 4 } }),
        'second attack in one activation must throw');
      // attack → move: same limits the other way around.
      let r = play(base, [
        [0, { t: 'activate', unitId: 0 }],
        [0, { t: 'attack', kind: 'basic', target: { x: 4, y: 4 } }],
      ]);
      assertThrows(() => GM.applyAction(r, 0, { t: 'attack', kind: 'basic', target: { x: 4, y: 4 } }),
        'second attack (attack-first order) must throw');
      r = GM.applyAction(r, 0, { t: 'move', path: [{ x: 4, y: 3 }] });
      assertThrows(() => GM.applyAction(r, 0, { t: 'move', path: [{ x: 3, y: 3 }] }),
        'second move (attack-first order) must throw');
    },
  },

  {
    name: 'v8 order: Pyroclasm fires Magma Stream then retreats 6 squares in the same activation (PATCH §7 acceptance)',
    fn() {
      const s0 = mkBattle({ units: [
        { form: 'Pyroclasm', owner: 0, x: 0, y: 0 },
        { form: 'Bulwhark', owner: 1, x: 0, y: 2 },
      ]});
      const s = play(s0, [
        [0, { t: 'activate', unitId: 0 }],
        // Lance 3 north: 3 dmg (Fire does not double Water), Burn 2, Recoil 2.
        [0, { t: 'attack', kind: 'special', dir: { dx: 0, dy: 1 } }],
        [0, { t: 'move', path: [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }, { x: 4, y: 0 }, { x: 5, y: 0 }, { x: 6, y: 0 }] }],
        [0, { t: 'endActivation' }],
      ]);
      assertEq(unit(s, 1).hp, 11, 'Bulwhark 14 − 3 = 11');
      assertEq(unit(s, 1).burn, { n: 2, ticks: 2 }, 'Burn 2 applied');
      assertEq(unit(s, 0).hp, 7, 'Pyroclasm 9 − 2 recoil = 7');
      assertEq(unit(s, 0).pos, { x: 6, y: 0 }, 'retreated the full Speed 6 after attacking');
    },
  },

  // ================================== 3 · Immediate root forfeits the unused move

  {
    name: 'v8 root: Peregale pins with move unspent → forced lunge, immediate root, move forfeited now AND next turn (DEV-PIN 25)',
    fn() {
      // Peregale (Flying) at (3,3); Bulwhark (Water, 14) at (3,5) — Stoop Strike
      // Single range 2 north, 2 dmg undoubled → 12, survives, Pin lands.
      const s0 = mkBattle({ units: [
        { form: 'Peregale', owner: 0, x: 3, y: 3 },
        { form: 'Bulwhark', owner: 1, x: 3, y: 5 },
      ]});
      let s = play(s0, [
        [0, { t: 'activate', unitId: 0 }],   // no move first
        [0, { t: 'attack', kind: 'special', dir: { dx: 0, dy: 1 }, lungeTo: { x: 3, y: 4 } }],
      ]);
      assertEq(unit(s, 1).hp, 12, 'Stoop Strike 2 dmg, no doubling');
      assertEq(unit(s, 1).pinnedTurn, 1, 'victim pinned for its turn 1 (playerTurns[1]+1 = 0+1)');
      assertEq(unit(s, 0).pos, { x: 3, y: 4 }, 'Talonlock forced lunge to adjacency');
      assertEq(unit(s, 0).rootedTurn, 2, 'self-root set for owner turn 2 (playerTurns[0]+1 = 1+1)');
      // PATCH-V8 §1 ruling: the unused move is forfeited IMMEDIATELY.
      assertEq(s.turn.current.moved, true, "the activation's move is marked spent");
      assertThrows(() => GM.applyAction(s, 0, { t: 'move', path: [{ x: 2, y: 4 }] }),
        'a subsequent move in the same activation must throw');
      s = GM.applyAction(s, 0, { t: 'endActivation' });
      s = endTurn(s, 0);
      s = endTurn(s, 1);                     // victim's pin clears at the end of P1 turn 1
      // P0 turn 2: rooted — cannot move, may still attack.
      assertEq(GM.reachable(s, 0).length, 0, 'rooted Peregale has no reachable squares');
      s = GM.applyAction(s, 0, { t: 'activate', unitId: 0 });
      assertThrows(() => GM.applyAction(s, 0, { t: 'move', path: [{ x: 2, y: 4 }] }),
        'rooted unit cannot move on its controller\'s next turn');
      // Basic at the (no-longer-pinned) victim: 2 dmg, no Predator ×2 → 10.
      s = GM.applyAction(s, 0, { t: 'attack', kind: 'basic', target: { x: 3, y: 5 } });
      assertEq(unit(s, 1).hp, 10, 'rooted unit may still attack (Basic 2, victim unpinned)');
      s = GM.applyAction(s, 0, { t: 'endActivation' });
      s = endTurn(s, 0);                     // root (rootedTurn 2) clears at end of owner turn 2
      assertEq(unit(s, 0).rootedTurn, 0, 'root cleared at the end of that turn');
      s = endTurn(s, 1);
      // P0 turn 3: free to move again.
      assert(GM.reachable(s, 0).length > 0, 'movement restored on the following turn');
      s = play(s, [
        [0, { t: 'activate', unitId: 0 }],
        [0, { t: 'move', path: [{ x: 2, y: 4 }] }],
      ]);
      assertEq(unit(s, 0).pos, { x: 2, y: 4 }, 'moves normally once the root has cleared');
    },
  },

  {
    name: 'v8 root: Butcherbeak landing Impale\'s pin is rooted immediately, move forfeited, no lunge involved (DEV-PINs 25/26)',
    fn() {
      const s0 = mkBattle({ units: [
        { form: 'Butcherbeak', owner: 0, x: 3, y: 3 },
        { form: 'Bulwhark', owner: 1, x: 3, y: 4 },
      ]});
      // Impale has no Lunge rider — supplying lungeTo is an illegal declaration.
      const s1 = GM.applyAction(s0, 0, { t: 'activate', unitId: 0 });
      assertThrows(() => GM.applyAction(s1, 0,
        { t: 'attack', kind: 'special', dir: { dx: 0, dy: 1 }, lungeTo: { x: 2, y: 4 } }),
        'Impale must not offer a lunge (Thorn-root has no forced lunge)');
      const s = GM.applyAction(s1, 0, { t: 'attack', kind: 'special', dir: { dx: 0, dy: 1 } });
      assertEq(unit(s, 1).hp, 12, 'Impale 2 dmg (Dark does not double Water; victim not pinned → no Butcher +2)');
      assertEq(unit(s, 1).pinnedTurn, 1, 'Pin lands on the victim');
      assertEq(unit(s, 0).pos, { x: 3, y: 3 }, 'Butcherbeak stays put — no lunge');
      assertEq(unit(s, 0).rootedTurn, 2, 'Thorn-root applied for owner turn 2');
      assertEq(s.turn.current.moved, true, 'unused move forfeited immediately');
      assertThrows(() => GM.applyAction(s, 0, { t: 'move', path: [{ x: 2, y: 3 }] }),
        'move after the immediate root must throw');
    },
  },

  {
    name: 'v8 root: self-root from an attack AFTER the unit already moved changes nothing extra',
    fn() {
      const s0 = mkBattle({ units: [
        { form: 'Peregale', owner: 0, x: 3, y: 2 },
        { form: 'Bulwhark', owner: 1, x: 3, y: 5 },
      ]});
      const s = play(s0, [
        [0, { t: 'activate', unitId: 0 }],
        [0, { t: 'move', path: [{ x: 3, y: 3 }] }],   // move spent normally first
        [0, { t: 'attack', kind: 'special', dir: { dx: 0, dy: 1 }, lungeTo: { x: 3, y: 4 } }],
      ]);
      assertEq(unit(s, 1).hp, 12, 'Stoop Strike 2 dmg');
      assertEq(unit(s, 1).pinnedTurn, 1, 'pin landed');
      assertEq(unit(s, 0).pos, { x: 3, y: 4 }, 'forced lunge still resolves');
      assertEq(unit(s, 0).rootedTurn, 2, 'self-root still applies for next turn');
      assertThrows(() => GM.applyAction(s, 0, { t: 'move', path: [{ x: 2, y: 4 }] }),
        'move already spent — nothing extra to forfeit');
    },
  },

  // ================================================ 4 · Butcherbeak Skulk pathing

  {
    name: 'v8 skulk: Butcherbeak paths through a wall of bodies, cannot end on an occupied square (PATCH §2, DEV-PIN 26)',
    fn() {
      // Data guard (DEV-PIN 26): skulk roster is exactly Duskpard, Pantherebus,
      // Butcherbeak; thornRoot exactly Butcherbeak; Butcherbeak keeps butcher.
      const skulkers = [], rooters = [];
      for (const line of DATA.lines) for (const st of line.stages) {
        if (st.traits.indexOf('skulk') !== -1) skulkers.push(st.name);
        if (st.traits.indexOf('thornRoot') !== -1) rooters.push(st.name);
      }
      assertEq(skulkers.sort(), ['Butcherbeak', 'Duskpard', 'Pantherebus'], 'Skulk roster per PATCH-V8 §2');
      assertEq(rooters, ['Butcherbeak'], 'thornRoot trait on Butcherbeak only');
      const bb = lineById['shriket'].stages[1];
      assert(bb.traits.indexOf('butcher') !== -1, 'Butcherbeak keeps the Butcher trait');

      // Wall across y=4 at x∈{2,3,4} (ally + two enemies — Skulk ignores both).
      const s0 = mkBattle({ units: [
        { form: 'Butcherbeak', owner: 0, x: 3, y: 3 },
        { form: 'Mosskit', owner: 0, x: 2, y: 4 },
        { form: 'Bulwhark', owner: 1, x: 3, y: 4 },
        { form: 'Mosskit', owner: 1, x: 4, y: 4 },
      ]});
      const keys = GM.reachable(s0, 0).map(r => `${r.x},${r.y}`);
      assert(keys.indexOf('3,5') !== -1, 'square directly beyond the wall is reachable through a body');
      assert(keys.indexOf('3,6') !== -1, 'deeper square beyond the wall is reachable');
      assert(keys.indexOf('3,4') === -1, 'occupied square is never a destination');
      assert(keys.indexOf('2,4') === -1 && keys.indexOf('4,4') === -1, 'no occupied destinations at all');

      let s = play(s0, [
        [0, { t: 'activate', unitId: 0 }],
        [0, { t: 'move', path: [{ x: 3, y: 4 }, { x: 3, y: 5 }] }],  // through the enemy body
      ]);
      assertEq(unit(s, 0).pos, { x: 3, y: 5 }, 'passed through the wall and ended on an empty square');

      const s1 = GM.applyAction(s0, 0, { t: 'activate', unitId: 0 });
      assertThrows(() => GM.applyAction(s1, 0, { t: 'move', path: [{ x: 3, y: 4 }] }),
        'Skulk still cannot END on an occupied square');
    },
  },

  {
    name: 'v8 skulk: Butcherbeak\'s body still blocks non-Skulk units',
    fn() {
      const s0 = mkBattle({ units: [
        { form: 'Pumarok', owner: 0, x: 3, y: 2 },      // no Skulk
        { form: 'Butcherbeak', owner: 0, x: 3, y: 3 },
        { form: 'Bulwhark', owner: 1, x: 7, y: 7 },
      ]});
      const s1 = GM.applyAction(s0, 0, { t: 'activate', unitId: 0 });
      assertThrows(() => GM.applyAction(s1, 0, { t: 'move', path: [{ x: 3, y: 3 }, { x: 3, y: 4 }] }),
        'pathing through Butcherbeak\'s square must throw for a non-Skulk mover');
    },
  },

  // ===================================================== 5 · Thorn-root timing

  {
    name: 'v8 thorn-root: rooted during controller\'s next turn, may still attack — Impale included (and re-pins re-root)',
    fn() {
      const s0 = mkBattle({ units: [
        { form: 'Butcherbeak', owner: 0, x: 3, y: 3 },
        { form: 'Bulwhark', owner: 1, x: 3, y: 4 },
      ]});
      let s = play(s0, [
        [0, { t: 'activate', unitId: 0 }],
        [0, { t: 'attack', kind: 'special', dir: { dx: 0, dy: 1 } }],  // 14→12, pin, root
        [0, { t: 'endActivation' }],
      ]);
      s = endTurn(s, 0);
      // P1 turn 1: the pinned victim cannot move (standard Pin), then pin clears.
      const fork = GM.applyAction(s, 1, { t: 'activate', unitId: 1 });
      assertThrows(() => GM.applyAction(fork, 1, { t: 'move', path: [{ x: 4, y: 4 }] }),
        'Impale\'s Pin blocks the victim\'s move on its turn');
      s = endTurn(s, 1);
      // P0 turn 2: Butcherbeak rooted — no move, but Impale is usable while rooted.
      assertEq(GM.reachable(s, 0).length, 0, 'rooted: nowhere to move');
      s = GM.applyAction(s, 0, { t: 'activate', unitId: 0 });
      assertThrows(() => GM.applyAction(s, 0, { t: 'move', path: [{ x: 2, y: 3 }] }), 'rooted move must throw');
      s = GM.applyAction(s, 0, { t: 'attack', kind: 'special', dir: { dx: 0, dy: 1 } });
      // Victim's pin cleared at end of P1 turn 1 → no Butcher +2 → 12−2 = 10.
      assertEq(unit(s, 1).hp, 10, 'Impale usable while rooted, 2 dmg');
      assertEq(unit(s, 1).pinnedTurn, 2, 'fresh pin for the victim\'s turn 2 (playerTurns[1]+1 = 1+1)');
      assertEq(unit(s, 0).rootedTurn, 3, 'landing the pin again re-roots for owner turn 3');
    },
  },

  {
    name: 'v8 thorn-root: clears at the end of the controller\'s next turn — movement restored after',
    fn() {
      const s0 = mkBattle({ units: [
        { form: 'Butcherbeak', owner: 0, x: 3, y: 3 },
        { form: 'Bulwhark', owner: 1, x: 3, y: 4 },
      ]});
      let s = play(s0, [
        [0, { t: 'activate', unitId: 0 }],
        [0, { t: 'attack', kind: 'special', dir: { dx: 0, dy: 1 } }],  // pin + root (rootedTurn 2)
        [0, { t: 'endActivation' }],
      ]);
      s = endTurn(s, 0);
      s = endTurn(s, 1);
      // P0 turn 2: attack with the BASIC (no pin → no re-root), then end the turn.
      s = play(s, [
        [0, { t: 'activate', unitId: 0 }],
        [0, { t: 'attack', kind: 'basic', target: { x: 3, y: 4 } }],   // 12→10, victim unpinned
        [0, { t: 'endActivation' }],
      ]);
      assertEq(unit(s, 1).hp, 10, 'Basic 2 while rooted (no Butcher +2: victim\'s pin already cleared)');
      s = endTurn(s, 0);
      assertEq(unit(s, 0).rootedTurn, 0, 'thorn-root cleared at the end of owner turn 2');
      s = endTurn(s, 1);
      // P0 turn 3: free again.
      assert(GM.reachable(s, 0).length > 0, 'reachable squares restored');
      s = play(s, [
        [0, { t: 'activate', unitId: 0 }],
        [0, { t: 'move', path: [{ x: 2, y: 3 }] }],
      ]);
      assertEq(unit(s, 0).pos, { x: 2, y: 3 }, 'moves normally after the root cleared');
    },
  },

  {
    name: 'v8 thorn-root: Impale that KOs its target lands no pin → no root, move NOT forfeited (DEV-PINs 17/22 analogue)',
    fn() {
      const s0 = mkBattle({ units: [
        { form: 'Butcherbeak', owner: 0, x: 3, y: 3 },
        { form: 'Bulwhark', owner: 1, x: 3, y: 4, hp: 2 },   // Impale's 2 dmg KOs exactly
        { form: 'Mosskit', owner: 1, x: 7, y: 7 },           // keeps the game alive
      ]});
      let s = play(s0, [
        [0, { t: 'activate', unitId: 0 }],
        [0, { t: 'attack', kind: 'special', dir: { dx: 0, dy: 1 } }],
      ]);
      assertEq(unit(s, 1).pos, null, "victim KO'd by Impale");
      assertEq(unit(s, 0).rootedTurn, 0, 'no pin landed → no Thorn-root');
      assertEq(s.turn.current.moved, false, 'move not forfeited');
      s = GM.applyAction(s, 0, { t: 'move', path: [{ x: 3, y: 4 }] });  // even onto the vacated square
      assertEq(unit(s, 0).pos, { x: 3, y: 4 }, 'free to move after a KO-without-pin');
    },
  },

  // ================================================== 6 · Evolution refresh (v8)

  {
    name: 'v8 evolve: the PATCH §4 example — Shellbrook 2/8 evolves into Bulwhark at 8/14 (heal ceil((14−2)/2)=6)',
    fn() {
      // survived 5 satisfied → evolves at the start of its controller's next turn.
      const s0 = mkBattle({ turn: 1, units: [
        { form: 'Shellbrook', owner: 0, x: 3, y: 3, hp: 2, survived: 5 },
        { form: 'Sootpup', owner: 1, x: 7, y: 7 },
      ]});
      const s = endTurn(s0, 1);                       // P0's turn starts → evolution resolves
      assertEq(stageName(s, 0), 'Bulwhark', 'evolved one stage');
      assertEq(unit(s, 0).hp, 8, '2 + ceil((14−2)/2) = 2 + 6 = 8');
      assertEq(GM.maxHp(s, 0), 14, 'new max per PATCH §3');
    },
  },

  {
    name: 'v8 evolve: a full-HP evolver is NOT full at the new stage — Shellbrook 8/8 → Bulwhark 11/14 (missing measured vs NEW max)',
    fn() {
      const s0 = mkBattle({ turn: 1, units: [
        { form: 'Shellbrook', owner: 0, x: 3, y: 3, survived: 5 },   // hp defaults to max 8
        { form: 'Sootpup', owner: 1, x: 7, y: 7 },
      ]});
      const s = endTurn(s0, 1);
      assertEq(stageName(s, 0), 'Bulwhark');
      assertEq(unit(s, 0).hp, 11, '8 + ceil((14−8)/2) = 8 + 3 = 11 — cap not reached');
      assert(unit(s, 0).hp <= GM.maxHp(s, 0), 'cap respected');
    },
  },

  {
    name: 'v8 evolve: odd missing rounds UP — Zapkitt 1/4 → Joltlynx 4/6 (ceil((6−1)/2)=3)',
    fn() {
      const s0 = mkBattle({ turn: 1, units: [
        { form: 'Zapkitt', owner: 0, x: 3, y: 3, hp: 1, dealt: 3 },  // dealt 3 → evolves
        { form: 'Sootpup', owner: 1, x: 7, y: 7 },
      ]});
      const s = endTurn(s0, 1);
      assertEq(stageName(s, 0), 'Joltlynx', 'evolved exactly one stage (dealt 3 < 7 for the next)');
      assertEq(unit(s, 0).hp, 4, '1 + ceil(5/2) = 1 + 3 = 4');
      assert(unit(s, 0).hp <= GM.maxHp(s, 0), 'cap respected');
    },
  },

  {
    name: 'v8 evolve: double evolution applies the refresh per stage, capped each time — Snapling 1/5 → Bulwhark 10/14 (DEV-PIN 9)',
    fn() {
      // survived 5 satisfies both "survived 2" and "survived 5" → two stages in one
      // start-of-turn. Per stage: 1 + ceil((8−1)/2) = 5 at Shellbrook, then
      // 5 + ceil((14−5)/2) = 10 at Bulwhark. (A single jump measured vs 14 would
      // give 8 — the per-stage application is what's being asserted.)
      const s0 = mkBattle({ turn: 1, units: [
        { form: 'Snapling', owner: 0, x: 3, y: 3, hp: 1, survived: 5 },
        { form: 'Sootpup', owner: 1, x: 7, y: 7 },
      ]});
      const s = endTurn(s0, 1);
      assertEq(stageName(s, 0), 'Bulwhark', 'evolved two stages in one start-of-turn');
      assertEq(unit(s, 0).hp, 10, 'per-stage refresh: 1→5 (Shellbrook), 5→10 (Bulwhark)');
      assert(unit(s, 0).hp <= GM.maxHp(s, 0), 'cap respected at every stage');
    },
  },

];
