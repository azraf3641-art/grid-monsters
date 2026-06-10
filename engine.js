// engine.js — Grid Monsters v7 pure game engine.
// Rules authority: SPEC.md; API + interpretation rulings: CONTRACT.md.
// Pure logic: no DOM, no timers, no Math.random — the only randomness is the
// seeded mulberry32 RNG carried in state.rng, consumed ONLY by Earthquake.
const GM_DATA = (typeof module !== 'undefined') ? require('./data.js') : window.GM_DATA;

const BOARD = GM_DATA.boardSize;
const LINE_BY_ID = {};
for (const line of GM_DATA.lines) LINE_BY_ID[line.id] = line;

// N=(0,+1) E=(+1,0) S=(0,-1) W=(-1,0); Earthquake d4: 1→N 2→E 3→S 4→W.
const CARDINALS = { N: { dx: 0, dy: 1 }, E: { dx: 1, dy: 0 }, S: { dx: 0, dy: -1 }, W: { dx: -1, dy: 0 } };
const CARDINAL_NAMES = ['N', 'E', 'S', 'W'];
const DIRS8 = [
  { dx: 0, dy: 1 }, { dx: 1, dy: 1 }, { dx: 1, dy: 0 }, { dx: 1, dy: -1 },
  { dx: 0, dy: -1 }, { dx: -1, dy: -1 }, { dx: -1, dy: 0 }, { dx: -1, dy: 1 },
];

function fail(msg) { throw new Error(msg); }
function clone(x) { return JSON.parse(JSON.stringify(x)); }
function inBoard(x, y) { return x >= 0 && x < BOARD && y >= 0 && y < BOARD; }
function cheb(a, b) { return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)); }
function manhattan(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }
function sgn(n) { return n > 0 ? 1 : n < 0 ? -1 : 0; }
function sq(x, y) { return { x, y }; }
function sameSq(a, b) { return a.x === b.x && a.y === b.y; }

function reqSquare(p, label) {
  if (!p || !Number.isInteger(p.x) || !Number.isInteger(p.y)) fail(label + ': a square {x,y} is required');
  if (!inBoard(p.x, p.y)) fail(label + ': square (' + p.x + ',' + p.y + ') is off the board');
  return p;
}
function reqDir(d) {
  if (!d || !Number.isInteger(d.dx) || !Number.isInteger(d.dy)) fail('a direction {dx,dy} is required');
  if (d.dx < -1 || d.dx > 1 || d.dy < -1 || d.dy > 1 || (d.dx === 0 && d.dy === 0)) fail('illegal direction');
  return d;
}

// ---- RNG (mulberry32, per CONTRACT — Earthquake only) ----
function rngStep(s) {
  let t = (s + 0x6D2B79F5) >>> 0;
  let r = t;
  r = Math.imul(r ^ (r >>> 15), r | 1);
  r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
  return { value: ((r ^ (r >>> 14)) >>> 0) / 4294967296, next: t };
}
function rollD4(state) {
  const r = rngStep(state.rng);
  state.rng = r.next;
  return Math.floor(r.value * 4) + 1;
}

// ---- Unit / data helpers ----
function lineOf(unit) { return LINE_BY_ID[unit.lineId]; }
function stageOf(unit) { return LINE_BY_ID[unit.lineId].stages[unit.stage]; }
function unitName(unit) { return stageOf(unit).name; }
function hasTrait(unit, t) { return stageOf(unit).traits.indexOf(t) !== -1; }
function unitAt(state, x, y) {
  for (const u of state.units) if (u.pos && u.pos.x === x && u.pos.y === y) return u;
  return null;
}
function getUnit(state, unitId) {
  const u = state.units[unitId];
  if (!u || u.id !== unitId) fail('no such unit: ' + unitId);
  return u;
}
function log(state, msg) { state.log.push({ msg }); }

// Blood Scent: Tavrik's base Speed is +2 (4→6) while an enemy Rival final form lives.
function baseSpeed(state, unit) {
  let sp = stageOf(unit).speed;
  if (hasTrait(unit, 'tyrantbane')) {
    const enemyRival = state.units.some(u => u.pos && u.owner !== unit.owner && stageOf(u).rival);
    if (enemyRival) sp += 2;
  }
  return sp;
}
function isFrozenU(state, unit) {
  return unit.chill > 0 && baseSpeed(state, unit) - 2 * unit.chill <= 0;
}
function effectiveSpeed(state, unitId) {
  const u = getUnit(state, unitId);
  return Math.max(0, baseSpeed(state, u) - 2 * u.chill);
}
function isFrozen(state, unitId) { return isFrozenU(state, getUnit(state, unitId)); }
function isPinned(state, unitId) { return getUnit(state, unitId).pinnedTurn > 0; }
function maxHp(state, unitId) { return stageOf(getUnit(state, unitId)).hp; }

// Reason string if the unit's move step (a) is blocked, else null.
function moveBlocked(state, unit) {
  const t = state.playerTurns[unit.owner];
  if (unit.pinnedTurn === t) return 'pinned';
  if (unit.rootedTurn === t) return 'rooted (Talonlock)';
  if (isFrozenU(state, unit)) return 'Hard Frozen';
  return null;
}

// Rear squares: the 3 squares on the side opposite the unit's facing.
function rearSquares(unit) {
  const { x, y } = unit.pos;
  const f = unit.facing;
  let out;
  if (f === 'N') out = [sq(x - 1, y - 1), sq(x, y - 1), sq(x + 1, y - 1)];
  else if (f === 'S') out = [sq(x - 1, y + 1), sq(x, y + 1), sq(x + 1, y + 1)];
  else if (f === 'E') out = [sq(x - 1, y - 1), sq(x - 1, y), sq(x - 1, y + 1)];
  else out = [sq(x + 1, y - 1), sq(x + 1, y), sq(x + 1, y + 1)];
  return out.filter(p => inBoard(p.x, p.y));
}

function backstabTriggers(state, attacker, victim) {
  if (rearSquares(victim).some(p => sameSq(p, attacker.pos))) return true;
  // Flanking: defender 8-adjacent to at least one OTHER unit allied with the attacker.
  return state.units.some(u => u.pos && u.owner === attacker.owner && u.id !== attacker.id &&
    cheb(u.pos, victim.pos) === 1);
}

// Dread Presence part 1: −1 (min 1) on attacks while 8-adjacent to an enemy Gravewinter.
// Tavrik is immune (Rival aura).
function dreadApplies(state, attacker) {
  if (hasTrait(attacker, 'tyrantbane')) return false;
  return state.units.some(u => u.pos && u.owner !== attacker.owner &&
    stageOf(u).aura === 'dreadPresence' && cheb(u.pos, attacker.pos) === 1);
}

