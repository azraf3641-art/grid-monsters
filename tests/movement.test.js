// Movement + facing tests — SPEC §2 (movement, BFS, facing, rear squares),
// plus pinned/rooted/Hard-Frozen move rejection (SPEC §3 Pin/Chill, CONTRACT
// pinnedTurn model) and Skulk pathing (SPEC §3 Skulk).
//
// INDEPENDENCE: every expected value below is derived from SPEC.md +
// CONTRACT.md only (engine.js was never read). Coordinates per CONTRACT:
// N=(0,+1), E=(+1,0), S=(0,-1), W=(-1,0); P0 back rows y∈{0,1}, P1 y∈{6,7}.
//
// Speeds used (from data.js §6 table): Cinderling 2, Bulwhark 3, Duskpard 3,
// Leviadon 4, Pyroclasm 6, Pantherebus 5, Pumarok 5, Velvesper 5,
// Archistrix 4, Peregale 5, Maulberg 4, Terradon 3, Tavrik 4.
const { GM, DATA, assert, assertEq, assertThrows, mkBattle, play, act, endTurn, unit, at } =
  require('./helpers.js');

// --- small local utilities (engine-independent) ---
function xyKeys(list) { return list.map(r => `${r.x},${r.y}`).sort(); }
// Drop the start square if the engine chooses to include it (move-0 entry);
// the contract does not pin that, so tests stay agnostic.
function notStart(list, sx, sy) { return list.filter(r => !(r.x === sx && r.y === sy)); }
// Independent path validator: orthogonal unit steps from (sx,sy), on-board,
// every stepped square empty, length <= maxLen, ends at (ex,ey).
function validatePath(state, sx, sy, path, maxLen, ex, ey) {
  assert(path.length >= 1 && path.length <= maxLen, `path length ${path.length} > speed ${maxLen}`);
  let cx = sx, cy = sy;
  for (const step of path) {
    const dx = step.x - cx, dy = step.y - cy;
    assert(Math.abs(dx) + Math.abs(dy) === 1, `non-orthogonal step to ${step.x},${step.y}`);
    assert(step.x >= 0 && step.x <= 7 && step.y >= 0 && step.y <= 7, 'step off-board');
    assert(at(state, step.x, step.y) === null, `step onto occupied ${step.x},${step.y}`);
    cx = step.x; cy = step.y;
  }
  assert(cx === ex && cy === ey, `path ends at ${cx},${cy}, not ${ex},${ey}`);
}

