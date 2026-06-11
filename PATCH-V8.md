# PATCH — Grid Monsters v7 → v8 (apply to the existing build)

You are patching a working build. Change ONLY what's listed here. Do not refactor, rebalance, or touch any rule not named below. If anything in the existing code contradicts this patch in a way not covered, STOP and ask.

## 1 · Free activation order (rule change)
- An activated unit gets one move (optional) and one attack (optional) **in either order**: move→attack OR attack→move. Still max one of each, still ≤3 distinct units per turn.
- **Root-timing ruling (pinned):** if a unit's attack triggers Peregale's Talonlock self-root or Butcherbeak's thorn-root (see §2), the root applies **immediately** and any unused move in the current activation is **forfeited**.
- UI: the activation panel must offer both orders (e.g. Move / Attack buttons both enabled until each is spent).

## 2 · Butcherbeak update (skip any part already applied)
- Butcherbeak gains **Skulk**: its movement passes through other units (friend or foe); cannot end on an occupied square. (Skulk roster is now Duskpard, Pantherebus, Butcherbeak.)
- **Thorn-root (mirrors Talonlock):** when Impale's Pin lands, Butcherbeak is rooted — cannot move during its controller's next turn (may still attack; Impale usable while rooted); clears at that turn's end. No forced lunge (Impale is melee). Plus the immediate-root/forfeit ruling in §1.

## 3 · HP patch (every unit; max HP per stage)
Bases: all **5**, except Guppling **4** and Zapkitt **4**. Tavrik (sole stage): **8**.
Middles: Flarewyrm 6, Shellbrook 8, Thornhide 8, Joltlynx 6, Stonehide 8, Galewyrm 7, Parliowl 6, Duskpard 6, Rimestag 8, Frostursa 8.
Finals: Pyroclasm 9, Hellhowl 11, Bulwhark 14, Leviadon 13, Grovewarden 14, Bombloom 11, Fulgurlynx 9, Dynamoth 10, Terradon 14, Ossiyena 10, Tempestdrake 13, Peregale 10, Archistrix 9, Velvesper 10, Pantherebus 9, Mawlantern 12, Gravewinter 15, Maulberg 13, Floefang 10, Galvaquill 12, Servenom 9, Pumarok 10, Butcherbeak 9.
These replace the old values in `data.js` only — no damage numbers change.

## 4 · Evolution refresh (rule change)
- Replace "+2 current HP, capped" with: on evolving, **heal half of the unit's missing HP, rounded up**, where missing HP is measured against the NEW stage's max; cap at new max. (Example: Shellbrook at 2/8 → Bulwhark 14: heals ceil((14−2)/2)=6 → 8/14.)

## 5 · Version
- Display/version strings: v8 / "Playtest #8".

## 6 · Tests to add or update (node test.js)
- Attack-then-move legality and move-then-attack equivalence; a unit cannot move twice or attack twice.
- Landing Stoop Strike's pin or Impale's pin with the move still unspent → move is forfeited (root immediate).
- Butcherbeak pathing through bodies (Skulk); thorn-root timing (rooted next turn, attacks allowed, clears at end).
- All 57 max-HP values match §3 exactly (assert against data.js).
- Evolve refresh: ceil(missing/2), capped; full-HP unit stays full; the 2/8→8/14 example.

## 7 · Acceptance (manual, after tests pass)
- Pyroclasm fires Magma Stream then retreats 6 squares in the same activation.
- Peregale pins with its move unspent and cannot then walk away.
- A 2/8 Shellbrook evolves to an 8/14 Bulwhark.
- Gravewinter card reads HP 15; Tavrik reads HP 8.

Out of scope: everything else. No new units, no damage changes, no UI redesign.