// ---- KO / win / damage core ----
// Simultaneity rule: if a resolution empties BOTH sides at once, the player whose
// effect was resolving wins.
function checkWin(state, resolvingPlayer) {
  if (state.winner !== null) return;
  const a0 = state.units.some(u => u.pos && u.owner === 0);
  const a1 = state.units.some(u => u.pos && u.owner === 1);
  let w = null;
  if (!a0 && !a1) w = resolvingPlayer;
  else if (!a1) w = 0;
  else if (!a0) w = 1;
  if (w !== null) {
    state.winner = w;
    state.phase = 'over';
    log(state, 'Player ' + (w + 1) + ' wins!');
  }
}
function koUnit(state, victim, byId, resolvingPlayer) {
  victim.hp = 0;
  victim.pos = null;
  log(state, unitName(victim) + " is KO'd!");
  if (byId !== null && byId !== undefined && state.units[byId].owner !== victim.owner) {
    state.units[byId].kos += 1;
  }
  for (const u of state.units) {
    if (u.pos && u.owner === victim.owner && u.id !== victim.id) u.allyKoSeen = true;
  }
  checkWin(state, resolvingPlayer);
}
// amount = final damage (all modifiers incl. Hex already applied by the caller).
// byId credits "dealt" with actual HP removed (DEV-PIN 8) and the KO if lethal.
function dealDamage(state, victim, amount, byId, resolvingPlayer) {
  const actual = Math.min(amount, victim.hp);
  victim.hp -= amount;
  if (byId !== null && byId !== undefined) state.units[byId].dealt += actual;
  if (victim.hp <= 0) koUnit(state, victim, byId, resolvingPlayer);
  return actual;
}

// ---- Damage pipeline (per hit unit; CONTRACT pinned order) ----
// opts: { se: bool (super-effective AND this unit is the attack's focus), special }
function computeHitDamage(state, attacker, victim, baseDmg, opts) {
  let dmg = baseDmg;
  const notes = [];
  const atype = lineOf(attacker).type;
  const se = !!opts.se;
  const predator = hasTrait(attacker, 'talonlock') && victim.pinnedTurn > 0;
  const fireFrozen = atype === 'Fire' && isFrozenU(state, victim);
  const closeKill = hasTrait(attacker, 'tyrantbane') && stageOf(victim).rival;
  if (se || predator || fireFrozen || closeKill) {            // ×2 at most ONCE (global cap)
    dmg *= 2;
    notes.push(se ? 'super-effective' : predator ? 'predator ×2'
      : fireFrozen ? 'hard-frozen ×2' : 'close-kill ×2');
  }
  if (hasTrait(attacker, 'backstab') && backstabTriggers(state, attacker, victim)) {
    dmg += 2; notes.push('backstab +2');
  }
  if (hasTrait(attacker, 'butcher') && victim.pinnedTurn > 0) {
    dmg += 2; notes.push('butcher +2');
  }
  if (opts.special && opts.special.bonusPerChill && victim.chill > 0) {
    dmg += victim.chill; notes.push('+' + victim.chill + ' chill');
  }
  if (dreadApplies(state, attacker)) {
    dmg = Math.max(1, dmg - 1); notes.push('dread −1');
  }
  if (victim.hexTurns > 0) {
    dmg += 1; notes.push('hex +1');
  }
  return { dmg, notes };
}