module.exports = [

  // ---------------------------------------------------------------- BFS / reachable

  {
    name: 'reachable: speed-2 base at corner (0,0) = exactly the 5 on-board Manhattan<=2 squares (SPEC §2 BFS, empty board)',
    fn() {
      const s = mkBattle({ units: [
        { form: 'Cinderling', owner: 0, x: 0, y: 0 },
        { form: 'Butcherbeak', owner: 1, x: 7, y: 7 },
      ]});
      const r = notStart(GM.reachable(s, 0), 0, 0);
      assertEq(xyKeys(r), ['0,1', '0,2', '1,0', '1,1', '2,0'], 'corner disc');
    },
  },

  {
    name: 'reachable: Pyroclasm speed 6 open board = full Manhattan<=6 disc; BFS path length equals Manhattan distance with no blockers',
    fn() {
      const s = mkBattle({ units: [
        { form: 'Pyroclasm', owner: 0, x: 3, y: 3 },
        { form: 'Butcherbeak', owner: 1, x: 7, y: 7 },  // Manhattan 8 from (3,3): outside disc
      ]});
      const expected = [];
      for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) {
        const d = Math.abs(x - 3) + Math.abs(y - 3);
        if (d <= 6 && d > 0) expected.push({ x, y });
      }
      const r = notStart(GM.reachable(s, 0), 3, 3);
      assertEq(xyKeys(r), xyKeys(expected), 'speed-6 disc');
      for (const e of r) {
        const d = Math.abs(e.x - 3) + Math.abs(e.y - 3);
        assertEq(e.path.length, d, `BFS dist to ${e.x},${e.y} must equal Manhattan ${d}`);
      }
    },
  },

  {
    name: 'BFS friend-blocking: ally at (1,0) makes (2,0) cost 4 steps — unreachable at speed 3; reroute via (2,1) legal (SPEC §2: ALL units block)',
    fn() {
      const s = mkBattle({ units: [
        { form: 'Bulwhark', owner: 0, x: 0, y: 0 },     // speed 3
        { form: 'Cinderling', owner: 0, x: 1, y: 0 },   // ALLY blocker
        { form: 'Butcherbeak', owner: 1, x: 7, y: 7 },
      ]});
      const keys = xyKeys(notStart(GM.reachable(s, 0), 0, 0));
      assert(!keys.includes('1,0'), 'occupied ally square must not be reachable');
      assert(!keys.includes('2,0'), '(2,0) needs 4 steps around the ally: beyond speed 3');
      assert(keys.includes('1,1'), '(1,1) reachable in 2');
      assert(keys.includes('2,1'), '(2,1) reachable in 3');
      const s1 = GM.applyAction(s, 0, { t: 'activate', unitId: 0 });
      assertThrows(() => GM.applyAction(s1, 0, { t: 'move', path: [{ x: 1, y: 0 }, { x: 2, y: 0 }] }),
        'path through ally must throw');
      const s2 = GM.applyAction(s1, 0, { t: 'move', path: [{ x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }] });
      assertEq(unit(s2, 0).pos, { x: 2, y: 1 }, 'reroute lands');
    },
  },

  {
    name: 'BFS foe-blocking identical to friend-blocking; fully boxed-in unit: reachable empty, every move throws',
    fn() {
      // Foe reroute: same geometry as the ally case.
      const a = mkBattle({ units: [
        { form: 'Bulwhark', owner: 0, x: 0, y: 0 },
        { form: 'Butcherbeak', owner: 1, x: 1, y: 0 },  // FOE blocker
      ]});
      const keysA = xyKeys(notStart(GM.reachable(a, 0), 0, 0));
      assert(!keysA.includes('2,0'), 'foe blocks exactly like a friend (BFS dist 4 > 3)');
      assert(keysA.includes('2,1'), 'reroute square reachable');
      // Boxed in the corner by two foes: no legal move at all.
      const b = mkBattle({ units: [
        { form: 'Bulwhark', owner: 0, x: 0, y: 0 },
        { form: 'Butcherbeak', owner: 1, x: 1, y: 0 },
        { form: 'Maulberg', owner: 1, x: 0, y: 1 },
      ]});
      assertEq(notStart(GM.reachable(b, 0), 0, 0).length, 0, 'boxed unit has no reachable squares');
      const b1 = GM.applyAction(b, 0, { t: 'activate', unitId: 0 });
      assertThrows(() => GM.applyAction(b1, 0, { t: 'move', path: [{ x: 1, y: 0 }] }), 'onto foe throws');
      assertThrows(() => GM.applyAction(b1, 0, { t: 'move', path: [{ x: 0, y: 1 }] }), 'onto foe throws');
    },
  },

  // ---------------------------------------------------------------- illegal step shapes

  {
    name: 'move: diagonal step, 2-square jump, and knight jump all throw (SPEC §2: orthogonal only, one square per step)',
    fn() {
      const s = mkBattle({ units: [
        { form: 'Pyroclasm', owner: 0, x: 3, y: 3 },
        { form: 'Butcherbeak', owner: 1, x: 7, y: 7 },
      ]});
      const s1 = GM.applyAction(s, 0, { t: 'activate', unitId: 0 });
      assertThrows(() => GM.applyAction(s1, 0, { t: 'move', path: [{ x: 4, y: 4 }] }), 'diagonal step');
      assertThrows(() => GM.applyAction(s1, 0, { t: 'move', path: [{ x: 3, y: 5 }] }), '2-square jump');
      assertThrows(() => GM.applyAction(s1, 0, { t: 'move', path: [{ x: 5, y: 4 }] }), 'knight jump');
    },
  },

  {
    name: 'move: path longer than Speed throws (Cinderling speed 2: 3 steps illegal, 2 steps legal)',
    fn() {
      const s = mkBattle({ units: [
        { form: 'Cinderling', owner: 0, x: 3, y: 3 },
        { form: 'Butcherbeak', owner: 1, x: 7, y: 7 },
      ]});
      const s1 = GM.applyAction(s, 0, { t: 'activate', unitId: 0 });
      assertThrows(() => GM.applyAction(s1, 0,
        { t: 'move', path: [{ x: 3, y: 4 }, { x: 3, y: 5 }, { x: 3, y: 6 }] }), '3 > speed 2');
      const s2 = GM.applyAction(s1, 0, { t: 'move', path: [{ x: 3, y: 4 }, { x: 3, y: 5 }] });
      assertEq(unit(s2, 0).pos, { x: 3, y: 5 }, 'exactly-speed path legal');
    },
  },

  {
    name: 'move: cannot end on an occupied square — ally or enemy (SPEC §2)',
    fn() {
      const s = mkBattle({ units: [
        { form: 'Bulwhark', owner: 0, x: 3, y: 3 },
        { form: 'Cinderling', owner: 0, x: 3, y: 4 },   // ally
        { form: 'Butcherbeak', owner: 1, x: 4, y: 3 },  // enemy
      ]});
      const s1 = GM.applyAction(s, 0, { t: 'activate', unitId: 0 });
      assertThrows(() => GM.applyAction(s1, 0, { t: 'move', path: [{ x: 3, y: 4 }] }), 'end on ally');
      assertThrows(() => GM.applyAction(s1, 0, { t: 'move', path: [{ x: 4, y: 3 }] }), 'end on enemy');
    },
  },

  {
    name: 'move: cannot pass THROUGH any unit without Skulk — ally or enemy intermediate square throws (SPEC §2)',
    fn() {
      const s = mkBattle({ units: [
        { form: 'Bulwhark', owner: 0, x: 3, y: 3 },     // no skulk trait
        { form: 'Cinderling', owner: 0, x: 3, y: 4 },
        { form: 'Butcherbeak', owner: 1, x: 4, y: 3 },
      ]});
      const s1 = GM.applyAction(s, 0, { t: 'activate', unitId: 0 });
      assertThrows(() => GM.applyAction(s1, 0,
        { t: 'move', path: [{ x: 3, y: 4 }, { x: 3, y: 5 }] }), 'through ally');
      assertThrows(() => GM.applyAction(s1, 0,
        { t: 'move', path: [{ x: 4, y: 3 }, { x: 5, y: 3 }] }), 'through enemy');
    },
  },

  // ---------------------------------------------------------------- move 0 / action-state legality

  {
    name: 'moving 0 squares is legal: activate, skip the move, attack (Basic 2 on Dark, no doubling: Water beats Fire/Ground only) — pos and facing unchanged',
    fn() {
      const s = mkBattle({ units: [
        { form: 'Bulwhark', owner: 0, x: 3, y: 3 },
        { form: 'Butcherbeak', owner: 1, x: 3, y: 4 },  // hp 5
      ]});
      let s1 = GM.applyAction(s, 0, { t: 'activate', unitId: 0 });
      s1 = GM.applyAction(s1, 0, { t: 'attack', kind: 'basic', target: { x: 3, y: 4 } });
      s1 = GM.applyAction(s1, 0, { t: 'endActivation' });
      assertEq(unit(s1, 1).hp, 3, 'Basic 2: 5 -> 3');
      assertEq(unit(s1, 0).pos, { x: 3, y: 3 }, 'never moved');
      assertEq(unit(s1, 0).facing, 'N', 'facing untouched by not moving / by attacking');
    },
  },

  {
    name: 'move rejected outside an activation: no activation in progress, wrong player, activating an enemy unit (CONTRACT actions)',
    fn() {
      const s = mkBattle({ units: [
        { form: 'Bulwhark', owner: 0, x: 3, y: 3 },
        { form: 'Butcherbeak', owner: 1, x: 7, y: 7 },
      ]});
      assertThrows(() => GM.applyAction(s, 0, { t: 'move', path: [{ x: 3, y: 4 }] }),
        'move with no activation in progress');
      const s1 = GM.applyAction(s, 0, { t: 'activate', unitId: 0 });
      assertThrows(() => GM.applyAction(s1, 1, { t: 'move', path: [{ x: 3, y: 4 }] }),
        'wrong player issuing the move');
      assertThrows(() => GM.applyAction(s, 0, { t: 'activate', unitId: 1 }),
        'P0 activating an enemy unit');
      assertThrows(() => GM.applyAction(s, 1, { t: 'activate', unitId: 1 }),
        'P1 acting on P0\'s turn');
    },
  },

  {
    name: 'one move per activation; move must precede attack — second move throws, move-after-attack throws (SPEC §1: (a) move then (b) attack)',
    fn() {
      const s = mkBattle({ units: [
        { form: 'Bulwhark', owner: 0, x: 3, y: 3 },
        { form: 'Butcherbeak', owner: 1, x: 4, y: 3 },
      ]});
      let a = GM.applyAction(s, 0, { t: 'activate', unitId: 0 });
      a = GM.applyAction(a, 0, { t: 'move', path: [{ x: 3, y: 4 }] });
      assertThrows(() => GM.applyAction(a, 0, { t: 'move', path: [{ x: 3, y: 5 }] }),
        'second move in one activation');
      let b = GM.applyAction(s, 0, { t: 'activate', unitId: 0 });
      b = GM.applyAction(b, 0, { t: 'attack', kind: 'basic', target: { x: 4, y: 3 } });
      assertThrows(() => GM.applyAction(b, 0, { t: 'move', path: [{ x: 3, y: 4 }] }),
        'move after attacking');
    },
  },

  {
    name: 'a unit cannot be activated twice in one turn (SPEC §1)',
    fn() {
      const s = mkBattle({ units: [
        { form: 'Bulwhark', owner: 0, x: 3, y: 3 },
        { form: 'Butcherbeak', owner: 1, x: 7, y: 7 },
      ]});
      const s1 = act(s, 0, 0, {});  // activate + endActivation, no move/attack
      assertThrows(() => GM.applyAction(s1, 0, { t: 'activate', unitId: 0 }),
        'second activation of unit 0 in the same turn');
    },
  },

  // ---------------------------------------------------------------- facing

  {
    name: 'facing set by direction of final step: single-step moves N/E/S/W (SPEC §2)',
    fn() {
      const s = mkBattle({ units: [
        { form: 'Pyroclasm', owner: 0, x: 3, y: 3 },
        { form: 'Butcherbeak', owner: 1, x: 7, y: 7 },
      ]});
      const cases = [
        [{ x: 3, y: 4 }, 'N'],  // +y
        [{ x: 4, y: 3 }, 'E'],  // +x
        [{ x: 3, y: 2 }, 'S'],  // -y
        [{ x: 2, y: 3 }, 'W'],  // -x
      ];
      for (const [step, want] of cases) {
        const s1 = play(s, [[0, { t: 'activate', unitId: 0 }], [0, { t: 'move', path: [step] }]]);
        assertEq(unit(s1, 0).facing, want, `final step toward ${want}`);
      }
    },
  },

  {
    name: 'facing: multi-step path E,N,W — only the FINAL step sets facing (=> W)',
    fn() {
      const s = mkBattle({ units: [
        { form: 'Pyroclasm', owner: 0, x: 3, y: 3 },
        { form: 'Butcherbeak', owner: 1, x: 7, y: 7 },
      ]});
      const s1 = play(s, [
        [0, { t: 'activate', unitId: 0 }],
        [0, { t: 'move', path: [{ x: 4, y: 3 }, { x: 4, y: 4 }, { x: 3, y: 4 }] }],
      ]);
      assertEq(unit(s1, 0).pos, { x: 3, y: 4 });
      assertEq(unit(s1, 0).facing, 'W', 'last step was -x');
    },
  },

  {
    name: 'default facing after draft+placement: every P0 unit faces N, every P1 unit faces S (SPEC §2: toward enemy back rank)',
    fn() {
      // Full pipeline: createGame -> tyrant phase + snake draft -> placement.
      // coinWinner 0 => order [0,1] then snake L W W L L W W L L W with L=1.
      let s = GM.createGame(42, 0);
      s = play(s, [
        [0, { t: 'pick', lineId: 'cinderling' }],  // winner's tyrant
        [1, { t: 'pick', lineId: 'wyrmlet' }],     // loser's tyrant (frostfawn cut)
        [1, { t: 'pick', lineId: 'sootpup' }],
        [0, { t: 'pick', lineId: 'snapling' }],
        [0, { t: 'pick', lineId: 'guppling' }],
        [1, { t: 'pick', lineId: 'mosskit' }],
        [1, { t: 'pick', lineId: 'podling' }],
        [0, { t: 'pick', lineId: 'zapkitt' }],
        [0, { t: 'pick', lineId: 'coilbug' }],
        [1, { t: 'pick', lineId: 'gritling' }],
        [1, { t: 'pick', lineId: 'cacklet' }],
        [0, { t: 'pick', lineId: 'falchick' }],
      ]);
      assertEq(s.phase, 'placement', 'draft complete after 12 picks');
      s = play(s, [
        [0, { t: 'place', lineId: 'cinderling', x: 0, y: 0 }],
        [0, { t: 'place', lineId: 'snapling', x: 1, y: 0 }],
        [0, { t: 'place', lineId: 'guppling', x: 2, y: 0 }],
        [0, { t: 'place', lineId: 'zapkitt', x: 3, y: 1 }],
        [0, { t: 'place', lineId: 'coilbug', x: 4, y: 1 }],
        [0, { t: 'place', lineId: 'falchick', x: 5, y: 1 }],
        [0, { t: 'confirm' }],
        [1, { t: 'place', lineId: 'wyrmlet', x: 0, y: 7 }],
        [1, { t: 'place', lineId: 'sootpup', x: 1, y: 7 }],
        [1, { t: 'place', lineId: 'mosskit', x: 2, y: 7 }],
        [1, { t: 'place', lineId: 'podling', x: 3, y: 6 }],
        [1, { t: 'place', lineId: 'gritling', x: 4, y: 6 }],
        [1, { t: 'place', lineId: 'cacklet', x: 5, y: 6 }],
        [1, { t: 'confirm' }],
      ]);
      assertEq(s.phase, 'battle', 'both confirmed -> battle');
      assertEq(s.units.length, 12);
      for (const u of s.units) {
        assertEq(u.facing, u.owner === 0 ? 'N' : 'S', `unit ${u.id} default facing`);
      }
    },
  },

  {
    name: 'Push does not change facing: Tidal Ram (3 dmg, Water vs Ice = no doubling) pushes victim (3,4)->(3,5); victim keeps S, attacker keeps preset E (SPEC §2)',
    fn() {
      const s = mkBattle({ units: [
        { form: 'Bulwhark', owner: 0, x: 3, y: 3, facing: 'E' },
        { form: 'Maulberg', owner: 1, x: 3, y: 4 },  // hp 8
      ]});
      const s1 = act(s, 0, 0, { attack: { kind: 'special', dir: { dx: 0, dy: 1 } } });  // lunge declined
      assertEq(unit(s1, 1).hp, 5, 'Tidal Ram 3 dmg: 8 -> 5');
      assertEq(unit(s1, 1).pos, { x: 3, y: 5 }, 'pushed 1 away from attacker');
      assertEq(unit(s1, 1).facing, 'S', 'push never changes facing');
      assertEq(unit(s1, 0).facing, 'E', 'attacking never changes facing');
    },
  },

  {
    name: 'Lunge does not change facing: Pounce (3 dmg, Ground vs Ice = no doubling) then lunge to (2,4); attacker keeps preset E (SPEC §2: teleports keep facing)',
    fn() {
      const s = mkBattle({ units: [
        { form: 'Pumarok', owner: 0, x: 3, y: 3, facing: 'E' },
        { form: 'Maulberg', owner: 1, x: 3, y: 5 },  // hp 8, range-2 single up N
      ]});
      const s1 = act(s, 0, 0, { attack: { kind: 'special', dir: { dx: 0, dy: 1 }, lungeTo: { x: 2, y: 4 } } });
      assertEq(unit(s1, 1).hp, 5, 'Pounce 3 dmg: 8 -> 5');
      assertEq(unit(s1, 0).pos, { x: 2, y: 4 }, 'lunged 8-adjacent to target');
      assertEq(unit(s1, 0).facing, 'E', 'lunge never changes facing');
    },
  },

  {
    name: 'Blink does not change facing: Mindclaw (3 dmg, Psychic doubles nothing) then blink to Chebyshev-2 (5,3); attacker keeps preset W',
    fn() {
      const s = mkBattle({ units: [
        { form: 'Velvesper', owner: 0, x: 3, y: 3, facing: 'W' },
        { form: 'Maulberg', owner: 1, x: 3, y: 4 },  // hp 8, Mindclaw range 1
      ]});
      const s1 = act(s, 0, 0, { attack: { kind: 'special', dir: { dx: 0, dy: 1 }, blinkTo: { x: 5, y: 3 } } });
      assertEq(unit(s1, 1).hp, 5, 'Mindclaw 3 dmg: 8 -> 5');
      assertEq(unit(s1, 0).pos, { x: 5, y: 3 }, 'blinked within Chebyshev 2');
      assertEq(unit(s1, 0).facing, 'W', 'blink never changes facing');
    },
  },

  {
    name: 'Telegrab relocation does not change victim facing: Archistrix grabs (5,5)->(5,3), Telesmash 1 (first lifetime grab), victim keeps S',
    fn() {
      const s = mkBattle({ units: [
        { form: 'Archistrix', owner: 0, x: 3, y: 3 },
        { form: 'Maulberg', owner: 1, x: 5, y: 5 },  // hp 8; Chebyshev 2 <= range 3
      ]});
      const s1 = act(s, 0, 0, { attack: { kind: 'special', targetUnit: 1, relocateTo: { x: 5, y: 3 } } });
      assertEq(unit(s1, 1).pos, { x: 5, y: 3 }, 'relocated within Chebyshev 2 of victim');
      assertEq(unit(s1, 1).hp, 7, 'Telesmash = lifetime count incl. this grab = 1: 8 -> 7');
      assertEq(unit(s1, 1).telegrabs, 1);
      assertEq(unit(s1, 1).facing, 'S', 'telegrab relocation never changes facing');
    },
  },

  {
    name: 'Earthquake displacement does not change facing: seed 7 first d4=1=N (CONTRACT mulberry32), victim (3,4)->(3,5) keeps preset E; rng advances to 1831565820',
    fn() {
      // P1's turn ends; P0's start-of-turn step 3 quakes P0 units 8-adjacent to Terradon.
      const s = mkBattle({ turn: 1, seed: 7, units: [
        { form: 'Bulwhark', owner: 0, x: 3, y: 4, facing: 'E' },  // evolve:null, won't evolve
        { form: 'Terradon', owner: 1, x: 3, y: 3 },
      ]});
      const s1 = endTurn(s, 1);
      assertEq(s1.turn.player, 0, 'turn passed to P0');
      assertEq(unit(s1, 0).pos, { x: 3, y: 5 }, 'd4=1 -> N: (3,4)->(3,5)');
      assertEq(unit(s1, 0).facing, 'E', 'earthquake displacement never changes facing');
      assertEq(s1.rng, 1831565820, 'one rngStep consumed (next state per CONTRACT snippet)');
    },
  },

  // ---------------------------------------------------------------- rear squares (via Backstab, SPEC §3 + CONTRACT geometry)

  {
    name: 'rear squares per facing: Backstab +2 after doubling (Basic 2+2=4, Dark vs Water = no doubling) from a rear square for facings N/E/S/W (CONTRACT: N rear=y-1 row, E rear=x-1, S rear=y+1, W rear=x+1)',
    fn() {
      // Defender at (3,3); attacker placed on a DIAGONAL rear square each time
      // to exercise the full 3-square rear row. No other ally => flanking off.
      const cases = [
        ['N', { x: 2, y: 2 }],  // rear row y=2: (2,2),(3,2),(4,2)
        ['E', { x: 2, y: 4 }],  // rear col x=2: (2,2),(2,3),(2,4)
        ['S', { x: 4, y: 4 }],  // rear row y=4: (2,4),(3,4),(4,4)
        ['W', { x: 4, y: 2 }],  // rear col x=4: (4,2),(4,3),(4,4)
      ];
      for (const [facing, apos] of cases) {
        const s = mkBattle({ units: [
          { form: 'Pantherebus', owner: 0, x: apos.x, y: apos.y },
          { form: 'Bulwhark', owner: 1, x: 3, y: 3, facing },  // hp 8
        ]});
        const s1 = act(s, 0, 0, { attack: { kind: 'basic', target: { x: 3, y: 3 } } });
        assertEq(unit(s1, 1).hp, 4, `facing ${facing}: rear Basic 2 + Backstab 2 = 4 (8 -> 4)`);
      }
    },
  },

  {
    name: 'non-rear adjacent squares give NO Backstab: front (3,4) and side (2,3) vs defender facing N deal plain Basic 2 (no other ally => no flanking)',
    fn() {
      for (const apos of [{ x: 3, y: 4 }, { x: 2, y: 3 }]) {
        const s = mkBattle({ units: [
          { form: 'Pantherebus', owner: 0, x: apos.x, y: apos.y },
          { form: 'Bulwhark', owner: 1, x: 3, y: 3, facing: 'N' },  // rear is only the y=2 row
        ]});
        const s1 = act(s, 0, 0, { attack: { kind: 'basic', target: { x: 3, y: 3 } } });
        assertEq(unit(s1, 1).hp, 6, `from ${apos.x},${apos.y}: plain Basic 2 (8 -> 6)`);
      }
    },
  },

  // ---------------------------------------------------------------- pinned / rooted / frozen

  {
    name: 'pinned unit (pinnedTurn == playerTurns[owner] == 1) cannot move, reachable empty, but may still attack (SPEC §3 Pin; CONTRACT pinnedTurn model)',
    fn() {
      const s = mkBattle({ units: [
        { form: 'Bulwhark', owner: 0, x: 3, y: 3, pinnedTurn: 1 },  // playerTurns default [1,0]
        { form: 'Butcherbeak', owner: 1, x: 3, y: 4 },  // hp 5
      ]});
      assert(GM.isPinned(s, 0), 'isPinned');
      assertEq(GM.reachable(s, 0).length, 0, 'pinned: no reachable squares');
      let s1 = GM.applyAction(s, 0, { t: 'activate', unitId: 0 });
      assertThrows(() => GM.applyAction(s1, 0, { t: 'move', path: [{ x: 2, y: 3 }] }), 'pinned move');
      s1 = GM.applyAction(s1, 0, { t: 'attack', kind: 'basic', target: { x: 3, y: 4 } });
      assertEq(unit(s1, 1).hp, 3, 'pinned unit still attacks: Basic 2 (5 -> 3)');
    },
  },

  {
    name: 'rooted unit (Talonlock self-root, rootedTurn == 1) cannot move but may still attack (SPEC §3 Talonlock; root == pin semantics)',
    fn() {
      const s = mkBattle({ units: [
        { form: 'Peregale', owner: 0, x: 3, y: 3, rootedTurn: 1 },
        { form: 'Maulberg', owner: 1, x: 3, y: 4 },  // hp 8; Flying doubles Grass only
      ]});
      assertEq(GM.reachable(s, 0).length, 0, 'rooted: no reachable squares');
      let s1 = GM.applyAction(s, 0, { t: 'activate', unitId: 0 });
      assertThrows(() => GM.applyAction(s1, 0, { t: 'move', path: [{ x: 4, y: 3 }] }), 'rooted move');
      s1 = GM.applyAction(s1, 0, { t: 'attack', kind: 'basic', target: { x: 3, y: 4 } });
      assertEq(unit(s1, 1).hp, 6, 'rooted unit still attacks: Basic 2 (8 -> 6)');
    },
  },

  {
    name: 'pin clears at end of the pinned turn: blocked this turn, pinnedTurn reset to 0 at turn end, free to move on the owner\'s next turn (CONTRACT turn-pass)',
    fn() {
      const s = mkBattle({ units: [
        { form: 'Bulwhark', owner: 0, x: 3, y: 3, pinnedTurn: 1 },
        { form: 'Tavrik', owner: 1, x: 7, y: 7 },  // no evolution, no auras
      ]});
      const a = GM.applyAction(s, 0, { t: 'activate', unitId: 0 });
      assertThrows(() => GM.applyAction(a, 0, { t: 'move', path: [{ x: 3, y: 4 }] }), 'blocked now');
      let s1 = endTurn(s, 0);              // pinnedTurn(1) == outgoing turn number -> cleared
      assertEq(unit(s1, 0).pinnedTurn, 0, 'cleared at end of pinned turn');
      s1 = endTurn(s1, 1);                 // P1 passes; P0 turn 2 starts
      assertEq(s1.turn.player, 0);
      const s2 = play(s1, [[0, { t: 'activate', unitId: 0 }],
                           [0, { t: 'move', path: [{ x: 3, y: 4 }] }]]);
      assertEq(unit(s2, 0).pos, { x: 3, y: 4 }, 'free to move next turn');
    },
  },

  {
    name: 'Hard Frozen (Speed 2, chill 1 -> effective 0): activation allowed but BOTH move and attack rejected; reachable empty (SPEC §3 Chill; DEV-PIN 16)',
    fn() {
      const s = mkBattle({ units: [
        { form: 'Cinderling', owner: 0, x: 3, y: 3, chill: 1 },  // base speed 2 - 2*1 = 0
        { form: 'Butcherbeak', owner: 1, x: 3, y: 4 },
      ]});
      assert(GM.isFrozen(s, 0), 'speed-2 unit Hard Freezes from a single stack');
      assertEq(GM.effectiveSpeed(s, 0), 0);
      assertEq(GM.reachable(s, 0).length, 0, 'frozen: no reachable squares');
      const s1 = GM.applyAction(s, 0, { t: 'activate', unitId: 0 });  // legal (wasted) per DEV-PIN 16
      assertThrows(() => GM.applyAction(s1, 0, { t: 'move', path: [{ x: 2, y: 3 }] }), 'frozen move');
      assertThrows(() => GM.applyAction(s1, 0, { t: 'attack', kind: 'basic', target: { x: 3, y: 4 } }),
        'frozen attack');
    },
  },

  {
    name: 'Chill reduces effective Speed by 2 per stack: Leviadon speed 4, chill 1 -> exactly 2 steps (3 throws, 2 lands); not frozen',
    fn() {
      const s = mkBattle({ units: [
        { form: 'Leviadon', owner: 0, x: 3, y: 3, chill: 1 },
        { form: 'Butcherbeak', owner: 1, x: 7, y: 7 },
      ]});
      assertEq(GM.effectiveSpeed(s, 0), 2, '4 - 2*1 = 2');
      assert(!GM.isFrozen(s, 0), 'speed > 0: not Hard Frozen');
      const s1 = GM.applyAction(s, 0, { t: 'activate', unitId: 0 });
      assertThrows(() => GM.applyAction(s1, 0,
        { t: 'move', path: [{ x: 3, y: 4 }, { x: 3, y: 5 }, { x: 3, y: 6 }] }), '3 > effective 2');
      const s2 = GM.applyAction(s1, 0, { t: 'move', path: [{ x: 3, y: 4 }, { x: 3, y: 5 }] });
      assertEq(unit(s2, 0).pos, { x: 3, y: 5 }, '2-step move legal');
      const keys = xyKeys(notStart(GM.reachable(s, 0), 3, 3));
      assert(keys.includes('3,5') && !keys.includes('3,6'), 'reachable radius shrunk to 2');
    },
  },

  // ---------------------------------------------------------------- Skulk

  {
    name: 'Skulk passes THROUGH friend and foe but cannot END on either (SPEC §3 Skulk: Duskpard speed 3 walks (3,4)ally,(3,5)foe -> (3,6))',
    fn() {
      const s = mkBattle({ units: [
        { form: 'Duskpard', owner: 0, x: 3, y: 3 },     // skulk, speed 3
        { form: 'Cinderling', owner: 0, x: 3, y: 4 },   // ally in the way
        { form: 'Butcherbeak', owner: 1, x: 3, y: 5 },  // foe in the way
      ]});
      const s1 = GM.applyAction(s, 0, { t: 'activate', unitId: 0 });
      assertThrows(() => GM.applyAction(s1, 0, { t: 'move', path: [{ x: 3, y: 4 }] }),
        'skulker may not END on the ally');
      assertThrows(() => GM.applyAction(s1, 0, { t: 'move', path: [{ x: 3, y: 4 }, { x: 3, y: 5 }] }),
        'skulker may not END on the foe');
      const s2 = GM.applyAction(s1, 0,
        { t: 'move', path: [{ x: 3, y: 4 }, { x: 3, y: 5 }, { x: 3, y: 6 }] });
      assertEq(unit(s2, 0).pos, { x: 3, y: 6 }, 'through two bodies to an empty square');
      assertEq(unit(s2, 0).facing, 'N', 'skulk move still sets facing by final step');
      const keys = xyKeys(notStart(GM.reachable(s, 0), 3, 3));
      assert(keys.includes('3,6'), 'reachable sees through-square destination');
      assert(!keys.includes('3,4') && !keys.includes('3,5'), 'occupied squares never reachable destinations');
    },
  },

  {
    name: 'a skulker\'s body still blocks everyone else: non-skulk ally cannot path through Duskpard (SPEC §3 Skulk)',
    fn() {
      const s = mkBattle({ units: [
        { form: 'Bulwhark', owner: 0, x: 3, y: 3 },   // speed 3, no skulk
        { form: 'Duskpard', owner: 0, x: 3, y: 4 },   // skulking body
        { form: 'Butcherbeak', owner: 1, x: 7, y: 7 },
      ]});
      const s1 = GM.applyAction(s, 0, { t: 'activate', unitId: 0 });
      assertThrows(() => GM.applyAction(s1, 0, { t: 'move', path: [{ x: 3, y: 4 }, { x: 3, y: 5 }] }),
        'through the skulker');
      const keys = xyKeys(notStart(GM.reachable(s, 0), 3, 3));
      assert(!keys.includes('3,4'), 'skulker square occupied');
      assert(!keys.includes('3,5'), '(3,5) needs 4 steps around the skulker: beyond speed 3');
    },
  },

  // ---------------------------------------------------------------- reachable <-> move agreement

  {
    name: 'GM.reachable agrees with move legality: cluttered board matches an independent reference BFS (19 squares); every returned path applies; (3,3) at Manhattan 2 is unreachable (BFS dist 6 > speed 4)',
    fn() {
      const s = mkBattle({ units: [
        { form: 'Leviadon', owner: 0, x: 2, y: 2 },     // speed 4
        { form: 'Cinderling', owner: 0, x: 2, y: 3 },   // ally blocker
        { form: 'Butcherbeak', owner: 1, x: 3, y: 2 },  // foe blocker
        { form: 'Tavrik', owner: 1, x: 1, y: 1 },       // foe blocker
      ]});
      // Reference BFS computed independently in this test file's review notes:
      const expected = [
        { x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }, { x: 0, y: 3 }, { x: 0, y: 4 },
        { x: 1, y: 0 }, { x: 1, y: 2 }, { x: 1, y: 3 }, { x: 1, y: 4 }, { x: 1, y: 5 },
        { x: 2, y: 0 }, { x: 2, y: 1 }, { x: 2, y: 4 },
        { x: 3, y: 0 }, { x: 3, y: 1 },
        { x: 4, y: 0 }, { x: 4, y: 1 }, { x: 4, y: 2 },
        { x: 5, y: 1 },
      ];
      const r = notStart(GM.reachable(s, 0), 2, 2);
      assertEq(xyKeys(r), xyKeys(expected), 'reachable set == reference BFS');
      const base = GM.applyAction(s, 0, { t: 'activate', unitId: 0 });
      for (const e of r) {
        validatePath(s, 2, 2, e.path, 4, e.x, e.y);  // independent legality check
        const moved = GM.applyAction(base, 0, { t: 'move', path: e.path });  // engine agreement
        assertEq(unit(moved, 0).pos, { x: e.x, y: e.y }, `engine accepts path to ${e.x},${e.y}`);
      }
      assert(!xyKeys(r).includes('3,3'), '(3,3) walled off: shortest detour is 6 steps');
      assertThrows(() => GM.applyAction(base, 0,
        { t: 'move', path: [{ x: 3, y: 2 }, { x: 3, y: 3 }] }), 'direct path runs through the foe');
    },
  },
];
