// Shared test harness. State shapes here are normative per CONTRACT.md —
// if the engine disagrees with a state built by mkBattle, the engine is wrong
// (unless SPEC.md says otherwise).
const GM = require('../engine.js');
const DATA = require('../data.js');

const lineById = {};
for (const line of DATA.lines) lineById[line.id] = line;

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}
function assertEq(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg || 'assertEq failed'}: expected ${e}, got ${a}`);
}
function assertThrows(fn, msg) {
  try { fn(); } catch (err) { return err; }
  throw new Error(msg || 'expected an Error, none thrown');
}

// Find the stage index of a form by its display name, e.g. stageIndex('Pyroclasm') -> 2.
function stageIndex(formName) {
  for (const line of DATA.lines) {
    const i = line.stages.findIndex(s => s.name === formName);
    if (i !== -1) return { lineId: line.id, stage: i };
  }
  throw new Error(`unknown form name: ${formName}`);
}

// Build a mid-battle state directly (skipping draft/placement).
// spec: {
//   units: [ { form:'Pyroclasm', owner:0, x:3, y:3, hp?, facing?, pinnedTurn?, rootedTurn?,
//              burn?, poison?, chill?, hexTurns?, telegrabs?, survived?, dealt?, kos?, allyKoSeen? }, ... ],
//   turn?: 0|1 (default 0 — that player's turn, mid-turn, start-of-turn already done),
//   playerTurns?: [int,int] (default [1,0] when turn=0, [1,1] when turn=1),
//   seed?: uint32 (default 42), activationsUsed?, activated?: [unitId],
// }
// Returns a full battle-phase state. Unit ids are array indices in the given order.
function mkBattle(spec) {
  const turn = spec.turn || 0;
  const seed = spec.seed === undefined ? 42 : spec.seed;
  const playerTurns = spec.playerTurns || (turn === 0 ? [1, 0] : [1, 1]);
  const units = spec.units.map((u, i) => {
    const { lineId, stage } = stageIndex(u.form);
    const st = lineById[lineId].stages[stage];
    return {
      id: i, owner: u.owner, lineId, stage,
      hp: u.hp === undefined ? st.hp : u.hp,
      pos: (u.x === undefined) ? null : { x: u.x, y: u.y },
      facing: u.facing || (u.owner === 0 ? 'N' : 'S'),
      pinnedTurn: u.pinnedTurn || 0,
      rootedTurn: u.rootedTurn || 0,
      burn: u.burn || null,
      poison: u.poison || 0,
      chill: u.chill || 0,
      hexTurns: u.hexTurns || 0,
      telegrabs: u.telegrabs || 0,
      survived: u.survived || 0,
      dealt: u.dealt || 0,
      kos: u.kos || 0,
      allyKoSeen: u.allyKoSeen || false,
    };
  });
  return {
    v: 1, seed, rng: seed, coinWinner: 0,
    phase: 'battle',
    draft: { order: [], pickIndex: 12, cutTyrant: null, teams: [[], []] },
    placement: { current: 1, confirmed: [true, true] },
    units, playerTurns,
    turn: {
      player: turn,
      activationsUsed: spec.activationsUsed || 0,
      activated: spec.activated || [],
      current: null,
      pendingAuras: null,
    },
    winner: null,
    log: [],
  };
}

// Apply a sequence of actions, returning the final state. Each entry: [player, action].
function play(state, steps) {
  let s = state;
  for (const [player, action] of steps) s = GM.applyAction(s, player, action);
  return s;
}

// Activate unit, optionally move along path, optionally attack, then end activation.
// If the attack ends the game, stop there: SPEC §1 "A player wins immediately when
// all enemy units are KO'd", and CONTRACT's action table accepts only {t:'rematch'}
// in phase 'over' — sending endActivation after a win is an illegal action.
function act(state, player, unitId, { path, attack } = {}) {
  let s = GM.applyAction(state, player, { t: 'activate', unitId });
  if (path) s = GM.applyAction(s, player, { t: 'move', path });
  if (attack) s = GM.applyAction(s, player, { t: 'attack', ...attack });
  if (s.phase === 'over') return s;
  return GM.applyAction(s, player, { t: 'endActivation' });
}

// End the active player's turn, resolving pending auras with the given choices
// (array of {unitId, target?}); auras with no choice needed are auto-resolved in id order.
function endTurn(state, player, auraChoices = []) {
  let s = GM.applyAction(state, player, { t: 'endTurn' });
  const chosen = [...auraChoices];
  while (s.phase === 'battle' && s.turn.pendingAuras && s.turn.pendingAuras.length) {
    let next = chosen.shift();
    if (!next) next = { unitId: s.turn.pendingAuras[0] };
    s = GM.applyAction(s, player, { t: 'aura', ...next });
  }
  return s;
}

function unit(state, id) { return state.units[id]; }
function at(state, x, y) {
  return state.units.find(u => u.pos && u.pos.x === x && u.pos.y === y) || null;
}

module.exports = { GM, DATA, lineById, assert, assertEq, assertThrows, stageIndex, mkBattle, play, act, endTurn, unit, at };