// ---- Attack resolution ----
// Mutates `state` (a clone made by applyAction). Throws on any illegal declaration.
// If `meta` is given (preview mode): missing-focus / mandatory-lunge are not errors,
// rider movement is not applied, and meta collects
// {hits, needsFocus, focusEligible, lungeSquares, blinkSquares, mandatoryLunge}.
function performAttack(state, attacker, params, meta) {
  const preview = !!meta;
  if (meta) {
    meta.hits = []; meta.needsFocus = false; meta.focusEligible = [];
    meta.lungeSquares = []; meta.blinkSquares = []; meta.mandatoryLunge = false;
  }
  const st = stageOf(attacker);
  const declPos = { x: attacker.pos.x, y: attacker.pos.y };  // position the attack is made from
  const atype = lineOf(attacker).type;
  const attackerRival = st.rival;
  const beats = GM_DATA.typeChart[atype] || [];

  let special = null, attackName, baseDmg, pattern;
  let hitUnits = [];
  let coneNear = null, bombCenter = null;

  if (params.kind === 'basic') {
    pattern = 'basic';
    attackName = unitName(attacker) + ' Basic';
    baseDmg = st.basic;
    const t = reqSquare(params.target, 'Basic');
    if (cheb(declPos, t) !== 1) fail('Basic must target one of the 8 adjacent squares');
    const v = unitAt(state, t.x, t.y);
    if (!v) fail('Basic: no unit on the target square');
    if (v.owner === attacker.owner) fail('Basics may only target enemies');
    hitUnits = [v];
  } else if (params.kind === 'special') {
    special = st.special;
    if (!special) fail(unitName(attacker) + ' has no Special');
    pattern = special.pattern;
    attackName = special.name;
    baseDmg = special.dmg;

    if (pattern === 'telegrab') {
      return performTelegrab(state, attacker, special, params, meta, declPos);
    }
    if (pattern === 'single') {
      const d = reqDir(params.dir);
      let victim = null, dist = 0;
      let cx = declPos.x, cy = declPos.y;
      for (let i = 1; i <= special.range; i++) {
        cx += d.dx; cy += d.dy;
        if (!inBoard(cx, cy)) break;
        const u = unitAt(state, cx, cy);
        if (u) {
          // Tavrik is immune to Rival Specials — transparent, not a wall.
          if (attackerRival && hasTrait(u, 'tyrantbane')) continue;
          victim = u; dist = i; break;
        }
      }
      if (!victim) fail(attackName + ': no unit within range in that direction');
      if (victim.owner === attacker.owner) fail(attackName + ': blocked by an allied unit');
      if (hasTrait(attacker, 'tyrantbane') && stageOf(victim).rival && dist > 1) {
        fail(attackName + ': a Rival unit may only be attacked from an adjacent square (Close kill)');
      }
      hitUnits = [victim];
    } else if (pattern === 'lance') {
      const d = reqDir(params.dir);
      let cx = declPos.x, cy = declPos.y;
      for (let i = 1; i <= special.range; i++) {
        cx += d.dx; cy += d.dy;
        if (!inBoard(cx, cy)) break;
        const u = unitAt(state, cx, cy);
        if (u && u.owner !== attacker.owner) {
          if (attackerRival && hasTrait(u, 'tyrantbane')) continue;  // immune, pierced through
          hitUnits.push(u);
        }
      }
      if (!hitUnits.length) fail(attackName + ': must hit at least one enemy');
    } else if (pattern === 'cone') {
      const d = reqDir(params.dir);
      if (d.dx !== 0 && d.dy !== 0) fail(attackName + ': cone direction must be one of the 4 cardinal directions');
      coneNear = sq(declPos.x + d.dx, declPos.y + d.dy);
      const squares = [];
      if (inBoard(coneNear.x, coneNear.y)) squares.push(coneNear);
      const fx = declPos.x + 2 * d.dx, fy = declPos.y + 2 * d.dy;
      for (let o = -1; o <= 1; o++) {
        const p = (d.dx === 0) ? sq(fx + o, fy) : sq(fx, fy + o);
        if (inBoard(p.x, p.y)) squares.push(p);
      }
      for (const p of squares) {
        const u = unitAt(state, p.x, p.y);
        if (u && u.owner !== attacker.owner && !(attackerRival && hasTrait(u, 'tyrantbane'))) hitUnits.push(u);
      }
      if (!hitUnits.length) fail(attackName + ': must hit at least one enemy');
    } else if (pattern === 'burst') {
      for (const d of DIRS8) {
        const x = declPos.x + d.dx, y = declPos.y + d.dy;
        if (!inBoard(x, y)) continue;
        const u = unitAt(state, x, y);
        if (u && u.owner !== attacker.owner && !(attackerRival && hasTrait(u, 'tyrantbane'))) hitUnits.push(u);
      }
      if (!hitUnits.length) fail(attackName + ': must hit at least one enemy');
    } else if (pattern === 'bomb') {
      const t = reqSquare(params.target, attackName);
      const dx = t.x - declPos.x, dy = t.y - declPos.y;
      if (!(dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy)) || (dx === 0 && dy === 0)) {
        fail(attackName + ': target must lie in a straight line (8 directions)');
      }
      if (cheb(declPos, t) > special.range) fail(attackName + ': target beyond range ' + special.range);
      bombCenter = t;
      const squares = [t];
      for (const n of CARDINAL_NAMES) {
        const d = CARDINALS[n];
        const p = sq(t.x + d.dx, t.y + d.dy);
        if (inBoard(p.x, p.y)) squares.push(p);
      }
      for (const p of squares) {
        const u = unitAt(state, p.x, p.y);
        if (u && u.owner !== attacker.owner && !(attackerRival && hasTrait(u, 'tyrantbane'))) hitUnits.push(u);
      }
      if (!hitUnits.length) fail(attackName + ': must hit at least one enemy');
    } else if (pattern === 'scatter') {
      const sqs = params.squares;
      if (!Array.isArray(sqs) || !sqs.length) fail(attackName + ': squares array required');
      if (sqs.length > special.count) fail(attackName + ': at most ' + special.count + ' squares');
      for (let i = 0; i < sqs.length; i++) {
        reqSquare(sqs[i], attackName);
        if (manhattan(declPos, sqs[i]) > special.range) fail(attackName + ': square beyond Manhattan range ' + special.range);
        for (let j = 0; j < i; j++) if (sameSq(sqs[i], sqs[j])) fail(attackName + ': squares must be distinct');
      }
      for (const p of sqs) {
        const u = unitAt(state, p.x, p.y);
        if (u && u.owner !== attacker.owner && !(attackerRival && hasTrait(u, 'tyrantbane'))) hitUnits.push(u);
      }
      if (!hitUnits.length) fail(attackName + ': must hit at least one enemy');
    } else {
      fail('unknown pattern: ' + pattern);
    }
  } else {
    fail("attack kind must be 'basic' or 'special'");
  }

  // ---- Super-effective focus (×2 on at most ONE unit per attack) ----
  const pool = (pattern === 'lance') ? hitUnits.slice(0, 1) : hitUnits;
  const eligible = pool.filter(u => beats.indexOf(lineOf(u).type) !== -1);
  let focusUnit = null;
  if (eligible.length === 1) focusUnit = eligible[0];
  else if (eligible.length >= 2) {
    if (params.focus !== undefined && params.focus !== null) {
      focusUnit = eligible.find(u => u.id === params.focus) ||
        fail('focus must be one of the super-effective-eligible hit units');
    } else if (!preview) {
      fail(attackName + ': focus pick required (multiple super-effective-eligible targets)');
    }
  }
  if (params.focus !== undefined && params.focus !== null && eligible.length <= 1) {
    if (!(focusUnit && focusUnit.id === params.focus)) fail('focus given but that unit is not super-effective-eligible');
  }
  if (meta) {
    meta.needsFocus = eligible.length >= 2;
    meta.focusEligible = eligible.map(u => u.id);
  }

  // ---- Compute all hits, then apply simultaneously ----
  const computed = hitUnits.map(v => {
    const r = computeHitDamage(state, attacker, v, baseDmg, {
      se: !!(focusUnit && v.id === focusUnit.id), special,
    });
    return { v, dmg: r.dmg, notes: r.notes, beforePos: { x: v.pos.x, y: v.pos.y } };
  });
  if (meta) meta.hits = computed.map(c => ({ unitId: c.v.id, dmg: c.dmg }));
  for (const c of computed) {
    log(state, c.notes.length
      ? attackName + ': ' + baseDmg + ' → ' + c.dmg + ' ' + c.notes.join(', ') + ' vs ' + unitName(c.v)
      : attackName + ': ' + c.dmg + ' vs ' + unitName(c.v));
    dealDamage(state, c.v, c.dmg, attacker.id, attacker.owner);
  }

  // ---- Effects (skip KO'd victims; bound to hit-time squares for near/center) ----
  let pinLandedOnTarget = false;
  if (special && state.winner === null) {
    for (const ef of special.effects) {
      for (const c of computed) {
        if (state.winner !== null) break;
        const v = c.v;
        if (!v.pos) continue;
        if (ef.nearOnly && !(coneNear && sameSq(c.beforePos, coneNear))) continue;
        if (ef.centerOnly && !(bombCenter && sameSq(c.beforePos, bombCenter))) continue;
        if (applyEffect(state, attacker, v, ef) && ef.kind === 'pin') pinLandedOnTarget = true;
      }
    }
  }

  // ---- Riders ----
  const riders = special ? special.riders : [];
  let lungeOffered = false, blinkOffered = false;
  for (const r of riders) {
    if (state.winner !== null) break;
    if (r.kind === 'recoil') {
      if (!attacker.pos) continue;
      const dmg = r.n + (attacker.hexTurns > 0 ? 1 : 0);
      log(state, 'Recoil: ' + unitName(attacker) + ' takes ' + dmg);
      dealDamage(state, attacker, dmg, null, attacker.owner);
    } else if (r.kind === 'lunge') {
      lungeOffered = true;
      if (!attacker.pos || !computed.length) continue;
      const c0 = computed[0];
      const finalPos = c0.v.pos ? c0.v.pos : c0.beforePos;
      const koD = !c0.v.pos;
      const squares = [];
      for (const d of DIRS8) {
        const x = finalPos.x + d.dx, y = finalPos.y + d.dy;
        if (inBoard(x, y) && !unitAt(state, x, y)) squares.push(sq(x, y));
      }
      if (koD && !unitAt(state, finalPos.x, finalPos.y)) squares.push(sq(finalPos.x, finalPos.y));
      const mandatory = hasTrait(attacker, 'talonlock') && pinLandedOnTarget;
      if (meta) {
        meta.lungeSquares = squares;
        meta.mandatoryLunge = mandatory && squares.length > 0;
        continue;
      }
      if (params.lungeTo !== undefined && params.lungeTo !== null) {
        const lt = reqSquare(params.lungeTo, 'Lunge');
        if (!squares.some(p => sameSq(p, lt))) fail('illegal lunge square');
        attacker.pos = sq(lt.x, lt.y);
        log(state, unitName(attacker) + ' lunges to (' + lt.x + ',' + lt.y + ')');
        if (mandatory) {
          attacker.rootedTurn = state.playerTurns[attacker.owner] + 1;
          log(state, 'Talonlock: ' + unitName(attacker) + ' locks on and is rooted');
        }
      } else if (mandatory && squares.length) {
        fail('Talonlock: the Lunge is mandatory — lungeTo required');
      }
    } else if (r.kind === 'blink') {
      blinkOffered = true;
      if (!attacker.pos) continue;
      const squares = [];
      for (let dx = -r.n; dx <= r.n; dx++) for (let dy = -r.n; dy <= r.n; dy++) {
        if (dx === 0 && dy === 0) continue;
        const x = attacker.pos.x + dx, y = attacker.pos.y + dy;
        if (inBoard(x, y) && !unitAt(state, x, y)) squares.push(sq(x, y));
      }
      if (meta) { meta.blinkSquares = squares; continue; }
      if (params.blinkTo !== undefined && params.blinkTo !== null) {
        const bt = reqSquare(params.blinkTo, 'Blink');
        if (!squares.some(p => sameSq(p, bt))) fail('illegal blink square');
        attacker.pos = sq(bt.x, bt.y);
        log(state, unitName(attacker) + ' blinks to (' + bt.x + ',' + bt.y + ')');
      }
    }
  }
  if (state.winner === null && !preview) {
    if (params.lungeTo !== undefined && params.lungeTo !== null && !lungeOffered) fail('this attack has no Lunge rider');
    if (params.blinkTo !== undefined && params.blinkTo !== null && !blinkOffered) fail('this attack has no Blink rider');
  }

  applyStaticQuills(state, attacker, computed, declPos);
}

