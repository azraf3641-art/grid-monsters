'use strict';
/* Grid Monsters — remote play (PeerJS, host-authoritative full-state sync).
   Protocol (CONTRACT.md):
     guest → host : {kind:'hello'}                      on connection open
     host  → guest: {kind:'welcome', seat:1}            assigns the guest seat 1
     guest → host : {kind:'intent', player:1, action}   every guest action
     host  → guest: {kind:'state', state}               after EVERY successful action
     host  → guest: {kind:'error', msg}                 invalid intent (no crash)
   The host runs the one true engine instance (in ui.js); the guest renders
   received state only. Math.random is allowed here (never in engine.js). */

var NET = (function () {
  var peer = null, conn = null, role = null, code = '', hooks = {};
  var ALPHA = 'abcdefghijklmnopqrstuvwxyz0123456789';

  function randCode() {
    var s = 'gm-';
    for (var i = 0; i < 5; i++) s += ALPHA.charAt(Math.floor(Math.random() * ALPHA.length));
    return s;
  }

  function peerErrMsg(e) {
    var t = e && e.type;
    if (t === 'peer-unavailable') return 'Room not found — check the code (the host must be waiting).';
    if (t === 'unavailable-id') return 'Room code collision — go back and host again.';
    if (t === 'network') return 'Lost contact with the signaling server — retrying…';
    if (t === 'browser-incompatible') return 'This browser does not support WebRTC.';
    return 'Connection error: ' + ((e && e.message) || t || 'unknown');
  }

  // Drop any previous peer (and its listeners/connections) so host/join/rejoin
  // are idempotent: each (re)start owns exactly one peer with one handler set.
  function teardown() {
    var old = peer;
    peer = null; conn = null;   // null conn first so old handlers' conn===c guards no-op
    if (old) { try { old.destroy(); } catch (e) { /* noop */ } }
  }

  // ---------------- host ----------------
  function host(h) {
    teardown();
    hooks = h; role = 'host'; code = randCode();
    peer = new Peer(code);
    peer.on('open', function () { if (hooks.onOpen) hooks.onOpen(code); });
    peer.on('connection', function (c) {
      // Single guest; a new connection replaces the old. Unconditional on
      // purpose: a killed guest tab's conn may not have fired 'close' yet, and
      // gating on it would block the SPEC §1.5 rejoin flow. Known beta-grade
      // tradeoff (documented): anyone who learns the room code could take over
      // seat 1 mid-game — acceptable for the friends beta, no auth planned.
      if (conn && conn.open && conn !== c) { try { conn.close(); } catch (e) { /* noop */ } }
      conn = c;
      c.on('data', function (m) { hostData(c, m); });
      c.on('close', function () { if (conn === c && hooks.onDown) hooks.onDown(); });
      c.on('error', function () { if (conn === c && hooks.onDown) hooks.onDown(); });
    });
    peer.on('disconnected', function () { try { peer.reconnect(); } catch (e) { /* noop */ } });
    peer.on('error', function (e) { if (hooks.onError) hooks.onError(peerErrMsg(e)); });
  }

  function hostData(c, m) {
    if (c !== conn) return;   // stale/replaced connection: never act on it
    if (!m || typeof m !== 'object') return;
    if (m.kind === 'hello') {
      c.send({ kind: 'welcome', seat: 1 });
      // onGuestJoined creates the game on first join (host generates seed +
      // coin flip) and returns the current state; re-broadcast it on rejoin.
      var st = hooks.onGuestJoined ? hooks.onGuestJoined() : null;
      if (st) c.send({ kind: 'state', state: st });
    } else if (m.kind === 'intent') {
      var r;
      try {
        // Trust boundary: the guest connection IS seat 1 by protocol — pin it,
        // never the wire-supplied m.player (a tampered guest could send 0 and
        // act as the host's seat).
        r = hooks.onIntent ? hooks.onIntent(1, m.action) : { ok: false, msg: 'no handler' };
      } catch (e) {
        r = { ok: false, msg: e.message };
      }
      if (r && !r.ok) c.send({ kind: 'error', msg: r.msg || 'illegal action' });
      // on success ui.js already called NET.broadcastState with the new state
    }
  }

  // ---------------- guest ----------------
  function join(c0, h) {
    hooks = h; role = 'guest'; code = c0;
    freshGuestPeer();
  }

  function freshGuestPeer() {
    teardown();
    peer = new Peer();
    // PeerJS re-emits 'open' after every reconnect(): only dial the host when
    // no healthy DataConnection exists (a signaling blip must not churn it).
    peer.on('open', function () { if (!conn || !conn.open) connectToHost(); });
    peer.on('disconnected', function () { try { peer.reconnect(); } catch (e) { /* noop */ } });
    peer.on('error', function (e) { if (hooks.onError) hooks.onError(peerErrMsg(e)); });
  }

  function connectToHost() {
    var c = peer.connect(code, { reliable: true });
    conn = c;
    c.on('open', function () { c.send({ kind: 'hello' }); });
    c.on('data', function (m) {
      if (!m || typeof m !== 'object') return;
      if (m.kind === 'welcome') { if (hooks.onWelcome) hooks.onWelcome(m.seat); }
      else if (m.kind === 'state') { if (hooks.onState) hooks.onState(m.state); }
      else if (m.kind === 'error') { if (hooks.onError) hooks.onError(m.msg); }
    });
    c.on('close', function () { if (conn === c && hooks.onDown) hooks.onDown(); });
    c.on('error', function () { if (conn === c && hooks.onDown) hooks.onDown(); });
  }

  // Guest reconnects to the same room code; the host re-broadcasts on hello.
  // Always rebuilds the peer from scratch — repeated rejoins each own exactly
  // one peer / one 'open' handler (no listener accumulation, no parallel conns).
  function rejoin() {
    if (role !== 'guest') return;
    freshGuestPeer();
  }

  // ---------------- send ----------------
  function sendIntent(action) {
    if (conn && conn.open) conn.send({ kind: 'intent', player: 1, action: action });
    else if (hooks.onError) hooks.onError('Not connected — action not sent. Rejoin and retry.');
  }
  function broadcastState(state) {
    if (conn && conn.open) conn.send({ kind: 'state', state: state });
  }
  function roomCode() { return code; }

  return { host: host, join: join, rejoin: rejoin, sendIntent: sendIntent, broadcastState: broadcastState, roomCode: roomCode };
})();
