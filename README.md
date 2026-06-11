# Grid Monsters — v8 digital beta

A 2-player, turn-based tactics game on an 8×8 grid. Draft a team of six evolving
monsters (exactly one tyrant each), place them, and eliminate the enemy team.
Faithful digitization of tabletop Playtest #8 for human-vs-human beta testing
(v7 handoff in SPEC.md as amended by PATCH-V8.md).

Plain HTML/CSS/JS, no build step. The only external dependency is
[PeerJS](https://peerjs.com) (CDN) for remote play.

## Play

- **Hosted:** https://azraf3641-art.github.io/grid-monsters/
- **Local hotseat:** open `index.html` in a browser — both players share one
  screen. (Remote play is disabled on `file://`; it needs the HTTPS page.)

## Remote play

1. One player clicks **Remote game → Host** and gets a room code like `gm-x7k2q`.
2. The other clicks **Join** and enters the code. Game data then flows
   browser-to-browser; only the initial handshake uses the free PeerJS Cloud
   signaling server.

The host's browser runs the authoritative game; the guest sends moves to it.
The Earthquake die and the draft coin flip are rolled by the host and synced,
so both screens always show the same rolls.

**Disconnects:** a banner shows the room code and a "copy game state" button.
The guest can rejoin with the same code and play resumes where it left off.

**Known limitation — some networks can't connect.** A small percentage of
restrictive networks (symmetric NAT, e.g. some corporate/university Wi-Fi and
carrier hotspots) cannot establish a direct peer-to-peer link without a TURN
relay server, which this beta does not run. If hosting/joining fails on both
ends: fall back to a local hotseat game over a screen-share call.

## Deploying to GitHub Pages

The repo ships a workflow (`.github/workflows/pages.yml`) that publishes the
site on every push to `main`: in the repo go to **Settings → Pages** and set
**Source: GitHub Actions** once. Any other static host works too — there is
nothing to build; serve the repo root.

## Development

- `node test.js` — full engine test suite, no framework needed.
- `engine.js` — pure, serializable game engine (state in → state out).
  `data.js` — every creature/move/type number lives here and nowhere else
  (this file will later seed a Godot build). `ui.js` — rendering + input.
  `net.js` — PeerJS host/guest layer.
- `SPEC.md` is the rules authority. `CONTRACT.md` documents the engine API and
  the pinned interpretation rulings (DEV-PINS). `RECONCILE_NOTES.md` logs
  build-time rules decisions.
- The Earthquake d4 is the game's only randomness: a seeded generator
  (mulberry32). The seed is visible in-game and settable for local games, so
  games can be reproduced.

## License

Copyright © 2026 Azraf Anwar. All rights reserved — playing the hosted game is
welcome; copying, modifying, or redistributing the code, names, or game content
is not. See [LICENSE](LICENSE).