// Effect application; returns true if the effect actually landed on this victim.
function applyEffect(state, attacker, v, ef) {
  if (ef.kind === 'push') {
    const d = { dx: sgn(v.pos.x - attacker.pos.x), dy: sgn(v.pos.y - attacker.pos.y) };
    const dest = sq(v.pos.x + d.dx, v.pos.y + d.dy);
    if (!inBoard(dest.x, dest.y) || unitAt(state, dest.x, dest.y)) {
      log(state, 'Push cancelled on ' + unitName(v));
      return false;
    }
    v.pos = dest;
    log(state, unitName(v) + ' is pushed to (' + dest.x + ',' + dest.y + ')');
    return true;
  }
  if (ef.kind === 'pin') {
    v.pinnedTurn = state.playerTurns[v.owner] + 1;
    log(state, unitName(v) + ' is Pinned');
    return true;
  }
  if (ef.kind === 'burn') {
    // CONTRACT pins burn as { n, ticks }; the SPEC §3 attribution ("Burn ticks
    // credit the unit that applied the Burn") lives in a sibling field, burnBy.
    if (v.burn) {
      if (ef.n >= v.burn.n) v.burnBy = attacker.id;   // higher (or equal, newer) N wins credit
      v.burn = { n: Math.max(v.burn.n, ef.n), ticks: 2 };
    } else {
      v.burn = { n: ef.n, ticks: 2 };
      v.burnBy = attacker.id;
    }
    log(state, unitName(v) + ' is Burned (' + v.burn.n + '/tick)');
    return true;
  }
  if (ef.kind === 'poison') {
    v.poison += 1;
    log(state, unitName(v) + ' is Poisoned (' + v.poison + ' stack' + (v.poison > 1 ? 's' : '') + ')');
    if (v.poison >= 3) {
      log(state, 'Poison executes ' + unitName(v) + '!');
      koUnit(state, v, attacker.id, attacker.owner);   // KO credit, no damage credit
    }
    return true;
  }
  if (ef.kind === 'chill') {
    v.chill += ef.n;
    log(state, unitName(v) + ' is Chilled (' + v.chill + ' stack' + (v.chill > 1 ? 's' : '') + ')');
    return true;
  }
  if (ef.kind === 'lure') {
    const d = { dx: sgn(attacker.pos.x - v.pos.x), dy: sgn(attacker.pos.y - v.pos.y) };
    const dest = sq(v.pos.x + d.dx, v.pos.y + d.dy);
    if (!inBoard(dest.x, dest.y) || unitAt(state, dest.x, dest.y)) {
      log(state, 'Lure pull cancelled on ' + unitName(v));
    } else {
      v.pos = dest;
      log(state, unitName(v) + ' is lured to (' + dest.x + ',' + dest.y + ')');
    }
    v.hexTurns = 2;
    log(state, unitName(v) + ' is Hexed');
    return true;
  }
  fail('unknown effect: ' + ef.kind);
}

