'use strict';
/* Grid Monsters — browser UI.
   The UI is a pure function of (game state, mySeat, transient selection state):
   render() rebuilds the whole screen from App.state + App.* transient fields.
   ALL game mutations go through GM.applyAction (via dispatch); the previous
   state is diffed on every change to surface evolution/KO events.
   GM and GM_DATA globals are installed by the boot loader in index.html. */

var UI = (function () {

  // ---------------- transient app state (never game rules) ----------------
  var App = {
    ready: false,
    screen: 'menu',        // 'menu' | 'host' | 'join' | 'game'
    mode: null,            // 'local' | 'host' | 'guest'
    mySeat: null,          // null = hotseat (both seats, one screen), 0 host, 1 guest
    state: null,           // game state (authoritative on host/local, synced on guest)
    sel: null,             // battle selection: { unitId, attack? }
    placeSel: null,        // placement: selected lineId
    auraPick: null,        // unitId chosen from the aura-order prompt
    modal: null,           // { type:'rules'|'evo'|'focus', ... }
    vm: {},                // per-render battle view-model (square map, previews)
    net: { code: '', status: 'idle', error: '' },  // status: idle|starting|waiting|up|down|error
    pendingMove: null,     // guest only: stashed move path awaiting the activate intent's state echo
    menuSeed: '', joinCode: '',
    lastAutoKey: '',
  };

  // ---------------- tiny DOM helpers ----------------
  function el(tag, attrs) {
    var n = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') n.className = v;
        else if (k === 'text') n.textContent = v;
        else if (k === 'disabled') n.disabled = true;
        else if (k.indexOf('on') === 0) n.addEventListener(k.slice(2), v);
        else n.setAttribute(k, v);
      }
    }
    for (var i = 2; i < arguments.length; i++) appendKid(n, arguments[i]);
    return n;
  }
  function appendKid(n, kid) {
    if (kid === null || kid === undefined || kid === false) return;
    if (Array.isArray(kid)) { for (var i = 0; i < kid.length; i++) appendKid(n, kid[i]); return; }
    n.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
  }
  function clearNode(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function hint(msg) { return el('div', { class: 'hint', text: msg }); }

  function toast(msg, cls) {
    var box = document.getElementById('toasts');
    if (!box) return;
    var t = el('div', { class: 'toast' + (cls ? ' ' + cls : ''), text: msg });
    box.appendChild(t);
    setTimeout(function () { t.classList.add('show'); }, 16);
    setTimeout(function () {
      t.classList.remove('show');
      setTimeout(function () { t.remove(); }, 400);
    }, 3400);
  }

  function copyText(txt) {
    function fallback() {
      var ta = el('textarea', { class: 'copy-ta' });
      ta.value = txt;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); toast('Copied'); } catch (e) { toast('Copy failed'); }
      ta.remove();
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(function () { toast('Copied'); }, fallback);
    } else fallback();
  }

  // ---------------- data-driven text (no creature stats hard-coded) ----------------
  var TRAIT_NAMES = { talonlock: 'Talonlock', tyrantbane: 'Tyrantbane', skulk: 'Skulk', backstab: 'Backstab', staticQuills: 'Static Quills', butcher: 'Butcher' };
  var TRAIT_TEXT = {
    talonlock: 'when its Pin lands, the Lunge is mandatory and it self-roots; its attacks deal x2 to Pinned units; Stoop Strike works while pinned/rooted.',
    tyrantbane: 'immune to Rival Specials & Auras; its attacks affect Rival units only when adjacent, at x2; Speed +2 while an enemy Rival final form lives.',
    skulk: 'its movement may pass through other units (cannot end on one).',
    backstab: '+2 damage (after any doubling) from the target’s rear or while an ally flanks the target.',
    staticQuills: 'any enemy that damages it with an attack from an adjacent square takes 1 damage afterward.',
    butcher: '+2 damage (after any doubling) to Pinned units.',
  };
  var AURA_NAMES = { localStorm: 'Local Storm', earthquake: 'Earthquake', dreadPresence: 'Dread Presence', hungryDepths: 'Hungry Depths' };
  var AURA_TEXT = {
    localStorm: 'end of its turn: 1 damage to every unit within 1, friend or foe.',
    earthquake: 'start of each enemy turn: each adjacent enemy unit moves 1 square in a random direction (visible d4; blocked roll = no move).',
    dreadPresence: 'adjacent enemies deal −1 damage (min 1); at the start of their turn adjacent enemies gain 1 Chill.',
    hungryDepths: 'end of its turn it MUST bite one adjacent unit for 1 (heals 3 if ally, 2 if enemy); if none adjacent it takes 1 itself.',
  };
  var PATTERN_LABEL = { single: 'Single', lance: 'Lance', cone: 'Cone', burst: 'Burst', bomb: 'Bomb', scatter: 'Scatter', telegrab: 'Telegrab' };

  function effectText(e) {
    if (e.kind === 'push') return 'Push ' + e.n;
    if (e.kind === 'pin') return 'Pin' + (e.centerOnly ? ' (center square only)' : '');
    if (e.kind === 'burn') return 'Burn ' + e.n + '/tick' + (e.nearOnly ? ' (near square only)' : '');
    if (e.kind === 'poison') return 'Poison';
    if (e.kind === 'chill') return 'Chill ' + e.n;
    if (e.kind === 'lure') return 'Lure (pull 1 + Hex)';
    return e.kind;
  }
  function riderText(r) {
    if (r.kind === 'recoil') return 'Recoil ' + r.n;
    if (r.kind === 'lunge') return 'Lunge';
    if (r.kind === 'blink') return 'Blink ' + r.n;
    return r.kind;
  }
  function specialText(sp) {
    if (!sp) return null;
    if (sp.pattern === 'telegrab') {
      return sp.name + ' — range ' + sp.range + ', relocate up to ' + sp.relocate +
        (sp.telesmash ? ', Telesmash 1→2→3' : ', no damage');
    }
    var pat = PATTERN_LABEL[sp.pattern];
    if (sp.pattern === 'single' || sp.pattern === 'lance' || sp.pattern === 'bomb') pat += ' ' + sp.range;
    if (sp.pattern === 'scatter') pat += ' R' + sp.range + ' ×' + sp.count;
    var parts = [pat, sp.dmg + ' dmg'];
    if (sp.bonusPerChill) parts.push('+1 per Chill stack on target');
    var i;
    for (i = 0; i < sp.effects.length; i++) parts.push(effectText(sp.effects[i]));
    for (i = 0; i < sp.riders.length; i++) parts.push(riderText(sp.riders[i]));
    return sp.name + ' — ' + parts.join(', ');
  }
  function evolveText(c) {
    if (!c) return null;
    if (c.kind === 'survived') return 'survive ' + c.n + ' turns';
    if (c.kind === 'dealt') return 'deal ' + c.n + ' damage';
    if (c.kind === 'ko') return 'KO an enemy';
    if (c.kind === 'allyKo') return 'an allied unit is KO’d';
    return '';
  }
  function evolveProgress(u, c) {
    if (!c) return '';
    if (c.kind === 'survived') return u.survived + '/' + c.n;
    if (c.kind === 'dealt') return u.dealt + '/' + c.n;
    if (c.kind === 'ko') return (u.kos > 0 ? 1 : 0) + '/1';
    if (c.kind === 'allyKo') return u.allyKoSeen ? 'met' : 'not yet';
    return '';
  }
  function typeChip(t) { return el('span', { class: 'type-chip t-' + t, text: t }); }
  function lineById(id) {
    for (var i = 0; i < GM_DATA.lines.length; i++) if (GM_DATA.lines[i].id === id) return GM_DATA.lines[i];
    return null;
  }
  function uname(u) { return GM.stageOf(u).name; }

  // ---------------- seats, dispatch, state ----------------
  function actingPlayer(s) {
    if (!s) return null;
    if (s.phase === 'draft') return s.draft.order[Math.min(s.draft.pickIndex, 11)];
    if (s.phase === 'placement') return s.placement.current;
    if (s.phase === 'battle') return s.turn.player;
    return null; // over: either player
  }
  function canAct() {
    if (!App.state) return false;
    var a = actingPlayer(App.state);
    if (a === null) return true;
    return App.mySeat === null || App.mySeat === a;
  }
  function seatName(p) {
    if (App.mySeat === null) return 'Player ' + (p + 1);
    return p === App.mySeat ? 'You' : 'Opponent';
  }

  function dispatch(action) {
    var s = App.state;
    if (!s) return false;
    if (App.mode === 'guest') {
      NET.sendIntent(action);
      return true;
    }
    var p = (s.phase === 'over') ? (App.mySeat === null ? 0 : App.mySeat) : actingPlayer(s);
    try {
      var ns = GM.applyAction(s, p, action);
      setState(ns);
      if (App.mode === 'host') NET.broadcastState(ns);
      return true;
    } catch (e) {
      toast(e.message);
      return false;
    }
  }

  function setState(ns) {
    var prev = App.state;
    App.state = ns;
    // keep transient selection coherent with the new state
    if (!ns || ns.phase !== 'battle') {
      App.sel = null;
      App.auraPick = null;
    } else {
      var cur = ns.turn.current;
      if (cur && canAct()) {
        if (!App.sel || App.sel.unitId !== cur.unitId) App.sel = { unitId: cur.unitId };
        if (cur.attacked && App.sel.attack) App.sel.attack = null;
      } else if (!cur && App.sel && App.sel.attack) {
        App.sel.attack = null;
      }
      if (!ns.turn.pendingAuras) App.auraPick = null;
    }
    if (ns && ns.phase === 'placement' && canAct()) {
      var p = ns.placement.current;
      if (!App.placeSel || linePlaced(ns, p, App.placeSel) || ns.draft.teams[p].indexOf(App.placeSel) === -1) {
        var next = null;
        for (var i = 0; i < ns.draft.teams[p].length; i++) {
          if (!linePlaced(ns, p, ns.draft.teams[p][i])) { next = ns.draft.teams[p][i]; break; }
        }
        if (next) App.placeSel = next;
      }
    }
    if (prev && ns) diffEvents(prev, ns);
    if (App.pendingMove) {
      // Guest: the move half of an activate+move tap waits for the host's state
      // echo of the activate, so a rejected activate never fires a doomed move.
      var pm = App.pendingMove;
      App.pendingMove = null;
      var pc = ns && ns.phase === 'battle' ? ns.turn.current : null;
      if (App.mode === 'guest' && pc && pc.unitId === pm.unitId && !pc.moved && !pc.attacked) {
        NET.sendIntent({ t: 'move', path: pm.path });
      }
    }
    render();
    setTimeout(runAutoSteps, 60);
  }

  // Evolution = an event: diff prev vs new state for stage jumps and KOs.
  function diffEvents(prev, ns) {
    if (!prev.units || !ns.units) return;
    var evos = [];
    for (var i = 0; i < ns.units.length; i++) {
      var u = ns.units[i], pu = prev.units[u.id];
      if (!pu || pu.lineId !== u.lineId) continue;
      if (u.stage > pu.stage) {
        var line = GM.lineOf(u);
        evos.push({ from: line.stages[pu.stage].name, to: line.stages[u.stage].name, owner: u.owner });
      }
      if (pu.pos && !u.pos) toast(uname(u) + ' is KO’d!', 'ko');
    }
    if (evos.length) {
      if (App.modal && App.modal.type === 'evo') App.modal.items = App.modal.items.concat(evos);
      else App.modal = { type: 'evo', items: evos };
    }
  }

  // Auto-steps: close spent activations; resolve choiceless single auras.
  function runAutoSteps() {
    var s = App.state;
    if (!s || s.phase !== 'battle' || !canAct()) return;
    var key = JSON.stringify([s.log.length, s.turn]);
    if (App.lastAutoKey === key) return;
    var cur = s.turn.current;
    if (cur) {
      // DEV-PIN 24: one optional move AND one optional attack, either order.
      // Auto-end only when nothing remains: each half is either done or
      // impossible (GM.reachable/GM.attackChoices encode pin/root/freeze/
      // no-target rules — empty means that half can't happen).
      var mayMove = !cur.moved && GM.reachable(s, cur.unitId).length > 0;
      var mayAttack = !cur.attacked && GM.attackChoices(s, cur.unitId).length > 0;
      if (!mayMove && !mayAttack) {
        App.lastAutoKey = key;
        dispatch({ t: 'endActivation' });
        return;
      }
    }
    if (s.turn.pendingAuras) {
      var pend = GM.pendingAuras(s);
      if (pend.length === 1 && !pend[0].needsTarget) {
        App.lastAutoKey = key;
        dispatch({ t: 'aura', unitId: pend[0].unitId });
      }
    }
  }

  // ---------------- game starters / net glue ----------------
  function parseSeed(str) {
    str = (str || '').trim();
    if (!str) return (Math.random() * 4294967296) >>> 0;
    if (/^\d+$/.test(str)) return Number(str) >>> 0;
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }
  function randSeed() { return (Math.random() * 4294967296) >>> 0; }
  function randCoin() { return Math.random() < 0.5 ? 0 : 1; }

  function startLocal() {
    App.mode = 'local'; App.mySeat = null; App.screen = 'game';
    App.net = { code: '', status: 'idle' };
    setState(GM.createGame(parseSeed(App.menuSeed), randCoin()));
  }

  function startHost() {
    App.mode = 'host'; App.mySeat = 0; App.screen = 'host';
    App.net = { code: '', status: 'starting', error: '' };
    render();
    NET.host({
      onOpen: function (code) { App.net.code = code; App.net.status = 'waiting'; render(); },
      onGuestJoined: function () {
        if (!App.state) {
          App.screen = 'game'; App.net.status = 'up';
          // Same seed field as local games — SPEC §5 'seed shown/settable'; blank = random.
          setState(GM.createGame(parseSeed(App.menuSeed), randCoin()));
        } else {
          App.net.status = 'up';
          toast('Opponent connected');
          render();
        }
        return App.state; // NET sends this to the (re)joined guest
      },
      onIntent: function (player, action) {
        try {
          if (action && action.t === 'rematch') {
            // Guest may request a rematch (CONTRACT: 'either player'), but the
            // host generates all randomness (SPEC §1.5): re-seed the action.
            action = { t: 'rematch', seed: randSeed(), coinWinner: randCoin() };
          }
          var ns = GM.applyAction(App.state, player, action);
          setState(ns);
          NET.broadcastState(ns);
          return { ok: true };
        } catch (e) {
          return { ok: false, msg: e.message };
        }
      },
      onDown: function () { App.net.status = 'down'; render(); },
      onError: function (msg) {
        toast(msg);
        if (App.screen === 'host') { App.net.status = 'error'; App.net.error = msg; render(); }
      },
    });
  }

  function normalizeCode(c) {
    c = (c || '').trim().toLowerCase();
    if (!c) return '';
    return c.indexOf('gm-') === 0 ? c : 'gm-' + c;
  }
  function startJoin() {
    var code = normalizeCode(App.joinCode);
    if (!code) { toast('Enter a room code'); return; }
    App.mode = 'guest'; App.mySeat = 1; App.screen = 'join';
    App.net = { code: code, status: 'starting', error: '' };
    render();
    NET.join(code, {
      onWelcome: function (seat) { App.mySeat = seat; },
      onState: function (st) {
        App.net.status = 'up';
        App.screen = 'game';
        setState(st);
      },
      onDown: function () { App.net.status = 'down'; render(); },
      onError: function (msg) {
        toast(msg);
        if (App.screen === 'join') { App.net.status = 'error'; App.net.error = msg; }
        render();
      },
    });
  }

  // ---------------- screens ----------------
  function render() {
    var root = document.getElementById('app');
    if (!root) return;
    clearNode(root);
    if (!App.ready) { root.appendChild(el('div', { class: 'boot', text: 'Loading…' })); return; }
    var main;
    if (App.screen === 'menu') main = renderMenu();
    else if (App.screen === 'host') main = renderHostWait();
    else if (App.screen === 'join') main = renderJoinWait();
    else main = renderGame();
    root.appendChild(main);
    var modal = renderModal();
    if (modal) root.appendChild(modal);
    var logBox = root.querySelector('.log-entries');
    if (logBox) logBox.scrollTop = logBox.scrollHeight;
  }

  function renderMenu() {
    var remoteOk = location.protocol !== 'file:' && typeof Peer !== 'undefined';
    var remoteNote = remoteOk ? null
      : (location.protocol === 'file:'
        ? 'Remote play needs the HTTPS-hosted page — hotseat works offline.'
        : 'PeerJS failed to load (offline?) — hotseat still works.');
    return el('div', { class: 'menu' },
      el('h1', { text: 'Grid Monsters' }),
      el('p', { class: 'tagline', text: '8×8 monster tactics — draft, evolve, eliminate. v7 beta.' }),
      el('section', { class: 'menu-box' },
        el('h2', { text: 'Local game' }),
        el('p', { class: 'muted', text: 'Hotseat — both players share this screen.' }),
        el('div', { class: 'menu-row' },
          el('input', {
            class: 'input', placeholder: 'Seed, local or hosted (blank = random)', value: App.menuSeed,
            oninput: function (e) { App.menuSeed = e.target.value; },
          }),
          el('button', { class: 'btn primary big', onclick: startLocal, text: 'Start local game' })),
      ),
      el('section', { class: 'menu-box' + (remoteOk ? '' : ' disabled-box') },
        el('h2', { text: 'Remote game' }),
        el('p', { class: 'muted', text: 'Peer-to-peer over a room code. Host creates the code; the other player joins.' }),
        remoteNote ? el('p', { class: 'warn', text: remoteNote }) : null,
        el('div', { class: 'menu-row' },
          el('button', { class: 'btn primary big', disabled: !remoteOk, onclick: startHost, text: 'Host' }),
          el('input', {
            class: 'input', placeholder: 'Room code (gm-xxxxx)', value: App.joinCode, disabled: !remoteOk,
            oninput: function (e) { App.joinCode = e.target.value; },
            onkeydown: function (e) { if (e.key === 'Enter') startJoin(); },
          }),
          el('button', { class: 'btn big', disabled: !remoteOk, onclick: startJoin, text: 'Join' })),
      ),
      el('div', { class: 'menu-row center' },
        el('button', { class: 'btn big', onclick: function () { App.modal = { type: 'rules' }; render(); }, text: 'Rules' })),
      el('p', { class: 'muted small center', text: 'Some restrictive networks (symmetric NAT) cannot connect peer-to-peer; fall back to hotseat over a screen-share.' }));
  }

  function renderHostWait() {
    return el('div', { class: 'menu' },
      el('h1', { text: 'Hosting' }),
      App.net.status === 'error'
        ? el('div', { class: 'menu-box center' },
          el('p', { class: 'warn', text: App.net.error || 'Could not create the room.' }),
          el('button', { class: 'btn primary big', onclick: startHost, text: 'Retry' }))
        : App.net.status === 'starting'
          ? el('p', { class: 'muted', text: 'Creating room…' })
          : el('div', { class: 'menu-box center' },
            el('p', { text: 'Room code:' }),
            el('div', { class: 'room-code', text: App.net.code }),
            el('button', { class: 'btn big', onclick: function () { copyText(App.net.code); }, text: 'Copy code' }),
            el('p', { class: 'muted', text: 'Waiting for the other player to join…' })),
      el('button', { class: 'btn', onclick: function () { location.reload(); }, text: 'Back' }));
  }

  function renderJoinWait() {
    return el('div', { class: 'menu' },
      el('h1', { text: 'Joining' }),
      App.net.status === 'error'
        ? el('div', { class: 'menu-box center' },
          el('p', { class: 'warn', text: App.net.error || 'Could not connect.' }),
          el('button', { class: 'btn primary big', onclick: startJoin, text: 'Retry' }))
        : el('p', { class: 'muted', text: 'Connecting to ' + App.net.code + '…' }),
      el('button', { class: 'btn', onclick: function () { location.reload(); }, text: 'Back' }));
  }

  function renderGame() {
    var st = App.state;
    var wrap = el('div', { class: 'game' });
    wrap.appendChild(renderTopBar(st));
    if (App.net.status === 'down') wrap.appendChild(renderNetBanner());
    if (st.phase === 'draft') wrap.appendChild(renderDraft(st));
    else if (st.phase === 'placement') wrap.appendChild(renderPlacement(st));
    else wrap.appendChild(renderBattle(st)); // battle + over
    return wrap;
  }

  function renderTopBar(st) {
    var phaseName = { draft: 'Draft', placement: 'Placement', battle: 'Battle', over: 'Game over' }[st.phase];
    return el('div', { class: 'topbar' },
      el('span', { class: 'brand', text: 'Grid Monsters' }),
      el('span', { class: 'chip', text: phaseName }),
      el('span', { class: 'chip seed', text: 'seed ' + st.seed }),
      App.mode !== 'local' && App.net.code ? el('span', {
        class: 'chip room', text: App.net.code, title: 'Tap to copy room code',
        onclick: function () { copyText(App.net.code); },
      }) : null,
      App.mySeat !== null ? el('span', { class: 'chip p' + App.mySeat, text: 'You are P' + (App.mySeat + 1) }) : null,
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn small-btn', onclick: function () { App.modal = { type: 'rules' }; render(); }, text: 'Rules' }),
      el('button', {
        class: 'btn small-btn', text: 'Quit',
        onclick: function () { if (window.confirm('Leave the game?')) location.reload(); },
      }));
  }

  function renderNetBanner() {
    return el('div', { class: 'net-banner' },
      el('span', { text: 'Connection lost — room ' + App.net.code }),
      el('button', {
        class: 'btn small-btn', text: 'Copy game state',
        onclick: function () { copyText(JSON.stringify(App.state)); },
      }),
      App.mode === 'guest' ? el('button', {
        class: 'btn small-btn primary', text: 'Rejoin',
        onclick: function () { App.net.status = 'starting'; render(); toast('Reconnecting…'); NET.rejoin(); },
      }) : el('span', { class: 'muted small', text: 'Waiting for the guest to rejoin with the code…' }));
  }

  // ---------------- draft ----------------
  function isPickable(st, line) {
    var d = st.draft;
    if (st.phase !== 'draft' || d.pickIndex >= 12) return false;
    if (d.teams[0].indexOf(line.id) !== -1 || d.teams[1].indexOf(line.id) !== -1) return false;
    if (line.id === d.cutTyrant) return false;
    return d.pickIndex < 2 ? line.tyrant : !line.tyrant;
  }

  function renderDraft(st) {
    var d = st.draft;
    var picker = d.order[Math.min(d.pickIndex, 11)];
    var my = canAct();
    var phaseTxt = d.pickIndex < 2 ? 'Tyrant phase — pick a tyrant line' : 'Snake draft — pick ' + (d.pickIndex + 1) + ' of 12';
    var banner = el('div', { class: 'phase-banner p' + picker },
      el('div', { class: 'pb-main', text: seatName(picker) + ' to pick · ' + phaseTxt }),
      el('div', { class: 'pb-sub', text: 'Coin flip: ' + seatName(st.coinWinner) + ' won the toss (picks a tyrant first; flip loser starts the snake)' }));
    var strip = el('div', { class: 'pick-strip' });
    for (var i = 0; i < d.order.length; i++) {
      strip.appendChild(el('span', {
        class: 'pick-chip p' + d.order[i] + (i === d.pickIndex ? ' now' : '') + (i < d.pickIndex ? ' done' : ''),
        text: 'P' + (d.order[i] + 1) + (i < 2 ? '★' : ''),
      }));
    }
    var grid = el('div', { class: 'card-grid' });
    for (var j = 0; j < GM_DATA.lines.length; j++) grid.appendChild(draftCard(st, GM_DATA.lines[j], my));
    return el('div', { class: 'draft' }, banner, strip,
      el('div', { class: 'teams-row' }, teamSummary(st, 0), teamSummary(st, 1)), grid);
  }

  function teamSummary(st, p) {
    var names = [];
    for (var i = 0; i < st.draft.teams[p].length; i++) names.push(lineById(st.draft.teams[p][i]).stages[0].name);
    return el('div', { class: 'team-summary p' + p },
      el('b', { text: seatName(p) + ': ' }), names.length ? names.join(', ') : '—');
  }

  function draftCard(st, line, my) {
    var d = st.draft;
    var t0 = d.teams[0].indexOf(line.id) !== -1, t1 = d.teams[1].indexOf(line.id) !== -1;
    var cut = d.cutTyrant === line.id;
    var pickable = my && isPickable(st, line);
    var idle = !pickable && !t0 && !t1 && !cut;
    var cls = 'card' + (t0 ? ' team0' : '') + (t1 ? ' team1' : '') + (cut ? ' cut' : '') +
      (pickable ? ' pickable' : '') + (idle ? ' idle' : '');
    var head = el('div', { class: 'card-head' },
      el('span', { class: 'card-num', text: '#' + line.num }),
      el('span', { class: 'card-name', text: line.stages[0].name }),
      typeChip(line.type),
      line.tyrant ? el('span', { class: 'tyrant-chip', text: 'TYRANT' }) : null,
      t0 ? el('span', { class: 'team-chip p0', text: 'P1' }) : null,
      t1 ? el('span', { class: 'team-chip p1', text: 'P2' }) : null,
      cut ? el('span', { class: 'cut-chip', text: 'CUT' }) : null);
    var body = [head];
    for (var i = 0; i < line.stages.length; i++) body.push(stageRow(line.stages[i]));
    return el('div', {
      class: cls,
      onclick: pickable ? function () { dispatch({ t: 'pick', lineId: line.id }); } : null,
    }, body);
  }

  function stageRow(stg) {
    return el('div', { class: 'stage-row' },
      el('div', { class: 'stage-line1' },
        el('b', { text: stg.name }),
        ' — HP ' + stg.hp + ' · Spd ' + stg.speed + ' · Basic ' + stg.basic,
        stg.rival ? el('span', { class: 'rival-chip', text: 'RIVAL' }) : null),
      stg.special ? el('div', { class: 'stage-special', text: '★ ' + specialText(stg.special) }) : null,
      stg.traits.length ? el('div', { class: 'stage-trait' },
        stg.traits.map(function (t) { return TRAIT_NAMES[t] + ' — ' + TRAIT_TEXT[t]; }).join(' ')) : null,
      stg.aura ? el('div', { class: 'stage-aura', text: 'Aura: ' + AURA_NAMES[stg.aura] + ' — ' + AURA_TEXT[stg.aura] }) : null,
      stg.evolve ? el('div', { class: 'stage-evolve', text: '→ evolves: ' + evolveText(stg.evolve) }) : null);
  }

  // ---------------- placement ----------------
  function backRowsOf(p) { return p === 0 ? [0, 1] : [6, 7]; }
  function placedUnit(st, p, lineId) {
    for (var i = 0; i < st.units.length; i++) {
      var u = st.units[i];
      if (u.owner === p && u.lineId === lineId && u.pos) return u;
    }
    return null;
  }
  function linePlaced(st, p, lineId) { return !!placedUnit(st, p, lineId); }

  function renderPlacement(st) {
    var p = st.placement.current;
    var my = canAct();
    var count = 0, team = st.draft.teams[p];
    for (var i = 0; i < team.length; i++) if (linePlaced(st, p, team[i])) count++;
    var banner = el('div', { class: 'phase-banner p' + p },
      el('div', {
        class: 'pb-main',
        text: my ? seatName(p) + ' — place your units (' + count + '/6)'
          : 'Waiting for ' + seatName(p) + ' to place units (' + count + '/6)…',
      }),
      el('div', { class: 'pb-sub', text: 'Back two rows only. Tap a unit card, then a highlighted square. Re-tap a placed unit to reposition.' }));

    var info = {};
    if (my && App.placeSel) {
      var rows = backRowsOf(p);
      for (var r = 0; r < rows.length; r++) {
        for (var x = 0; x < 8; x++) {
          var y = rows[r];
          if (!unitAtPos(st, x, y)) {
            info[x + ',' + y] = { cls: ['hl-place'], tap: { kind: 'place', x: x, y: y } };
          }
        }
      }
    }
    App.vm = { info: info };

    var roster = el('div', { class: 'roster' });
    for (var j = 0; j < team.length; j++) {
      var lid = team[j];
      var line = lineById(lid);
      var pu = placedUnit(st, p, lid);
      roster.appendChild(el('div', {
        class: 'roster-card p' + p + (App.placeSel === lid && my ? ' selected' : '') + (pu ? ' placed' : ''),
        onclick: (function (id) {
          return my ? function () { App.placeSel = id; render(); } : null;
        })(lid),
      },
        el('b', { text: line.stages[0].name }),
        el('span', { class: 'muted small', text: ' HP ' + line.stages[0].hp + ' · Spd ' + line.stages[0].speed }),
        el('div', { class: 'small', text: pu ? '✓ placed (' + pu.pos.x + ',' + pu.pos.y + ')' : 'tap, then a square' })));
    }

    var controls = el('div', { class: 'controls' },
      my && App.placeSel && linePlaced(st, p, App.placeSel) ? el('button', {
        class: 'btn', text: 'Remove',
        onclick: function () { dispatch({ t: 'unplace', lineId: App.placeSel }); },
      }) : null,
      my ? el('button', {
        class: 'btn primary big', disabled: count !== 6,
        onclick: function () { dispatch({ t: 'confirm' }); },
        text: count === 6 ? 'Confirm placement' : 'Place all 6 (' + count + '/6)',
      }) : null);

    return el('div', { class: 'placement' }, banner,
      el('div', { class: 'battle-mid' },
        renderBoard(info),
        el('div', { class: 'panel' }, roster, controls, draftRecap(st))));
  }

  function draftRecap(st) {
    var rows = [];
    for (var i = 0; i < GM_DATA.lines.length; i++) {
      var line = GM_DATA.lines[i];
      var t0 = st.draft.teams[0].indexOf(line.id) !== -1, t1 = st.draft.teams[1].indexOf(line.id) !== -1;
      var cut = st.draft.cutTyrant === line.id;
      rows.push(el('div', { class: 'recap-row' + (!t0 && !t1 ? ' out' : '') },
        el('span', { text: line.stages[0].name }),
        t0 ? el('span', { class: 'team-chip p0', text: 'P1' }) :
          t1 ? el('span', { class: 'team-chip p1', text: 'P2' }) :
            el('span', { class: 'muted small', text: cut ? 'CUT' : 'sits out' })));
    }
    return el('details', { class: 'recap' }, el('summary', { text: 'Draft results (24 lines)' }), rows);
  }

  // ---------------- battle ----------------
  function unitAtPos(st, x, y) {
    for (var i = 0; i < st.units.length; i++) {
      var u = st.units[i];
      if (u.pos && u.pos.x === x && u.pos.y === y) return u;
    }
    return null;
  }
  function canActivate(st, uid) {
    var u = st.units[uid];
    return st.phase === 'battle' && !st.turn.current && !st.turn.pendingAuras &&
      st.turn.activationsUsed < 3 && u && u.pos && u.owner === st.turn.player &&
      st.turn.activated.indexOf(uid) === -1;
  }
  function moveBlockReason(st, u) {
    var t = st.playerTurns[u.owner];
    if (u.pinnedTurn === t) return 'Pinned';
    if (u.rootedTurn === t) return 'Rooted (Talonlock)';
    if (GM.isFrozen(st, u.id)) return 'Hard Frozen';
    if (GM.effectiveSpeed(st, u.id) <= 0) return 'Speed 0';
    return null;
  }

  function buildParams(atk) {
    var a = { t: 'attack', kind: atk.kind };
    if (atk.kind === 'basic') a.target = atk.target;
    else if (atk.pattern === 'single' || atk.pattern === 'lance' || atk.pattern === 'cone') a.dir = atk.dir;
    else if (atk.pattern === 'bomb') a.target = atk.target;
    else if (atk.pattern === 'scatter') a.squares = atk.squares;
    else if (atk.pattern === 'telegrab') { a.targetUnit = atk.targetUnit; a.relocateTo = atk.relocateTo; }
    if (atk.focus !== null && atk.focus !== undefined) a.focus = atk.focus;
    if (atk.lungeTo) a.lungeTo = atk.lungeTo;
    if (atk.blinkTo) a.blinkTo = atk.blinkTo;
    return a;
  }
  function isStaged(atk) {
    if (atk.kind === 'basic') return !!atk.target;
    if (atk.pattern === 'single' || atk.pattern === 'lance' || atk.pattern === 'cone') return !!atk.dir;
    if (atk.pattern === 'burst') return true;
    if (atk.pattern === 'bomb') return !!atk.target;
    if (atk.pattern === 'scatter') return atk.squares.length > 0;
    if (atk.pattern === 'telegrab') return atk.targetUnit !== null && atk.relocateDecided;
    return false;
  }
  // Pattern area for preview shading (advisory; exact hit units come from previewAttack).
  function patternArea(st, u, atk) {
    var out = [], i, p;
    function add(x, y) { if (x >= 0 && x < 8 && y >= 0 && y < 8) out.push({ x: x, y: y }); }
    var pat = atk.kind === 'basic' ? 'basic' : atk.pattern;
    if (pat === 'basic') { if (atk.target) add(atk.target.x, atk.target.y); }
    else if (pat === 'single') {
      var sp1 = GM.stageOf(u).special;
      for (i = 1; i <= sp1.range; i++) {
        var x1 = u.pos.x + atk.dir.dx * i, y1 = u.pos.y + atk.dir.dy * i;
        if (x1 < 0 || x1 > 7 || y1 < 0 || y1 > 7) break;
        add(x1, y1);
        if (unitAtPos(st, x1, y1)) break;
      }
    } else if (pat === 'lance') {
      var sp2 = GM.stageOf(u).special;
      for (i = 1; i <= sp2.range; i++) add(u.pos.x + atk.dir.dx * i, u.pos.y + atk.dir.dy * i);
    } else if (pat === 'cone') {
      add(u.pos.x + atk.dir.dx, u.pos.y + atk.dir.dy);
      var fx = u.pos.x + 2 * atk.dir.dx, fy = u.pos.y + 2 * atk.dir.dy;
      for (i = -1; i <= 1; i++) { if (atk.dir.dx === 0) add(fx + i, fy); else add(fx, fy + i); }
    } else if (pat === 'burst') {
      for (var dx = -1; dx <= 1; dx++) for (var dy = -1; dy <= 1; dy++) if (dx || dy) add(u.pos.x + dx, u.pos.y + dy);
    } else if (pat === 'bomb') {
      if (atk.target) {
        add(atk.target.x, atk.target.y);
        add(atk.target.x + 1, atk.target.y); add(atk.target.x - 1, atk.target.y);
        add(atk.target.x, atk.target.y + 1); add(atk.target.x, atk.target.y - 1);
      }
    } else if (pat === 'scatter') {
      for (i = 0; i < atk.squares.length; i++) add(atk.squares[i].x, atk.squares[i].y);
    } else if (pat === 'telegrab') {
      if (atk.targetUnit !== null) {
        p = st.units[atk.targetUnit].pos;
        if (p) add(p.x, p.y);
      }
    }
    return out;
  }

  function computeVM(st) {
    var vm = { info: {}, choices: [], pv: null };
    function get(x, y) {
      var k = x + ',' + y;
      if (!vm.info[k]) vm.info[k] = { cls: [], tap: null };
      return vm.info[k];
    }
    if (st.phase !== 'battle' && st.phase !== 'over') return vm;
    var mine = canAct() && st.phase === 'battle' && !st.turn.pendingAuras;
    var cur = st.turn.current;
    var selId = cur ? cur.unitId : (App.sel ? App.sel.unitId : null);
    var selValid = selId !== null && selId !== undefined && st.units[selId] && st.units[selId].pos;
    // Advisory movement range (no taps) — SPEC §2/§8: selecting ANY unit shows
    // its reachable squares, including enemies and out-of-turn units.
    function ghostReach(uid) {
      var gst = st, gu = st.units[uid];
      // Engine sentinel quirk: an unpinned unit whose owner hasn't started a
      // turn yet (playerTurns 0) matches pinnedTurn 0 and reads as blocked;
      // nudge the clock on a clone for this display-only computation.
      if (st.playerTurns[gu.owner] === 0 && gu.pinnedTurn === 0 && gu.rootedTurn === 0) {
        gst = JSON.parse(JSON.stringify(st));
        gst.playerTurns[gu.owner] = 1;
      }
      var r = GM.reachable(gst, uid);
      for (var g = 0; g < r.length; g++) get(r[g].x, r[g].y).cls.push('hl-move', 'ghost');
    }
    if (selValid) {
      var sp = st.units[selId].pos;
      get(sp.x, sp.y).cls.push('sq-sel');
    }
    if (!mine) {
      if (selValid) ghostReach(selId);
      return vm;
    }

    var atk = App.sel && App.sel.attack;
    if (cur && !cur.attacked) vm.choices = GM.attackChoices(st, cur.unitId);

    if (cur && atk) {
      fillAttackInfo(st, cur.unitId, atk, vm, get);
    } else if (cur && !cur.moved) {
      // DEV-PIN 24: the move half stays available before OR after the attack.
      var reach = GM.reachable(st, cur.unitId);
      for (var i = 0; i < reach.length; i++) {
        var c = get(reach[i].x, reach[i].y);
        c.cls.push('hl-move');
        c.tap = { kind: 'move', path: reach[i].path };
      }
    } else if (!cur && App.sel && canActivate(st, App.sel.unitId)) {
      var reach2 = GM.reachable(st, App.sel.unitId);
      for (var j = 0; j < reach2.length; j++) {
        var c2 = get(reach2[j].x, reach2[j].y);
        c2.cls.push('hl-move', 'ghost');
        c2.tap = { kind: 'activateMove', unitId: App.sel.unitId, path: reach2[j].path };
      }
    } else if (!cur && selValid) {
      ghostReach(selId); // enemy / already-activated unit: range shown, no taps
    }
    return vm;
  }

  function fillAttackInfo(st, uid, atk, vm, get) {
    var u = st.units[uid], i, c, p;
    // rider prompt stages
    if (atk.stage === 'lunge' || atk.stage === 'blink') {
      var squares = atk.stage === 'lunge' ? atk.pv.lungeSquares : atk.pv.blinkSquares;
      for (i = 0; i < squares.length; i++) {
        c = get(squares[i].x, squares[i].y);
        c.cls.push('hl-rider');
        c.tap = { kind: atk.stage, x: squares[i].x, y: squares[i].y };
      }
      return;
    }
    // geometry candidates
    var choices = vm.choices;
    if (atk.kind === 'basic') {
      for (i = 0; i < choices.length; i++) {
        if (choices[i].kind !== 'basic') continue;
        c = get(choices[i].target.x, choices[i].target.y);
        c.cls.push('hl-cand');
        c.tap = { kind: 'basicTarget', x: choices[i].target.x, y: choices[i].target.y };
      }
    } else if (atk.pattern === 'bomb') {
      for (i = 0; i < choices.length; i++) {
        if (choices[i].pattern !== 'bomb') continue;
        c = get(choices[i].target.x, choices[i].target.y);
        c.cls.push('hl-cand');
        c.tap = { kind: 'bombTarget', x: choices[i].target.x, y: choices[i].target.y };
      }
      if (atk.target) get(atk.target.x, atk.target.y).cls.push('hl-chosen');
    } else if (atk.pattern === 'scatter') {
      var sc = null;
      for (i = 0; i < choices.length; i++) if (choices[i].pattern === 'scatter') sc = choices[i];
      if (sc) {
        for (i = 0; i < sc.squares.length; i++) {
          c = get(sc.squares[i].x, sc.squares[i].y);
          c.cls.push('hl-range');
          c.tap = { kind: 'scatterToggle', x: sc.squares[i].x, y: sc.squares[i].y };
        }
      }
      for (i = 0; i < atk.squares.length; i++) get(atk.squares[i].x, atk.squares[i].y).cls.push('hl-chosen');
    } else if (atk.pattern === 'telegrab') {
      for (i = 0; i < choices.length; i++) {
        if (choices[i].pattern !== 'telegrab') continue;
        var v = st.units[choices[i].targetUnit];
        if (!v.pos) continue;
        c = get(v.pos.x, v.pos.y);
        c.cls.push('hl-cand');
        c.tap = { kind: 'grabTarget', unitId: choices[i].targetUnit };
      }
      if (atk.targetUnit !== null && st.units[atk.targetUnit].pos) {
        p = st.units[atk.targetUnit].pos;
        get(p.x, p.y).cls.push('hl-chosen');
        var ch = null;
        for (i = 0; i < choices.length; i++) if (choices[i].pattern === 'telegrab' && choices[i].targetUnit === atk.targetUnit) ch = choices[i];
        if (ch) {
          for (i = 0; i < ch.relocateSquares.length; i++) {
            c = get(ch.relocateSquares[i].x, ch.relocateSquares[i].y);
            c.cls.push('hl-reloc');
            c.tap = { kind: 'relocate', x: ch.relocateSquares[i].x, y: ch.relocateSquares[i].y };
          }
        }
        if (atk.relocateTo) get(atk.relocateTo.x, atk.relocateTo.y).cls.push('hl-chosen');
      }
    }
    // staged preview: exact hit squares + focus candidates
    if (isStaged(atk)) {
      var pv = GM.previewAttack(st, uid, buildParams(atk));
      vm.pv = pv;
      if (pv.legal) {
        var area = patternArea(st, u, atk);
        for (i = 0; i < area.length; i++) get(area[i].x, area[i].y).cls.push('hl-area');
        for (i = 0; i < pv.hits.length; i++) {
          var hv = st.units[pv.hits[i].unitId];
          if (hv.pos) get(hv.pos.x, hv.pos.y).cls.push('hl-hit');
        }
        for (i = 0; i < pv.focusEligible.length; i++) {
          var fv = st.units[pv.focusEligible[i]];
          if (!fv.pos) continue;
          c = get(fv.pos.x, fv.pos.y);
          c.cls.push('hl-focus');
          // Never shadow a geometry tap (bomb re-center, scatter unselect,
          // telegrab retarget) — the confirm-time focus modal covers those squares.
          if (pv.needsFocus && !c.tap) c.tap = { kind: 'focus', unitId: pv.focusEligible[i] };
        }
        if (atk.focus !== null && atk.focus !== undefined && st.units[atk.focus].pos) {
          p = st.units[atk.focus].pos;
          get(p.x, p.y).cls.push('hl-focus-picked');
        }
      }
    }
  }

  function renderBattle(st) {
    App.vm = computeVM(st);
    var cont = el('div', { class: 'battle' });
    cont.appendChild(renderTurnBanner(st));
    cont.appendChild(el('div', { class: 'battle-mid' },
      renderBoard(App.vm.info),
      el('div', { class: 'panel' }, renderUnitInfo(st), renderActions(st), renderLog(st))));
    var aura = renderAuraPrompt(st);
    if (aura) cont.appendChild(aura);
    if (st.phase === 'over') cont.appendChild(renderWinOverlay(st));
    return cont;
  }

  function renderTurnBanner(st) {
    var t = st.turn;
    var remaining = 3 - t.activationsUsed;
    var mine = canAct();
    var pips = [];
    for (var i = 0; i < 3; i++) pips.push(el('span', { class: 'act-pip' + (i < remaining ? ' on' : ''), text: '●' }));
    var status;
    if (st.phase === 'over') status = 'Game over';
    else if (t.pendingAuras) status = mine ? 'Resolve end-of-turn auras' : 'Resolving auras…';
    else status = remaining + ' activation' + (remaining === 1 ? '' : 's') + ' left';
    var whoTxt = App.mySeat === null ? seatName(t.player) + "'s turn" : (mine ? 'Your turn' : "Opponent's turn");
    return el('div', { class: 'turn-banner p' + t.player },
      el('span', { class: 'tb-who', text: whoTxt }),
      el('span', { class: 'tb-pips' }, pips),
      el('span', { class: 'tb-status', text: status }),
      el('span', { class: 'spacer' }),
      st.phase === 'battle' ? el('button', {
        class: 'btn small-btn', text: 'End turn',
        disabled: !mine || !!t.current || !!t.pendingAuras,
        onclick: function () { dispatch({ t: 'endTurn' }); },
      }) : null);
  }

  function flippedView() { return App.mySeat === 1; }
  function dispFace(f) {
    var map = flippedView()
      ? { N: 'down', S: 'up', E: 'left', W: 'right' }
      : { N: 'up', S: 'down', E: 'right', W: 'left' };
    return map[f];
  }
  // Screen-relative facing for text (matches the on-board triangle on a flipped board).
  function faceArrow(f) { return { up: '↑ up', down: '↓ down', left: '← left', right: '→ right' }[dispFace(f)]; }
  function arrowFor(d) {
    var f = flippedView() ? -1 : 1;
    var key = (d.dx * f) + ',' + (d.dy * f);
    return ({ '0,1': '↑', '1,1': '↗', '1,0': '→', '1,-1': '↘', '0,-1': '↓', '-1,-1': '↙', '-1,0': '←', '-1,1': '↖' })[key];
  }

  function renderBoard(info) {
    var st = App.state;
    var board = el('div', { class: 'board' });
    for (var r = 0; r < 8; r++) {
      for (var c = 0; c < 8; c++) {
        var x = flippedView() ? 7 - c : c;
        var y = flippedView() ? r : 7 - r;
        var inf = info && info[x + ',' + y];
        var cls = 'sq ' + (((x + y) % 2) ? 'sq-a' : 'sq-b') + (inf && inf.cls.length ? ' ' + inf.cls.join(' ') : '');
        var sqEl = el('div', {
          class: cls,
          onclick: (function (xx, yy) { return function () { onSquareTap(xx, yy); }; })(x, y),
        });
        var u = unitAtPos(st, x, y);
        if (u) sqEl.appendChild(renderUnit(st, u));
        board.appendChild(sqEl);
      }
    }
    return board;
  }

  function renderUnit(st, u) {
    var stg = GM.stageOf(u);
    var t = st.turn;
    var inBattle = st.phase === 'battle' || st.phase === 'over';
    var dim = inBattle && t.activated.indexOf(u.id) !== -1 && (!t.current || t.current.unitId !== u.id);
    var isCur = inBattle && t.current && t.current.unitId === u.id;
    var frozen = inBattle && GM.isFrozen(st, u.id);
    var badges = [];
    if (GM.isPinned(st, u.id)) badges.push(['PIN', 'b-pin']);
    if (u.rootedTurn > 0) badges.push(['RT', 'b-root']);
    if (u.burn) badges.push(['🔥' + u.burn.n, 'b-burn']);
    if (u.poison > 0) badges.push(['☠' + u.poison, 'b-poison']);
    if (u.chill > 0) badges.push(['❄' + u.chill, 'b-chill']);
    if (u.hexTurns > 0) badges.push(['HEX', 'b-hex']);
    var badgeEls = [];
    for (var i = 0; i < badges.length; i++) badgeEls.push(el('span', { class: 'badge ' + badges[i][1], text: badges[i][0] }));
    var pips = '';
    for (var s = 0; s <= u.stage; s++) pips += '●';
    return el('div', {
      class: 'unit p' + u.owner + (dim ? ' dim' : '') + (isCur ? ' current' : '') +
        (frozen ? ' frozen' : '') + ' face-' + dispFace(u.facing),
      title: stg.name,
    },
      el('div', { class: 'u-badges' }, badgeEls),
      el('div', { class: 'u-init', text: stg.name.charAt(0) }),
      el('div', { class: 'u-meta' },
        el('span', { class: 'u-pips', text: pips }),
        el('span', { class: 'u-hp', text: String(u.hp) })),
      el('div', { class: 'u-hpbar' },
        el('i', { style: 'width:' + Math.max(0, Math.min(100, Math.round(u.hp / stg.hp * 100))) + '%' })),
      frozen ? el('div', { class: 'u-frozen', text: '❄' }) : null,
      el('div', { class: 'u-face' }));
  }

  // ---------------- battle interaction ----------------
  function onSquareTap(x, y) {
    var st = App.state;
    if (!st || st.phase === 'over') return;
    if (st.phase === 'placement') { placementTap(st, x, y); return; }
    if (st.phase !== 'battle') return;
    var inf = App.vm && App.vm.info && App.vm.info[x + ',' + y];
    if (inf && inf.tap) { handleBattleTap(inf.tap); return; }
    if (st.turn.pendingAuras) return;
    if (st.turn.current && canAct()) return; // mid-activation: only marked squares act
    var u = unitAtPos(st, x, y);
    App.sel = u ? { unitId: u.id } : null;
    render();
  }

  function placementTap(st, x, y) {
    if (!canAct()) return;
    var p = st.placement.current;
    var u = unitAtPos(st, x, y);
    if (u && u.owner === p) { App.placeSel = u.lineId; render(); return; }
    var inf = App.vm && App.vm.info && App.vm.info[x + ',' + y];
    if (inf && inf.tap && inf.tap.kind === 'place' && App.placeSel) {
      dispatch({ t: 'place', lineId: App.placeSel, x: x, y: y });
    }
  }

  function curAttack() { return App.sel && App.sel.attack ? App.sel.attack : null; }

  function handleBattleTap(tap) {
    var atk = curAttack();
    switch (tap.kind) {
      case 'move':
        dispatch({ t: 'move', path: tap.path });
        break;
      case 'activateMove':
        if (App.mode === 'guest') {
          // Guest dispatch can't know if the host accepts; stash the move and
          // send it only after the activate's state echo (see setState).
          App.pendingMove = { unitId: tap.unitId, path: tap.path };
          dispatch({ t: 'activate', unitId: tap.unitId });
        } else if (dispatch({ t: 'activate', unitId: tap.unitId })) {
          dispatch({ t: 'move', path: tap.path });
        }
        break;
      case 'basicTarget':
        if (atk) { atk.target = { x: tap.x, y: tap.y }; atk.focus = null; render(); }
        break;
      case 'bombTarget':
        if (atk) { atk.target = { x: tap.x, y: tap.y }; atk.focus = null; render(); }
        break;
      case 'scatterToggle':
        if (atk) {
          var idx = -1;
          for (var i = 0; i < atk.squares.length; i++) {
            if (atk.squares[i].x === tap.x && atk.squares[i].y === tap.y) idx = i;
          }
          if (idx >= 0) atk.squares.splice(idx, 1);
          else {
            var sp = GM.stageOf(App.state.units[App.state.turn.current.unitId]).special;
            if (atk.squares.length >= sp.count) { toast('At most ' + sp.count + ' squares'); return; }
            atk.squares.push({ x: tap.x, y: tap.y });
          }
          atk.focus = null;
          render();
        }
        break;
      case 'grabTarget':
        if (atk) { atk.targetUnit = tap.unitId; atk.relocateTo = null; atk.relocateDecided = false; render(); }
        break;
      case 'relocate':
        if (atk) { atk.relocateTo = { x: tap.x, y: tap.y }; atk.relocateDecided = true; render(); }
        break;
      case 'focus':
        if (atk) { atk.focus = tap.unitId; render(); }
        break;
      case 'lunge':
        if (atk) { atk.lungeTo = { x: tap.x, y: tap.y }; tryConfirmAttack(); }
        break;
      case 'blink':
        if (atk) { atk.blinkTo = { x: tap.x, y: tap.y }; tryConfirmAttack(); }
        break;
    }
  }

  function beginAttack(kind) {
    var st = App.state;
    var cur = st.turn.current;
    if (!cur) return;
    var u = st.units[cur.unitId];
    var sp = GM.stageOf(u).special;
    App.sel = App.sel && App.sel.unitId === cur.unitId ? App.sel : { unitId: cur.unitId };
    App.sel.attack = {
      kind: kind,
      pattern: kind === 'basic' ? 'basic' : sp.pattern,
      dir: null, target: null, squares: [],
      targetUnit: null, relocateTo: null, relocateDecided: false,
      focus: null, lungeTo: undefined, blinkTo: undefined,
      declinedLunge: false, declinedBlink: false,
      stage: 'geo', pv: null,
    };
    render();
  }
  function cancelAttack() {
    if (App.sel) App.sel.attack = null;
    if (App.modal && App.modal.type === 'focus') App.modal = null;
    render();
  }

  function tryConfirmAttack() {
    var st = App.state;
    var cur = st.turn.current;
    var atk = curAttack();
    if (!cur || !atk || !isStaged(atk)) return;
    var pv = GM.previewAttack(st, cur.unitId, buildParams(atk));
    if (!pv.legal) { toast(pv.reason || 'Illegal attack'); render(); return; }
    if (pv.needsFocus && (atk.focus === null || atk.focus === undefined)) {
      App.modal = { type: 'focus', eligible: pv.focusEligible };
      render();
      return;
    }
    atk.pv = pv;
    if (pv.lungeSquares.length && atk.lungeTo === undefined && !atk.declinedLunge) {
      atk.stage = 'lunge'; render(); return;
    }
    if (pv.blinkSquares.length && atk.blinkTo === undefined && !atk.declinedBlink) {
      atk.stage = 'blink'; render(); return;
    }
    var params = buildParams(atk);
    if (App.sel) App.sel.attack = null;
    dispatch(params);
  }

  // ---------------- battle side panel ----------------
  function renderUnitInfo(st) {
    var id = st.turn.current ? st.turn.current.unitId : (App.sel ? App.sel.unitId : null);
    if (id === null || id === undefined || !st.units[id]) {
      return el('div', { class: 'unit-info' }, hint(canAct() ? 'Tap one of your units to inspect / activate it.' : 'Waiting for ' + seatName(st.turn.player) + '…'));
    }
    var u = st.units[id];
    var stg = GM.stageOf(u);
    var line = GM.lineOf(u);
    var eff = u.pos ? GM.effectiveSpeed(st, u.id) : 0;
    var statuses = [];
    if (GM.isPinned(st, u.id)) statuses.push('Pinned (cannot move on its next turn)');
    if (u.rootedTurn > 0) statuses.push('Rooted by Talonlock');
    if (u.burn) statuses.push('Burn ' + u.burn.n + '/tick (' + u.burn.ticks + ' tick' + (u.burn.ticks === 1 ? '' : 's') + ' left)');
    if (u.poison > 0) statuses.push('Poison ' + u.poison + '/3 (3rd stack = instant KO)');
    if (u.chill > 0) statuses.push('Chill ×' + u.chill + ' (Speed −2 each)');
    if (u.pos && GM.isFrozen(st, u.id)) statuses.push('HARD FROZEN — no move/attack; Fire hits ×2');
    if (u.hexTurns > 0) statuses.push('Hexed (+1 from every damage source, ' + u.hexTurns + ' turn' + (u.hexTurns === 1 ? '' : 's') + ')');
    return el('div', { class: 'unit-info p' + u.owner },
      el('div', { class: 'ui-head' },
        el('b', { class: 'ui-name', text: stg.name }),
        el('span', { class: 'team-chip p' + u.owner, text: 'P' + (u.owner + 1) }),
        typeChip(line.type),
        stg.rival ? el('span', { class: 'rival-chip', text: 'RIVAL' }) : null),
      el('div', { class: 'ui-row', text: 'HP ' + u.hp + '/' + stg.hp + ' · Spd ' + eff + (eff !== stg.speed ? ' (base ' + stg.speed + ')' : '') + ' · Basic ' + stg.basic + ' · Stage ' + (u.stage + 1) + '/' + line.stages.length + ' · Facing ' + faceArrow(u.facing) }),
      stg.special ? el('div', { class: 'ui-row special', text: '★ ' + specialText(stg.special) }) : null,
      stg.traits.length ? el('div', { class: 'ui-row', text: stg.traits.map(function (t) { return TRAIT_NAMES[t]; }).join(', ') }) : null,
      stg.aura ? el('div', { class: 'ui-row', text: 'Aura: ' + AURA_NAMES[stg.aura] }) : null,
      stg.evolve ? el('div', { class: 'ui-row muted', text: 'Evolves: ' + evolveText(stg.evolve) + ' (' + evolveProgress(u, stg.evolve) + ')' }) : null,
      statuses.length ? el('div', { class: 'ui-row status', text: statuses.join(' · ') }) : null);
  }

  function renderActions(st) {
    var box = el('div', { class: 'actions' });
    if (st.phase !== 'battle') return box;
    if (!canAct()) return box;
    if (st.turn.pendingAuras) return box;
    var cur = st.turn.current;
    if (!cur) {
      if (App.sel && st.units[App.sel.unitId]) {
        var u0 = st.units[App.sel.unitId];
        if (u0.pos && u0.owner === st.turn.player) {
          if (canActivate(st, u0.id)) {
            var frozen0 = GM.isFrozen(st, u0.id);
            box.appendChild(el('button', {
              class: 'btn primary big' + (frozen0 ? ' warn-btn' : ''),
              onclick: function () { dispatch({ t: 'activate', unitId: u0.id }); },
              text: 'Activate ' + uname(u0) + (frozen0 ? ' (Hard Frozen — wasted!)' : ''),
            }));
          } else {
            box.appendChild(hint(st.turn.activated.indexOf(u0.id) !== -1 ? 'Already activated this turn.'
              : st.turn.activationsUsed >= 3 ? 'No activations left — end the turn.' : ''));
          }
        }
      }
      return box;
    }
    var u = st.units[cur.unitId];
    var atk = curAttack();
    if (!atk) {
      if (!cur.moved) {
        var blocked = moveBlockReason(st, u);
        box.appendChild(hint(blocked ? 'Cannot move: ' + blocked
          : cur.attacked
            ? 'Attack done — tap a highlighted square to move (Speed ' + GM.effectiveSpeed(st, u.id) + '), or end the activation.'
            : 'Tap a highlighted square to move (Speed ' + GM.effectiveSpeed(st, u.id) + '), or attack (move and attack, either order).'));
      }
      if (!cur.attacked) {
        var choices = App.vm.choices || [];
        var basicOk = false, specialOk = false, i;
        for (i = 0; i < choices.length; i++) {
          if (choices[i].kind === 'basic') basicOk = true;
          if (choices[i].kind === 'special') specialOk = true;
        }
        var sp = GM.stageOf(u).special;
        var frozen = GM.isFrozen(st, u.id);
        var row = el('div', { class: 'btn-row' });
        row.appendChild(el('button', {
          class: 'btn', disabled: !basicOk,
          onclick: function () { beginAttack('basic'); },
          text: 'Basic (' + GM.stageOf(u).basic + ' dmg)',
        }));
        row.appendChild(el('button', {
          class: 'btn', disabled: !specialOk,
          onclick: function () { beginAttack('special'); },
          text: sp ? sp.name : 'Special',
        }));
        box.appendChild(row);
        if (!basicOk || !specialOk) {
          var why = [];
          if (!basicOk) why.push('Basic: ' + (frozen ? 'Hard Frozen' : 'no adjacent enemy'));
          if (!specialOk) why.push((sp ? sp.name : 'Special') + ': ' + (!sp ? 'none at this stage' : frozen ? 'Hard Frozen' : 'no legal target'));
          box.appendChild(el('div', { class: 'hint small', text: why.join(' · ') }));
        }
      }
      box.appendChild(el('button', {
        class: 'btn', onclick: function () { dispatch({ t: 'endActivation' }); },
        text: 'End activation',
      }));
      return box;
    }
    // attack staging
    var name = atk.kind === 'basic' ? 'Basic' : GM.stageOf(u).special.name;
    box.appendChild(el('div', { class: 'atk-head' },
      el('b', { text: name }),
      el('button', { class: 'btn small-btn', onclick: cancelAttack, text: 'Cancel' })));
    if (atk.stage === 'lunge') {
      var mand = atk.pv && atk.pv.mandatoryLunge;
      box.appendChild(hint(mand ? 'Talonlock: the Lunge is mandatory — tap a highlighted square.'
        : 'Lunge: tap a highlighted square next to the target, or skip.'));
      if (!mand) box.appendChild(el('button', {
        class: 'btn',
        onclick: function () { atk.declinedLunge = true; tryConfirmAttack(); },
        text: 'Skip lunge',
      }));
      return box;
    }
    if (atk.stage === 'blink') {
      box.appendChild(hint('Blink: tap a highlighted square within 2, or skip.'));
      box.appendChild(el('button', {
        class: 'btn',
        onclick: function () { atk.declinedBlink = true; tryConfirmAttack(); },
        text: 'Skip blink',
      }));
      return box;
    }
    // geometry stage
    if (atk.kind === 'basic') {
      box.appendChild(hint('Tap a highlighted enemy square.'));
    } else if (atk.pattern === 'single' || atk.pattern === 'lance' || atk.pattern === 'cone') {
      box.appendChild(hint('Choose a direction:'));
      var dirRow = el('div', { class: 'btn-row wrap' });
      var seen = {};
      for (var k = 0; k < App.vm.choices.length; k++) {
        var ch = App.vm.choices[k];
        if (ch.kind !== 'special' || !ch.dir) continue;
        var dk = ch.dir.dx + ',' + ch.dir.dy;
        if (seen[dk]) continue;
        seen[dk] = true;
        var names = [];
        for (var m = 0; m < ch.hits.length; m++) names.push(uname(st.units[ch.hits[m]]));
        var active = atk.dir && atk.dir.dx === ch.dir.dx && atk.dir.dy === ch.dir.dy;
        dirRow.appendChild(el('button', {
          class: 'btn dir-btn' + (active ? ' active' : ''),
          onclick: (function (d) { return function () { atk.dir = d; atk.focus = null; render(); }; })(ch.dir),
          text: arrowFor(ch.dir) + ' ' + names.join(', '),
        }));
      }
      box.appendChild(dirRow);
    } else if (atk.pattern === 'bomb') {
      box.appendChild(hint('Tap a highlighted target square (straight line, plus-shaped blast).'));
    } else if (atk.pattern === 'scatter') {
      var spc = GM.stageOf(u).special;
      box.appendChild(hint('Tap up to ' + spc.count + ' squares within range (' + atk.squares.length + ' chosen). At least one must hold an enemy.'));
    } else if (atk.pattern === 'telegrab') {
      if (atk.targetUnit === null) box.appendChild(hint('Tap an enemy unit within range.'));
      else if (!atk.relocateDecided) {
        box.appendChild(hint('Tap a relocation square, or leave it in place.'));
        box.appendChild(el('button', {
          class: 'btn',
          onclick: function () { atk.relocateTo = null; atk.relocateDecided = true; render(); },
          text: 'Leave in place',
        }));
      }
    }
    // preview + confirm
    if (isStaged(atk)) {
      var pv = App.vm.pv;
      if (pv && pv.legal) {
        var parts = [];
        for (var h = 0; h < pv.hits.length; h++) {
          var hu = st.units[pv.hits[h].unitId];
          parts.push(uname(hu) + ' −' + pv.hits[h].dmg);
        }
        box.appendChild(el('div', { class: 'hint', text: parts.length ? 'Hits: ' + parts.join(', ') : 'No hits' }));
        if (pv.needsFocus) box.appendChild(el('div', {
          class: 'hint small',
          text: atk.focus !== null && atk.focus !== undefined
            ? '×2 focus: ' + uname(st.units[atk.focus])
            : 'Super-effective vs several targets — the ×2 focus pick comes next.',
        }));
        else if (pv.focusEligible.length === 1) box.appendChild(el('div', {
          class: 'hint small', text: '★ super-effective ×2 on ' + uname(st.units[pv.focusEligible[0]]),
        }));
        box.appendChild(el('button', { class: 'btn primary big', onclick: tryConfirmAttack, text: 'Confirm attack' }));
      } else if (pv) {
        box.appendChild(el('div', { class: 'hint warn', text: pv.reason || 'Illegal attack' }));
      }
    }
    return box;
  }

  function renderLog(st) {
    var entries = el('div', { class: 'log-entries' });
    // Full log, always (§8: every move, attack, d4 roll, evolution, KO) — the
    // entries are plain strings, cheap to render even for long games.
    for (var i = 0; i < st.log.length; i++) entries.appendChild(el('div', { class: 'log-e', text: st.log[i].msg }));
    return el('div', { class: 'log' }, el('div', { class: 'log-title', text: 'Battle log' }), entries);
  }

  // ---------------- aura prompts ----------------
  function renderAuraPrompt(st) {
    if (st.phase !== 'battle' || !st.turn.pendingAuras) return null;
    if (!canAct()) return null;
    var pend = GM.pendingAuras(st);
    if (!pend.length) return null;
    if (App.auraPick !== null) {
      var still = false;
      for (var i = 0; i < pend.length; i++) if (pend[i].unitId === App.auraPick) still = true;
      if (!still) App.auraPick = null;
    }
    var entry = null;
    if (pend.length === 1) {
      if (!pend[0].needsTarget) return null; // auto-resolved by runAutoSteps
      entry = pend[0];
    } else if (App.auraPick !== null) {
      for (var j = 0; j < pend.length; j++) if (pend[j].unitId === App.auraPick) entry = pend[j];
    }
    if (!entry) {
      return modalShell('End-of-turn auras — choose resolution order',
        pend.map(function (p) {
          return el('button', {
            class: 'btn big block',
            onclick: function () {
              if (p.needsTarget) { App.auraPick = p.unitId; render(); }
              else dispatch({ t: 'aura', unitId: p.unitId });
            },
            text: AURA_NAMES[p.kind] + ' — ' + uname(App.state.units[p.unitId]),
          });
        }), null);
    }
    var u = st.units[entry.unitId];
    return modalShell('Hungry Depths — ' + uname(u) + ' must bite an adjacent unit',
      entry.targets.map(function (tid) {
        var v = st.units[tid];
        var ally = v.owner === u.owner;
        return el('button', {
          class: 'btn big block',
          onclick: function () { App.auraPick = null; dispatch({ t: 'aura', unitId: entry.unitId, target: tid }); },
          text: uname(v) + ' — ' + (ally ? 'ally, heals 3' : 'enemy, heals 2') + ' (HP ' + v.hp + ')',
        });
      }),
      // With several pending auras the order matters: allow backing out to the
      // order prompt (nothing has been dispatched yet, so this is safe).
      pend.length > 1 ? function () { App.auraPick = null; render(); } : null);
  }

  function modalShell(title, kids, onClose) {
    return el('div', { class: 'overlay' },
      el('div', { class: 'modal' },
        el('div', { class: 'modal-head' },
          el('b', { text: title }),
          onClose ? el('button', { class: 'btn small-btn', onclick: onClose, text: '✕' }) : null),
        el('div', { class: 'modal-body' }, kids)));
  }

  // ---------------- modals (rules / evolution / focus) ----------------
  function renderModal() {
    var m = App.modal;
    if (!m) return null;
    if (m.type === 'rules') return renderRules();
    if (m.type === 'evo') {
      return el('div', { class: 'overlay evo-flash' },
        el('div', { class: 'modal evo-modal' },
          el('div', { class: 'evo-spark', text: '✨' }),
          m.items.map(function (it) {
            return el('h2', { class: 'evo-line p' + it.owner, text: it.from + ' evolved into ' + it.to + '!' });
          }),
          el('button', {
            class: 'btn primary big',
            onclick: function () { App.modal = null; render(); },
            text: 'Continue',
          })));
    }
    if (m.type === 'focus') {
      var st = App.state;
      var atk = curAttack();
      if (!atk || !st.turn.current) { App.modal = null; return null; }
      var curUid = st.turn.current.unitId;
      return modalShell('Choose the super-effective ×2 focus',
        m.eligible.map(function (fid) {
          var v = st.units[fid];
          // Preview each candidate WITH that focus: the engine applies the ×2
          // before flat adds (Backstab/Butcher/Glacial Gore/Dread/Hex) and caps
          // doubling at once per hit, so a naive dmg*2 would be wrong.
          var params = buildParams(atk);
          params.focus = fid;
          var pv = GM.previewAttack(st, curUid, params);
          var dmg = null;
          if (pv.legal) {
            for (var i = 0; i < pv.hits.length; i++) if (pv.hits[i].unitId === fid) dmg = pv.hits[i].dmg;
          }
          return el('button', {
            class: 'btn big block',
            onclick: function () { atk.focus = fid; App.modal = null; tryConfirmAttack(); },
            text: uname(v) + ' (HP ' + v.hp + (dmg !== null ? ', would take ' + dmg : '') + ')',
          });
        }),
        function () { App.modal = null; render(); });
    }
    return null;
  }

  function renderRules() {
    var chartRows = [el('tr', {}, el('th', { text: 'Attacker' }), el('th', { text: '×2 vs (focus only)' }))];
    var types = Object.keys(GM_DATA.typeChart);
    for (var i = 0; i < types.length; i++) {
      var beats = GM_DATA.typeChart[types[i]];
      chartRows.push(el('tr', {},
        el('td', {}, typeChip(types[i])),
        el('td', {}, beats.length ? beats.map(typeChip) : el('span', { class: 'muted', text: '—' }))));
    }
    var patterns =
      'Single R   A > . . X      stops at the FIRST unit in line within R;\n' +
      '                          an ally body blocks the shot entirely\n' +
      'Lance R    A > x x x      hits EVERY enemy within R; pierces all\n' +
      'Cone       x x x          pick a cardinal direction; near square\n' +
      '             x            + the 3 squares beyond it (4 total)\n' +
      '             A\n' +
      'Burst      x x x\n' +
      '           x A x          all 8 adjacent squares\n' +
      '           x x x\n' +
      'Bomb R       x            lob at a square up to R away in a straight\n' +
      '           x X x          line (ignores units in between);\n' +
      '             x            hits the target + 4 orthogonal neighbours\n' +
      'Scatter    R, N           pick up to N squares within Manhattan R\n' +
      'Telegrab   grab an enemy within R (any path), relocate it up to k\n' +
      '           squares, then Telesmash: dmg = lifetime grabs (max 3)';
    var effects = [
      'Push 1 — shove 1 square away; cancelled if blocked/off-board.',
      'Pin — cannot MOVE during its controller’s next turn (attacking is fine); clears at that turn’s end.',
      'Burn N — N damage at the start of each of its controller’s next 2 turns; doesn’t stack, reapply resets (higher N wins).',
      'Poison — no damage; 3rd stack ever = instant KO. Stacks never expire and are shared across poisoners.',
      'Chill — −2 Speed per stack on its next turn; at Speed 0 it is HARD FROZEN (no move/attack, Fire hits ×2). Stacks clear at that turn’s end.',
      'Hex — +1 damage from EVERY damage source during its next 2 turns.',
      'Lure — pull the target 1 square closer, then Hex it.',
      'Riders — Recoil N: attacker takes N after resolving (can self-KO). Lunge: may move next to the target after the hit. Blink 2: may teleport within 2.',
    ];
    var dmgRules = [
      'Super-effective = ×2 on at most ONE hit unit per attack (the focus). A hit is doubled at most once, ever (×2 cap, never ×4).',
      'Flat bonuses (Backstab +2, Butcher +2, Glacial Gore +1/Chill) add AFTER doubling.',
      'Dread Presence: adjacent enemies deal −1 (min 1). Hex: victim takes +1.',
      'FRIENDLY FIRE IS OFF — attacks only ever damage enemies (auras keep their stated friend-or-foe behaviour).',
    ];
    var traitList = Object.keys(TRAIT_NAMES).map(function (t) {
      return el('li', {}, el('b', { text: TRAIT_NAMES[t] + ': ' }), TRAIT_TEXT[t]);
    });
    var auraList = Object.keys(AURA_NAMES).map(function (a) {
      return el('li', {}, el('b', { text: AURA_NAMES[a] + ': ' }), AURA_TEXT[a]);
    });
    return modalShell('Rules reference', [
      el('h3', { text: 'Turn structure' }),
      el('p', { class: 'small', text: 'Start of turn: evolutions → burn ticks → enemy Earthquake, then enemy Dread Presence Chill. Then up to 3 different units activate (one move and one attack, both optional, in either order). End of turn: your Local Storm / Hungry Depths auras resolve (you pick the order). KO all 6 enemy units to win.' }),
      el('h3', { text: 'Type chart' }),
      el('table', { class: 'type-table' }, chartRows),
      el('h3', { text: 'Attack patterns' }),
      el('pre', { class: 'pattern-pre', text: patterns }),
      el('h3', { text: 'Effects & riders' }),
      el('ul', { class: 'rules-list' }, effects.map(function (t) { return el('li', { text: t }); })),
      el('h3', { text: 'Damage rules' }),
      el('ul', { class: 'rules-list' }, dmgRules.map(function (t) { return el('li', { text: t }); })),
      el('h3', { text: 'Traits' }),
      el('ul', { class: 'rules-list' }, traitList),
      el('h3', { text: 'Auras (final forms, always on)' }),
      el('ul', { class: 'rules-list' }, auraList),
      el('h3', { text: 'Movement & facing' }),
      el('p', { class: 'small', text: 'Move up to Speed squares, one orthogonal step at a time; ALL units block movement (Skulk passes through). Facing = direction of the last step; the 3 squares behind a unit are its rear (Backstab). Teleports and pushes don’t change facing.' }),
      el('h3', { text: 'Evolution' }),
      el('p', { class: 'small', text: 'Conditions per card (survive turns / deal damage / KO / ally KO’d). A unit evolves at the start of its controller’s next turn: new max HP, +2 current HP (capped), new Speed/Special/Aura.' }),
    ], function () { App.modal = null; render(); });
  }

  // ---------------- win screen ----------------
  function renderWinOverlay(st) {
    var w = st.winner;
    var title = App.mySeat === null ? 'Player ' + (w + 1) + ' wins!' : (w === App.mySeat ? 'You win!' : 'Opponent wins!');
    return el('div', { class: 'overlay win-overlay' },
      el('div', { class: 'modal win-box p' + w },
        el('h2', { text: title }),
        el('p', { class: 'muted', text: 'Seed ' + st.seed }),
        el('button', {
          class: 'btn primary big block',
          onclick: function () {
            // Either player may rematch (CONTRACT). The guest sends placeholder
            // randomness; the host's onIntent re-seeds it (SPEC §1.5: the guest
            // never rolls anything).
            dispatch(App.mode === 'guest'
              ? { t: 'rematch', seed: 0, coinWinner: 0 }
              : { t: 'rematch', seed: randSeed(), coinWinner: randCoin() });
          },
          text: 'Rematch',
        }),
        el('button', { class: 'btn big block', onclick: function () { location.reload(); }, text: 'Exit to menu' })));
  }

  // ---------------- init ----------------
  function init() {
    App.ready = true;
    render();
  }

  return { init: init };
})();