// Static Quills: 1 reflect damage (once per attack) if the attack damaged a
// staticQuills unit and was delivered from a square adjacent to it. Credits no one.
function applyStaticQuills(state, attacker, computed, declPos) {
  if (state.winner !== null) return;
  for (const c of computed) {
    if (!hasTrait(c.v, 'staticQuills')) continue;
    if (cheb(declPos, c.beforePos) !== 1) continue;
    if (!attacker.pos) break;
    const dmg = 1 + (attacker.hexTurns > 0 ? 1 : 0);
    log(state, 'Static Quills: ' + unitName(attacker) + ' takes ' + dmg);
    dealDamage(state, attacker, dmg, null, c.v.owner);
    break;  // once per attack
  }
}

// Telegrab / Telesmash (Hootle line). DEV-PINS 7 & 20.
function performTelegrab(state, attacker, special, params, meta, declPos) {
  const v = state.units[params.targetUnit];
  if (!v || !v.pos) fail('Telegrab: a living target unit is required');
  if (v.owner === attacker.owner) fail('Telegrab: must target an enemy unit');
  if (cheb(declPos, v.pos) > special.range) fail('Telegrab: target beyond range ' + special.range);
  const origPos = { x: v.pos.x, y: v.pos.y };

  if (params.relocateTo !== undefined && params.relocateTo !== null) {
    const rt = reqSquare(params.relocateTo, 'Telegrab relocation');
    if (unitAt(state, rt.x, rt.y)) fail('Telegrab: relocation destination is occupied');
    if (cheb(origPos, rt) > special.relocate) fail('Telegrab: relocation beyond ' + special.relocate + ' squares');
    v.pos = sq(rt.x, rt.y);
    if (!meta) log(state, 'Telegrab: ' + unitName(v) + ' relocated to (' + rt.x + ',' + rt.y + ')');
  }
  v.telegrabs += 1;
  if (!meta) log(state, 'Telegrab: ' + unitName(v) + ' grabbed (lifetime ' + v.telegrabs + ')');

  if (special.telesmash) {
    const base = Math.min(3, v.telegrabs);
    const r = computeHitDamage(state, attacker, v, base, { se: false, special });
    if (meta) meta.hits = [{ unitId: v.id, dmg: r.dmg }];
    log(state, r.notes.length
      ? 'Telesmash: ' + base + ' → ' + r.dmg + ' ' + r.notes.join(', ') + ' vs ' + unitName(v)
      : 'Telesmash: ' + r.dmg + ' vs ' + unitName(v));
    dealDamage(state, v, r.dmg, attacker.id, attacker.owner);
    applyStaticQuills(state, attacker,
      [{ v, dmg: r.dmg, beforePos: origPos }], declPos);
  }
}

// ---- Turn loop ----
function evolveMet(u, cond) {
  if (cond.kind === 'survived') return u.survived >= cond.n;
  if (cond.kind === 'dealt') return u.dealt >= cond.n;
  if (cond.kind === 'ko') return u.kos >= 1;
  if (cond.kind === 'allyKo') return u.allyKoSeen;
  return false;
}

// Start-of-turn for state.turn.player: (1) evolutions, (2) Burn ticks,
// (3) enemy Earthquake then enemy Dread Presence Chill.
function startOfTurn(state) {
  const p = state.turn.player;
  // 1. Evolutions (repeat while the next condition is already met — DEV-PIN 9).
  for (const u of state.units) {
    if (u.owner !== p || !u.pos) continue;
    let st = stageOf(u);
    while (st.evolve && evolveMet(u, st.evolve)) {
      u.stage += 1;
      const ns = stageOf(u);
      u.hp = Math.min(ns.hp, u.hp + 2);            // +2 refresh, capped — never a full heal
      log(state, st.name + ' evolves into ' + ns.name + '! (HP ' + u.hp + '/' + ns.hp + ')');
      st = ns;
    }
  }
  // 2. Burn ticks (credit the unit that applied the Burn).
  for (const u of state.units) {
    if (state.winner !== null) return;
    if (u.owner !== p || !u.pos || !u.burn) continue;
    const by = (u.burnBy === undefined || u.burnBy === null) ? null : u.burnBy;
    const dmg = u.burn.n + (u.hexTurns > 0 ? 1 : 0);
    u.burn.ticks -= 1;
    if (u.burn.ticks <= 0) { u.burn = null; delete u.burnBy; }
    log(state, 'Burn: ' + unitName(u) + ' takes ' + dmg);
    dealDamage(state, u, dmg, by, by !== null ? state.units[by].owner : 1 - p);
  }
  if (state.winner !== null) return;
  // 3a. Enemy Earthquake — one d4 per adjacent unit, ascending unit id (DEV-PIN 10 first).
  for (const q of state.units) {
    if (!q.pos || q.owner === p || stageOf(q).aura !== 'earthquake') continue;
    const affected = state.units
      .filter(u => u.pos && u.owner === p && cheb(u.pos, q.pos) === 1)
      .sort((a, b) => a.id - b.id);
    for (const u of affected) {
      const roll = rollD4(state);
      const dirName = CARDINAL_NAMES[roll - 1];
      const d = CARDINALS[dirName];
      const dest = sq(u.pos.x + d.dx, u.pos.y + d.dy);
      if (!inBoard(dest.x, dest.y) || unitAt(state, dest.x, dest.y)) {
        log(state, 'Earthquake: ' + unitName(u) + ' d4=' + roll + ' (' + dirName + ') — blocked, no move');
      } else {
        u.pos = dest;
        log(state, 'Earthquake: ' + unitName(u) + ' d4=' + roll + ' (' + dirName + ') → (' + dest.x + ',' + dest.y + ')');
      }
    }
  }
  // 3b. Enemy Dread Presence Chill (post-quake adjacency); Tavrik immune.
  for (const g of state.units) {
    if (!g.pos || g.owner === p || stageOf(g).aura !== 'dreadPresence') continue;
    for (const u of state.units) {
      if (!u.pos || u.owner !== p || cheb(u.pos, g.pos) !== 1) continue;
      if (hasTrait(u, 'tyrantbane')) continue;
      u.chill += 1;
      log(state, 'Dread Presence: ' + unitName(u) + ' gains 1 Chill (' + u.chill + ')');
    }
  }
}

// Turn pass (CONTRACT pinned sequence): clear expiring marks on the outgoing
// player's units, survived++, flip player, playerTurns++, run start-of-turn.
function passTurn(state) {
  const p = state.turn.player;
  const tn = state.playerTurns[p];
  for (const u of state.units) {
    if (u.owner !== p) continue;
    if (u.pinnedTurn === tn) u.pinnedTurn = 0;
    if (u.rootedTurn === tn) u.rootedTurn = 0;
    u.chill = 0;
    if (u.hexTurns > 0) u.hexTurns -= 1;
    if (u.pos) u.survived += 1;
  }
  const np = 1 - p;
  state.turn = { player: np, activationsUsed: 0, activated: [], current: null, pendingAuras: null };
  state.playerTurns[np] += 1;
  log(state, "— Player " + (np + 1) + "'s turn " + state.playerTurns[np] + " —");
  startOfTurn(state);
}

function doEndTurn(state) {
  const p = state.turn.player;
  const auraIds = state.units
    .filter(u => u.pos && u.owner === p &&
      (stageOf(u).aura === 'localStorm' || stageOf(u).aura === 'hungryDepths'))
    .map(u => u.id);
  if (auraIds.length) state.turn.pendingAuras = auraIds;
  else passTurn(state);
}

function resolveLocalStorm(state, u) {
  // 1 damage to every unit, friend or foe, within 1 — except Tavrik (Rival aura).
  const victims = state.units
    .filter(v => v.pos && v.id !== u.id && cheb(v.pos, u.pos) === 1 && !hasTrait(v, 'tyrantbane'))
    .sort((a, b) => a.id - b.id);
  log(state, 'Local Storm rages around ' + unitName(u));
  for (const v of victims) {
    if (state.winner !== null) return;
    const dmg = 1 + (v.hexTurns > 0 ? 1 : 0);
    log(state, 'Local Storm: ' + unitName(v) + ' takes ' + dmg);
    dealDamage(state, v, dmg, null, u.owner);
  }
}

function resolveHungryDepths(state, u, targetId) {
  const adj = state.units.filter(v => v.pos && v.id !== u.id && cheb(v.pos, u.pos) === 1);
  if (adj.length) {
    if (targetId === undefined || targetId === null) fail('Hungry Depths: must bite an adjacent unit (target required)');
    const t = adj.find(v => v.id === targetId);
    if (!t) fail('Hungry Depths: target must be an adjacent unit');
    const dmg = 1 + (t.hexTurns > 0 ? 1 : 0);
    const ally = t.owner === u.owner;
    log(state, 'Hungry Depths: ' + unitName(u) + ' bites ' + unitName(t) + ' for ' + dmg);
    dealDamage(state, t, dmg, null, u.owner);
    const heal = ally ? 3 : 2;                         // heals even if the bite KO'd (DEV-PIN 12)
    const before = u.hp;
    u.hp = Math.min(stageOf(u).hp, u.hp + heal);
    if (u.hp > before) log(state, 'Hungry Depths: ' + unitName(u) + ' heals ' + (u.hp - before));
  } else {
    if (targetId !== undefined && targetId !== null) fail('Hungry Depths: no unit is adjacent — omit target');
    const dmg = 1 + (u.hexTurns > 0 ? 1 : 0);
    log(state, 'Hungry Depths: ' + unitName(u) + ' starves for ' + dmg);
    dealDamage(state, u, dmg, null, u.owner);
  }
}

function doAura(state, player, action) {
  const pend = state.turn.pendingAuras;
  if (!pend || !pend.length) fail('no pending auras');
  const idx = pend.indexOf(action.unitId);
  if (idx === -1) fail('that unit has no pending aura');
  pend.splice(idx, 1);
  const u = state.units[action.unitId];
  if (u.pos) {                                  // may have been KO'd by an earlier aura
    const kind = stageOf(u).aura;
    if (kind === 'localStorm') {
      if (action.target !== undefined && action.target !== null) fail('Local Storm takes no target');
      resolveLocalStorm(state, u);
    } else if (kind === 'hungryDepths') {
      resolveHungryDepths(state, u, action.target);
    } else {
      fail('that unit has no end-of-turn aura');
    }
  }
  if (state.winner !== null) return;
  state.turn.pendingAuras = pend.filter(id => state.units[id].pos);
  if (!state.turn.pendingAuras.length) passTurn(state);
}

// ---- Movement ----
function reachable(state, unitId) {
  const u = getUnit(state, unitId);
  if (!u.pos || moveBlocked(state, u)) return [];
  const speed = effectiveSpeed(state, unitId);
  if (speed <= 0) return [];
  const skulk = hasTrait(u, 'skulk');
  const visited = {};
  visited[u.pos.x + ',' + u.pos.y] = true;
  let frontier = [{ x: u.pos.x, y: u.pos.y, path: [] }];
  const out = [];
  for (let step = 1; step <= speed; step++) {
    const next = [];
    for (const node of frontier) {
      for (const n of CARDINAL_NAMES) {
        const d = CARDINALS[n];
        const x = node.x + d.dx, y = node.y + d.dy;
        const key = x + ',' + y;
        if (!inBoard(x, y) || visited[key]) continue;
        const occ = unitAt(state, x, y);
        if (occ && !skulk) continue;             // bodies block (Skulk passes through)
        visited[key] = true;
        const path = node.path.concat([sq(x, y)]);
        next.push({ x, y, path });
        if (!occ) out.push({ x, y, path });      // may never END on an occupied square
      }
    }
    frontier = next;
  }
  return out;
}

function doMove(state, player, action) {
  const cur = state.turn.current;
  if (!cur) fail('no activation in progress');
  if (cur.moved) fail('this unit already moved');
  if (cur.attacked) fail('cannot move after attacking');
  const u = state.units[cur.unitId];
  if (!u.pos) fail("unit is KO'd");
  const blocked = moveBlocked(state, u);
  if (blocked) fail('unit cannot move: ' + blocked);
  const path = action.path;
  if (!Array.isArray(path) || !path.length) fail('move: non-empty path required');
  const speed = effectiveSpeed(state, u.id);
  if (path.length > speed) fail('path length ' + path.length + ' exceeds Speed ' + speed);
  const skulk = hasTrait(u, 'skulk');
  let prev = u.pos, lastDir = null;
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    reqSquare(p, 'move');
    const dx = p.x - prev.x, dy = p.y - prev.y;
    if (Math.abs(dx) + Math.abs(dy) !== 1) fail('path must be single orthogonal steps');
    const occ = unitAt(state, p.x, p.y);
    const last = i === path.length - 1;
    if (occ && last) fail('destination square is occupied');
    if (occ && !skulk) fail('path blocked by a unit');
    lastDir = dx === 1 ? 'E' : dx === -1 ? 'W' : dy === 1 ? 'N' : 'S';
    prev = p;
  }
  u.pos = sq(prev.x, prev.y);
  u.facing = lastDir;                            // facing = direction of the final step
  cur.moved = true;
  log(state, unitName(u) + ' moves to (' + prev.x + ',' + prev.y + ')');
}

// ---- Draft & placement ----
function doPick(state, player, action) {
  const d = state.draft;
  if (d.pickIndex >= 12) fail('draft is complete');
  if (d.order[d.pickIndex] !== player) fail('not your pick');
  const line = LINE_BY_ID[action.lineId];
  if (!line) fail('unknown line: ' + action.lineId);
  if (d.teams[0].indexOf(line.id) !== -1 || d.teams[1].indexOf(line.id) !== -1) fail('line already drafted');
  if (line.id === d.cutTyrant) fail('that tyrant line was cut');
  if (d.pickIndex < 2) {
    if (!line.tyrant) fail('tyrant phase: you must pick a tyrant line');
  } else if (line.tyrant) {
    fail('tyrant lines cannot be picked in the snake');
  }
  d.teams[player].push(line.id);
  log(state, 'Player ' + (player + 1) + ' drafts ' + line.stages[0].name);
  d.pickIndex += 1;
  if (d.pickIndex === 2) {
    d.cutTyrant = GM_DATA.tyrants.find(t =>
      d.teams[0].indexOf(t) === -1 && d.teams[1].indexOf(t) === -1);
    log(state, LINE_BY_ID[d.cutTyrant].stages[0].name + ' is cut from the draft');
  }
  if (d.pickIndex === 12) {
    state.phase = 'placement';
    state.placement = { current: 0, confirmed: [false, false] };
    log(state, 'Draft complete — placement begins (Player 1 first)');
  }
}

function backRows(player) { return player === 0 ? [0, 1] : [6, 7]; }

function doPlace(state, player, action) {
  if (state.placement.current !== player) fail('not your placement turn');
  if (state.placement.confirmed[player]) fail('placement already confirmed');
  if (state.draft.teams[player].indexOf(action.lineId) === -1) fail('that line is not on your team');
  reqSquare(action, 'place');
  if (backRows(player).indexOf(action.y) === -1) fail('units must be placed on your own back two rows');
  if (unitAt(state, action.x, action.y)) fail('that square is occupied');
  let u = state.units.find(v => v.owner === player && v.lineId === action.lineId);
  if (u) {
    u.pos = sq(action.x, action.y);              // reposition before confirming
  } else {
    const stg = LINE_BY_ID[action.lineId].stages[0];
    u = {
      id: state.units.length, owner: player, lineId: action.lineId, stage: 0,
      hp: stg.hp, pos: sq(action.x, action.y),
      facing: player === 0 ? 'N' : 'S',
      pinnedTurn: 0, rootedTurn: 0, burn: null, poison: 0, chill: 0,
      hexTurns: 0, telegrabs: 0, survived: 0, dealt: 0, kos: 0, allyKoSeen: false,
    };
    state.units.push(u);
  }
  log(state, 'Player ' + (player + 1) + ' places ' + unitName(u) + ' at (' + action.x + ',' + action.y + ')');
}

function doUnplace(state, player, action) {
  if (state.placement.current !== player) fail('not your placement turn');
  if (state.placement.confirmed[player]) fail('placement already confirmed');
  const u = state.units.find(v => v.owner === player && v.lineId === action.lineId && v.pos);
  if (!u) fail('that line is not placed');
  u.pos = null;
  log(state, 'Player ' + (player + 1) + ' unplaces ' + unitName(u));
}

function doConfirm(state, player) {
  if (state.placement.current !== player) fail('not your placement turn');
  if (state.placement.confirmed[player]) fail('placement already confirmed');
  const placed = state.units.filter(v => v.owner === player && v.pos).length;
  if (placed !== 6) fail('place all 6 units before confirming (' + placed + '/6 placed)');
  state.placement.confirmed[player] = true;
  log(state, 'Player ' + (player + 1) + ' confirms placement');
  if (player === 0) {
    state.placement.current = 1;
  } else {
    state.phase = 'battle';
    state.turn = { player: 0, activationsUsed: 0, activated: [], current: null, pendingAuras: null };
    state.playerTurns[0] += 1;
    log(state, "Battle begins — Player 1's turn 1");
    startOfTurn(state);
  }
}

// ---- Battle actions ----
function doActivate(state, player, action) {
  const t = state.turn;
  if (t.current) fail('an activation is already in progress');
  if (t.activationsUsed >= 3) fail('no activations remaining this turn');
  const u = getUnit(state, action.unitId);
  if (u.owner !== player) fail('not your unit');
  if (!u.pos) fail("that unit is KO'd");
  if (t.activated.indexOf(u.id) !== -1) fail('that unit was already activated this turn');
  t.activationsUsed += 1;
  t.activated.push(u.id);
  t.current = { unitId: u.id, moved: false, attacked: false };
  log(state, unitName(u) + ' activates (' + t.activationsUsed + '/3)');
}

function doAttack(state, player, action) {
  const cur = state.turn.current;
  if (!cur) fail('no activation in progress');
  if (cur.attacked) fail('this unit already attacked');
  const u = state.units[cur.unitId];
  if (!u.pos) fail("unit is KO'd");
  if (isFrozenU(state, u)) fail('Hard Frozen units cannot attack');
  performAttack(state, u, action, null);
  cur.attacked = true;
}

// ---- createGame / applyAction ----
function createGame(seed, coinWinner) {
  if (coinWinner !== 0 && coinWinner !== 1) fail('coinWinner must be 0 or 1');
  const s = Number(seed) >>> 0;
  const W = coinWinner, L = 1 - coinWinner;
  return {
    v: 1, seed: s, rng: s, coinWinner: W,
    phase: 'draft',
    draft: {
      // [winner, loser] tyrant picks, then snake starting with the flip loser:
      // L W W L L W W L L W
      order: [W, L, L, W, W, L, L, W, W, L, L, W],
      pickIndex: 0, cutTyrant: null, teams: [[], []],
    },
    placement: { current: 0, confirmed: [false, false] },
    units: [],
    playerTurns: [0, 0],
    turn: { player: 0, activationsUsed: 0, activated: [], current: null, pendingAuras: null },
    winner: null,
    log: [{ msg: 'Coin flip: Player ' + (W + 1) + ' wins the toss' }],
  };
}

function applyAction(state, player, action) {
  if (player !== 0 && player !== 1) fail('invalid player: ' + player);
  if (!action || typeof action.t !== 'string') fail('invalid action');
  const s = clone(state);
  if (s.phase === 'draft') {
    if (action.t !== 'pick') fail("only 'pick' is legal during the draft");
    doPick(s, player, action);
  } else if (s.phase === 'placement') {
    if (action.t === 'place') doPlace(s, player, action);
    else if (action.t === 'unplace') doUnplace(s, player, action);
    else if (action.t === 'confirm') doConfirm(s, player);
    else fail("illegal action '" + action.t + "' during placement");
  } else if (s.phase === 'battle') {
    if (player !== s.turn.player) fail('not your turn');
    if (s.turn.pendingAuras) {
      if (action.t !== 'aura') fail('resolve pending end-of-turn auras first');
      doAura(s, player, action);
    } else if (action.t === 'activate') doActivate(s, player, action);
    else if (action.t === 'move') doMove(s, player, action);
    else if (action.t === 'attack') doAttack(s, player, action);
    else if (action.t === 'endActivation') {
      if (!s.turn.current) fail('no activation in progress');
      s.turn.current = null;
    } else if (action.t === 'endTurn') {
      if (s.turn.current) fail('end the current activation first');
      doEndTurn(s);
    } else if (action.t === 'aura') fail('no pending auras');
    else fail("illegal action '" + action.t + "' during battle");
  } else if (s.phase === 'over') {
    if (action.t !== 'rematch') fail('the game is over');
    return createGame(action.seed, action.coinWinner);
  } else {
    fail('unknown phase: ' + s.phase);
  }
  return s;
}

// ---- UI/test convenience helpers (must agree with applyAction) ----
function previewAttack(state, unitId, attackParams) {
  const s = clone(state);
  const meta = {
    hits: [], needsFocus: false, focusEligible: [],
    lungeSquares: [], blinkSquares: [], mandatoryLunge: false,
  };
  try {
    const u = getUnit(s, unitId);
    if (!u.pos) fail("unit is KO'd");
    if (isFrozenU(s, u)) fail('Hard Frozen units cannot attack');
    performAttack(s, u, attackParams, meta);
  } catch (e) {
    return Object.assign({ legal: false, reason: e.message }, meta);
  }
  return Object.assign({ legal: true }, meta);
}

function attackChoices(state, unitId) {
  const u = getUnit(state, unitId);
  if (!u.pos || isFrozenU(state, u)) return [];
  const out = [];
  for (const d of DIRS8) {
    const x = u.pos.x + d.dx, y = u.pos.y + d.dy;
    if (!inBoard(x, y)) continue;
    const v = unitAt(state, x, y);
    if (v && v.owner !== u.owner) out.push({ kind: 'basic', target: sq(x, y), hits: [v.id] });
  }
  const sp = stageOf(u).special;
  if (!sp) return out;
  if (sp.pattern === 'single' || sp.pattern === 'lance' || sp.pattern === 'cone') {
    const dirs = sp.pattern === 'cone'
      ? CARDINAL_NAMES.map(n => CARDINALS[n])
      : DIRS8;
    for (const d of dirs) {
      const params = { kind: 'special', dir: { dx: d.dx, dy: d.dy } };
      const pv = previewAttack(state, unitId, params);
      if (pv.legal || pv.needsFocus) {
        out.push({ kind: 'special', pattern: sp.pattern, dir: { dx: d.dx, dy: d.dy },
          hits: pv.hits.map(h => h.unitId) });
      }
    }
  } else if (sp.pattern === 'burst') {
    const pv = previewAttack(state, unitId, { kind: 'special' });
    if (pv.legal || pv.needsFocus) {
      out.push({ kind: 'special', pattern: 'burst', hits: pv.hits.map(h => h.unitId) });
    }
  } else if (sp.pattern === 'bomb') {
    for (const d of DIRS8) {
      for (let r = 1; r <= sp.range; r++) {
        const t = sq(u.pos.x + d.dx * r, u.pos.y + d.dy * r);
        if (!inBoard(t.x, t.y)) break;
        const pv = previewAttack(state, unitId, { kind: 'special', target: t });
        if (pv.legal || pv.needsFocus) {
          out.push({ kind: 'special', pattern: 'bomb', target: t, hits: pv.hits.map(h => h.unitId) });
        }
      }
    }
  } else if (sp.pattern === 'scatter') {
    const squares = [], enemySquares = [];
    for (let x = 0; x < BOARD; x++) for (let y = 0; y < BOARD; y++) {
      if (manhattan(u.pos, sq(x, y)) > sp.range) continue;
      squares.push(sq(x, y));
      const v = unitAt(state, x, y);
      if (v && v.owner !== u.owner) enemySquares.push(sq(x, y));
    }
    if (enemySquares.length) {
      out.push({ kind: 'special', pattern: 'scatter', range: sp.range, count: sp.count,
        squares, enemySquares, hits: enemySquares.map(p => unitAt(state, p.x, p.y).id) });
    }
  } else if (sp.pattern === 'telegrab') {
    for (const v of state.units) {
      if (!v.pos || v.owner === u.owner || cheb(u.pos, v.pos) > sp.range) continue;
      const relocateSquares = [];
      for (let dx = -sp.relocate; dx <= sp.relocate; dx++) {
        for (let dy = -sp.relocate; dy <= sp.relocate; dy++) {
          const p = sq(v.pos.x + dx, v.pos.y + dy);
          if (inBoard(p.x, p.y) && !unitAt(state, p.x, p.y)) relocateSquares.push(p);
        }
      }
      out.push({ kind: 'special', pattern: 'telegrab', targetUnit: v.id,
        relocate: sp.relocate, relocateSquares, hits: sp.telesmash ? [v.id] : [] });
    }
  }
  return out;
}

function pendingAuras(state) {
  const pend = (state.turn && state.turn.pendingAuras) || [];
  return pend.map(id => {
    const u = state.units[id];
    const kind = stageOf(u).aura;
    let targets = [], needsTarget = false;
    if (kind === 'hungryDepths' && u.pos) {
      targets = state.units
        .filter(v => v.pos && v.id !== id && cheb(v.pos, u.pos) === 1)
        .map(v => v.id);
      needsTarget = targets.length > 0;
    }
    return { unitId: id, kind, needsTarget, targets };
  });
}

const GM = {
  createGame,
  applyAction,
  lineOf,
  stageOf,
  maxHp,
  effectiveSpeed,
  isFrozen,
  isPinned,
  reachable,
  attackChoices,
  previewAttack,
  pendingAuras,
};
if (typeof module !== 'undefined') module.exports = GM;
