# ENG HANDOFF — Grid Monsters v7 Digital Beta (Claude Code)

> **AMENDMENTS (owner-authorized, post-acceptance).** 2026-06-10, after the
> full §10 manual acceptance pass: **free activation order** — an activated
> unit gets one optional move AND one optional attack in EITHER order
> (supersedes §1 "(a) move (optional), (b) attack (optional)" and §3
> "after moving"; see CONTRACT.md DEV-PIN 24). Original handoff text below
> is otherwise unmodified.
>
> **PATCH-V8 (PM, 2026-06-10 — see PATCH-V8.md for the full text):** v7 → v8
> "Playtest #8". Immediate-root/move-forfeit ruling; Butcherbeak gains Skulk
> + Thorn-root; all 57 max-HP values replaced (PATCH-V8 §3 supersedes the §6
> table's HP column); evolution refresh becomes heal-ceil(missing/2)-capped
> (supersedes §4 "+2 current HP"). CONTRACT.md DEV-PINS 25–26.

You are the Eng instance for this build. This prompt is fully self-contained: everything you need is in this document. Do not invent rules; where this spec pins a ruling, implement it exactly. If you hit genuine ambiguity not covered here, STOP and ask rather than assuming.

## What you are building

**Grid Monsters** — a 2-player, turn-based tactics game on an 8×8 grid, playable in a browser, in two modes: **local hotseat** (one screen) and **remote** (two desktops, peer-to-peer via room code). Players draft teams of evolving monsters and fight to eliminate the enemy team. Combat is deterministic except for one effect (Earthquake) that uses a d4.

**Stack (fixed):** plain HTML + CSS + vanilla JavaScript. No frameworks, no build step, no server of our own. **Exactly one external dependency is permitted: PeerJS** (via CDN `<script>` tag) for remote play — it uses the free PeerJS Cloud signaling server; game data flows browser-to-browser and never touches a server. Everything else is hand-rolled. Must be hostable as a static page (GitHub Pages) and playable on a phone screen. Note: remote mode requires the page to be served over HTTPS (GitHub Pages provides this); opening the file locally supports hotseat only.

**Architecture requirement:** all creature/move/type data lives in a single data structure (`data.js` or an embedded JSON object) — the engine reads it; no creature stats hard-coded in logic. This data file will later seed a Godot build, so keep it cleanly serializable.

---

## 1 · Game structure

1. **Draft** → 2. **Placement** → 3. **Battle** → 4. **Win screen** (with rematch).

### Draft
- All 24 lines (§6) shown as cards with full stats.
- Coin flip (animated or instant). **Tyrant phase first:** the winner picks one of the three Tyrant lines (Cinderling, Wyrmlet, Frostfawn), then the loser picks one of the remaining two; the third tyrant is **cut** (undraftable). Every team fields exactly one tyrant.
- **Snake draft** of the remaining 21 lines, **starting with the flip loser**: L W W L L W W L L W (5 more lines each). Six lines each total; **twelve of the twenty-four sit out every game** (eleven non-tyrants + the cut tyrant).
- **Rivals rule (enforce structurally):** one tyrant per team, every team has one — the tyrant phase guarantees both. The Rival keyword sits on the three final forms: **Pyroclasm, Tempestdrake, Gravewinter**.

### Placement
- Each player (P1 first), in turn, places their 6 units — all in **base form** — on any empty squares of their own **back two rows** (P1 rows 1–2, P2 rows 7–8). Show remaining units; allow repositioning before confirming.

### Battle — turn loop
- Players alternate turns, P1 first.
- **Start of turn (in this order):**
  1. Resolve **evolutions** for the active player's units whose condition is met (§4).
  2. Resolve **Burn ticks** on the active player's units (§3).
  3. Resolve enemy **Earthquake** aura(s) and enemy **Dread Presence** Chill (each active-player unit adjacent to an enemy Gravewinter gains 1 Chill stack) (§5).
- **Activations:** the active player activates **up to 3 different units**, one at a time. A unit cannot be activated twice in one turn. Each activated unit, in order: **(a) move** (optional), **(b) attack** (optional). Fewer than 3 activations is legal (including zero). If fewer than 3 units remain, only those may activate.
- **End of turn (in this order, active player chooses order among ties):** resolve the active player's end-of-turn auras (**Local Storm**, **Hungry Depths**) for each of their qualifying units.
- Turn passes.

### Winning
- A player wins immediately when all 6 enemy units are KO'd.
- **Simultaneity rule (pinned):** if an effect KOs the last units of both sides at once, the player whose effect was resolving wins.

---

## 1.5 · Remote play (pinned architecture)

- **Main menu offers:** "Local game" (hotseat, both players one screen) and "Remote game" → **Host** / **Join**.
- **Host:** creates a PeerJS peer with a short human-friendly ID (e.g. `gm-` + 5 random alphanumerics), displays it as the **room code** with a copy button, and waits. **Join:** enter the code, connect.
- **Host-authoritative, full-state sync:** the host runs the one true engine instance. The guest is a thin client that sends **intents** (draft pick, placement, activation = unit + move path + attack choice + focus pick, Hungry Depths target, end turn) and renders state. After validating and applying any action — from either player — the host broadcasts the **entire serialized game state**. Full-state sync, not deltas: the state is tiny and this makes desync impossible.
- The engine must therefore be fully serializable to JSON (`engine.js` already pure — keep it that way) and the UI a pure function of state + "whose seat am I".
- **Randomness:** the host generates the Earthquake RNG seed and the draft coin flip; both live in the synced state. The guest never rolls anything.
- **Seat privacy:** there is no hidden information in this game (open draft, open board), so no masking is needed — both clients may hold full state.
- **Disconnects (beta-grade):** on connection loss, show a banner with the room code and a "copy game state" button (JSON export). The guest may rejoin the same room code; on reconnect the host re-broadcasts state and play resumes. No further resilience — this is a friends beta.
- **Known limitation (document in README, do not solve):** a small percentage of restrictive networks (symmetric NAT) cannot establish a P2P connection without a TURN relay, which we are not running. The documented fallback for affected testers is local hotseat over a screen-share call.

---

## 2 · Movement

- Every unit has a **Speed** (per card). On activation it may move up to Speed squares, **orthogonally only**, one square per step.
- **All units block movement** — a path may not pass through ANY unit, friend or foe. A unit may not end on an occupied square.
- Implement reachable squares via BFS over empty squares within Speed steps. Highlight reachable squares on selection. Moving is optional; a unit may move 0 squares.
- **Facing:** every unit has a facing — one of the 4 orthogonal directions, set to the direction of the final step of its last move (default: toward the enemy back rank for units that have never moved). A unit's **rear** is the 3 squares on the side opposite its facing. Teleports (Blink, Telegrab, Lunge) do not change facing.

---

## 3 · Combat

### Attacks
Each unit always has its **Basic**; evolved forms may also have a **Special** (per card). An activated unit may use at most one attack, after moving.

- **Basic:** choose one of the **8 adjacent squares**; if an enemy unit is there, deal the Basic damage (2, except Guppling 1). Basics may only target enemies.
- **Special:** per its pattern (below). Patterns hit squares, but **FRIENDLY FIRE IS OFF: attacks damage ENEMY units only.** Allied units standing on hit squares are unaffected. (Auras are the exception and keep their stated friend-or-foe behavior.)

### Patterns (pinned geometry)
| Pattern | Definition |
|---|---|
| **Single (R)** | Choose one of the **8 directions**. The projectile stops at the **first unit** (either side) along that straight path within R squares. If that unit is an **enemy**, it is hit; if it is an **ally**, the shot is blocked — no damage, and that direction is an illegal choice. |
| **Lance (R)** | Choose one of the **8 directions**. Hits **every ENEMY unit** in the first R squares along that path — pierces everything, blocked by nothing; allies along the path are passed over harmlessly. |
| **Cone** | Choose one of the **4 orthogonal facings**. Hits the adjacent square in that facing **plus all 3 squares in the row beyond it** (a filled triangle, 4 squares). |
| **Burst** | Hits **all 8 squares** adjacent to the attacker. |
| **Bomb (R)** | Choose a target square up to R squares away **in a straight line (8 directions)** — the lob ignores intervening units. Hits the target square plus its **4 orthogonal neighbors**. |
| **Scatter (R, N)** | Choose up to **N distinct squares** within **Manhattan distance R**. Hits each chosen square. |

### Damage resolution (per attack)
1. Determine hit squares and the units on them.
2. **Super-effective focus (×2):** double damage applies to **at most ONE unit per attack**. **Global cap (pinned): a hit's damage is doubled at most once** — if multiple doublings apply (super-effective + Talonlock), the hit is ×2, never ×4:
   - **Basic / Single:** its single target — doubled iff attacker's type beats the target's type (chart §7).
   - **Lance:** only the **first unit hit** (nearest the attacker) is focus-eligible.
   - **Cone / Burst / Bomb / Scatter:** the attacker **picks one hit unit** as the focus (UI: prompt the pick whenever more than one hit unit could be doubled; auto-resolve when zero or one).
   - With friendly fire off, only enemies are ever hit, so the focus is always an enemy.
3. Apply damage simultaneously to all hit **enemy** units; a unit at **0 HP is KO'd** and removed.
4. Apply the Special's **effect** (if any) to hit units, then its **rider/cost**.

### Effects (a Special has at most one)
- **Push 1:** hit unit is shoved 1 square directly away from the attacker; **cancelled** if the destination is occupied or off-board. (Bomb/Scatter have no Push in this kit; Burst pushes each hit unit away from the attacker.)
- **Pin:** the hit unit **cannot move during its controller's next turn** (it may still attack if activated). Clears at the end of that turn, whether or not the unit was activated. **Seed Mortar exception (pinned):** its Pin applies only to the unit on the chosen **center** square.
- **Burn N:** the unit takes **N damage at the start of each of its controller's next 2 turns** (step 2 of start-of-turn; ticks whether or not the unit is activated). Does not stack; reapplying resets the tick counter to 2 and the per-tick value to the higher N. In this kit: **Magma Stream applies Burn 2** (2/tick, 4 total); **Scorching Howl applies Burn 1** (1/tick, 2 total), and **only to the unit occupying the cone's near square** (the single adjacent square at the cone's tip) — if that square is empty or holds an ally, no burn is applied.
- **Poison (execute counters):** Poison deals **no damage**. Each application adds **1 stack** to the hit unit (applied during attack resolution, after damage). A unit that receives its **3rd stack is instantly KO'd**, regardless of remaining HP. Stacks never expire and cannot be removed. The KO credits the unit that applied the 3rd stack.
- **Chill (stacking slow):** each stack reduces the unit's Speed by **2** on its next turn. Stacks clear at the end of that turn. If effective Speed reaches **0**, the unit is **Hard Frozen** that turn: it cannot move or attack, and it takes **double damage from Fire-type attacks** that turn (a doubling source — the global ×2 cap applies). NOTE: base forms (Speed 2) Hard Freeze from a single stack — intended.
- **Glacial Gore bonus (Gravewinter only):** Glacial Gore deals **+1 damage per Chill stack already on each target it hits**, counted **before** its new stack is applied, added **after any doubling** (same slot as Backstab's +2).
- **Hex (mark):** the unit takes **+1 damage from every damage source** (attacks AND Burn ticks; not Poison, which deals no damage) during its **next 2 turns**. Doesn't stack; reapplying resets duration.
- **Lure (compound, Mawlantern only):** pull the target **1 square directly toward the attacker** (cancelled if the square is occupied or off-board), then apply **Hex**.

### Riders / costs (may accompany an effect)
- **Recoil N:** after the attack fully resolves, the attacker takes N damage. **Recoil can KO the attacker**, and still applies even if the attack KO'd its targets.
- **Lunge (optional):** after the attack resolves, the attacker **may** move to any empty square adjacent (8-adj) to the target's **final** position; if the target was KO'd, the attacker may instead take its square. (For multi-hit patterns with Lunge — none exist in this kit; Lunge appears only on Singles.)
- **Blink 2 (optional rider, Velvesper):** after the attack resolves, the attacker may teleport to any **empty square within 2** (Chebyshev), ignoring blockers.

### Unit trait — Talonlock (Peregale only)
- **Forced lock:** when Stoop Strike's Pin lands on a unit, Peregale's Lunge becomes **mandatory**: it must move to an empty square 8-adjacent to the pinned target. If no such square exists/is legal, it stays put and the root below does not apply.
- **Self-root:** having locked adjacent, Peregale is **rooted** — it cannot move during its controller's next turn (it may still attack); clears at that turn's end, exactly like Pin.
- **Predator:** Peregale's attacks (Basic and Stoop Strike) deal **double damage to any Pinned unit** — including units pinned by Stormbolt or Seed Mortar. Subject to the global ×2 cap above.
- **Override:** Stoop Strike, **including its lunge/lock movement**, may be used while Peregale is pinned or rooted; Pin/root block normal movement only, never Stoop Strike's built-in movement.

### Special mechanic — Telegrab / Telesmash (Hootle line)
- **Telegrab** targets one enemy unit within **3 squares** (any direction; not blocked by units). Relocate it up to **2 squares** to any empty square (the controller of Archistrix chooses; relocation ignores blockers but must end on an empty square). Then **Telesmash**: deal damage equal to that victim's **lifetime Telegrab count** — 1st grab 1, 2nd grab 2, 3rd+ grab 3 (cap). Counters persist for the whole game and survive evolution.
- The relocation is not Push — blocked-square rules don't cancel it; the controller simply must pick a legal empty destination (if none exists within 2, the unit stays but Telesmash still resolves).
- The **weakened middle version** (Parliowl): range 2, relocate 1 square, **no Telesmash damage**.
- Telegrab may target tyrants (it is not a Rival special, so Tavrik can also be grabbed). Telesmash damage is Psychic-typed (super-effective vs nothing currently).

### Unit traits — Skulk and Backstab (Shadekit line)
- **Skulk (Duskpard and Pantherebus):** this unit's movement may pass **through** other units (friend or foe); it still cannot end on an occupied square. Its body still blocks everyone else normally.
- **Backstab (Pantherebus only):** its attacks deal **+2 flat damage, added after any doubling**, when EITHER trigger holds: (a) the attacker occupies one of the defender's **3 rear squares** (see Facing, §2), or (b) **flanking** — the defender is adjacent (8-adj) to at least one other unit allied with the attacker.

### Unit trait — Static Quills (Galvaquill only)
- Any enemy that **damages Galvaquill with an attack made from an adjacent square** (Basic or Special, melee-range delivery) takes **1 damage after that attack fully resolves**. Triggers once per attack, not per point of damage. Does not trigger on Burn/Poison ticks or auras.

### Unit trait — Butcher (Butcherbeak only)
- Butcherbeak's attacks (Basic and Impale) deal **+2 flat damage, added after any doubling, to Pinned units**. Stacks with the Pin it applies itself only on a LATER attack (Impale's own Pin lands after its damage). Designed concert: Butcherbeak pins → Peregale's Talonlock doubles vs that unit; Peregale pins → Butcherbeak's Butcher +2 applies.

### Unit trait — Tyrantbane (Tavrik only)
All clauses key off the **Rival keyword**, carried only by the final forms **Pyroclasm, Tempestdrake, and Gravewinter** — pre-evolutions are ordinary targets for every clause below. (Note: with the tyrant-phase draft, an enemy tyrant line is in every game, so Blood Scent and the immunity always have a live payoff.)
- **Tyrant-proof:** Tavrik is unaffected by Rival units' **Specials and Auras**, regardless of side — no damage, no effects, no Burn. A tyrant's Lance still passes through Tavrik and hits units beyond it (immune, not a wall). A **friendly** Tempestdrake's Local Storm also doesn't harm Tavrik. Rival units' **Basics affect Tavrik normally.** (Non-rival auras — Earthquake, Hungry Depths — affect it normally.)
- **Close kill:** Tavrik's attacks (Basic and Napebite) affect a Rival unit **only from an adjacent square (8-adj)**, where they deal **double damage** (global ×2 cap applies). A Rival unit at Napebite's range 2 is an **illegal target** — the attack cannot be declared at it, not "hits for zero."
- **Blood Scent:** while at least one **enemy** Rival-keyword unit (i.e., final form) is on the board, Tavrik's Speed is **6** instead of 4. It reverts to 4 immediately when no enemy Rival unit remains. A friendly tyrant does not trigger it.

### Damage attribution (pinned, feeds evolution §4)
- Attack damage (including the ×2 bonus) credits the attacker.
- **Burn ticks credit the unit that applied the Burn** (even though they resolve at the victim's turn start); a Burn-tick KO counts as that unit's KO. A Poison-execute KO credits the unit that applied the 3rd stack. Poison stacks are **shared across sources** (Ossiyena and Servenom both stack the same counter on a victim).
- Recoil, aura damage, and Hungry Depths self-damage credit no one.

---

## 4 · Evolution

- Each line lists conditions per stage (§6). Conditions are tracked continuously:
  - **"Survived N turns":** count of the controller's **own turns completed** since the unit entered play (whether or not it was activated; cumulative across stages).
  - **"Dealt N damage":** cumulative damage credited to the unit (§3 attribution; cumulative across stages).
  - **"KO an enemy":** the unit is credited with an enemy KO.
  - **"An allied unit is KO'd":** any friendly unit (other than itself) is KO'd while this unit is in play.
- When a condition is met, the unit evolves **at the start of its controller's next turn** (step 1 of start-of-turn), one stage at a time:
  1. Max HP becomes the new stage's value.
  2. **Refresh: +2 current HP, capped at the new max** (never a full heal).
  3. New Speed and (if final) its Special and Aura take effect immediately.
- Evolution is permanent. Pin/Burn markers persist through evolution.

---

## 5 · Auras (always on, final forms only)

- **Local Storm (Tempestdrake):** at the **end of its controller's turn**, deal 1 damage to **every unit — friend or foe — within 1 square (8-adjacency)**.
- **Earthquake (Terradon):** at the **start of each enemy turn** (step 2), every **enemy** unit 8-adjacent to Terradon moves 1 square in a random orthogonal direction — roll **1d4 per unit** (1 N · 2 E · 3 S · 4 W). If the rolled square is occupied or off-board, that unit doesn't move. Show each roll in the battle log. Use a seedable RNG (seed shown/settable) so games can be reproduced.
- **Dread Presence (Gravewinter):** two parts. (1) Enemy units adjacent (8-adj) to Gravewinter deal **−1 damage** on their attacks, to a **minimum of 1**. (2) At the **start of each enemy turn** (step 3), every enemy unit adjacent to Gravewinter gains **1 Chill stack**. Tavrik is immune to both (Rival aura).
- **Hungry Depths (Leviadon):** at the **end of its controller's turn**, **mandatory if possible**: deal 1 damage to one 8-adjacent unit of the controller's choice — friend or foe. If it bit an **ally**, Leviadon heals **3 HP**; an **enemy**, **2 HP** (capped at max). If **no unit is adjacent**, Leviadon takes 1 damage instead.
- Multiple same-trigger auras on one side: controller chooses resolution order.
- Aura damage can KO (including Leviadon starving itself or Local Storm killing allies); check win condition after each resolution.

---

## 6 · The roster (implement as data, exactly)

All base forms: **Speed 2**, Basic 2 dmg (exception: Guppling Basic 1). All middle forms: **Speed 3**, keep Basic, gain the listed **weakened Special** (no effect, no rider). Final forms: as listed; they keep Basic and gain the full Special (+ Aura/Rival where noted).

| # | Line | Type | Stage chain (HP) | Final Speed | Middle special (weakened) | Final special | Evolve →mid | Evolve →final |
|---|---|---|---|---|---|---|---|---|
| 1 | Cinderling | Fire | Cinderling (4) → Flarewyrm (5) → **Pyroclasm (6)** | **6** | Ember Stream — Single 2, 2 dmg | **Magma Stream — Lance 3, 3 dmg, Burn 2 (2/tick), Recoil 2** | dealt 3 | dealt 7 |
| 2 | Sootpup | Fire | Sootpup (4) → **Hellhowl (7)** | 5 | — | **Scorching Howl — Cone, 3 dmg, Push 1, Burn 1 (near square only)** | — | KO an enemy |
| 3 | Snapling | Water | Snapling (4) → Shellbrook (5) → **Bulwhark (8)** | 3 | Jet Spray — Single 2, 2 dmg | **Tidal Ram — Single 3, 3 dmg, Push 1, Lunge** | survived 2 | survived 5 |
| 4 | Guppling | Water | Guppling (3, Basic 1) → **Leviadon (8)** | 4 | — | **Maelstrom — Burst, 3 dmg, Push 1** · Aura: Hungry Depths | — | survived 4 |
| 5 | Mosskit | Grass | Mosskit (4) → Thornhide (5) → **Grovewarden (8)** | 3 | Thorn Lash — Single 2, 2 dmg | **Sunlance — Lance 3, 3 dmg** | survived 2 | survived 5 |
| 6 | Podling | Grass | Podling (4) → **Bombloom (7)** | 2 | — | **Seed Mortar — Bomb 2, 2 dmg, Pin (center square only)** | — | survived 3 |
| 7 | Zapkitt | Electric | Zapkitt (3) → Joltlynx (5) → **Fulgurlynx (6)** | 5 | Jolt Swipe — Single 2, 2 dmg | **Stormbolt — Single 3, 4 dmg, Pin** | dealt 3 | dealt 7 |
| 8 | Coilbug | Electric | Coilbug (4) → **Dynamoth (6)** | 4 | — | **Arc Volley — Scatter (R2, N3), 2 dmg each** | — | dealt 4 |
| 9 | Gritling | Ground | Gritling (4) → Stonehide (5) → **Terradon (8)** | 3 | Stone Toss — Single 2, 2 dmg | **Avalanche Roll — Single 3, 2 dmg, Push 1, Lunge** · Aura: Earthquake | survived 2 | survived 5 |
| 10 | Cacklet | Ground | Cacklet (4) → **Ossiyena (6)** | 4 | — | **Marrow Hurl — Lance 2, 1 dmg, Poison** | — | an allied unit is KO'd |
| 11 | Wyrmlet | Flying | Wyrmlet (4) → Galewyrm (6) → **Tempestdrake (8)** | **6** | Gale Breath — Single 2, 2 dmg | **Tempest Ray — Lance 4, 3 dmg, Recoil 1** · Aura: Local Storm | survived 3 | dealt 8 |
| 12 | Falchick | Flying | Falchick (4) → **Peregale (6)** | 5 | — | **Stoop Strike — Single 2, 2 dmg, Pin, Lunge** · Trait: Talonlock (§3) | — | dealt 4 |
| 13 | Tavrik | Fire | **Tavrik (5)** — single stage, no evolution | 4 (**6** on Blood Scent) | — | **Napebite — Single 2, 2 dmg** · Trait: Tyrantbane (§3) | — | — |
| 14 | Hootle | Psychic | Hootle (4) → Parliowl (5) → **Archistrix (6)** | 4 | Telegrab — range 2, relocate 1, no Telesmash | **Telegrab — range 3, relocate up to 2, Telesmash 1→2→3** | survived 2 | survived 5 |
| 15 | Mystikit | Psychic | Mystikit (4) → **Velvesper (6)** | 5 | — | **Mindclaw — Single 1, 3 dmg, Blink 2** | — | dealt 3 |
| 16 | Shadekit | Dark | Shadekit (4) → Duskpard (5, Skulk) → **Pantherebus (6)** | 5 | Shadow Swipe — Single 1, 2 dmg | **Night Fang — Single 1, 3 dmg, Lunge** · Traits: Skulk + Backstab | dealt 3 | KO an enemy |
| 17 | Glimlure | Dark | Glimlure (4) → **Mawlantern (7)** | 3 | — | **Lure Light — Single 3, 1 dmg, Lure (pull 1 + Hex)** | — | survived 3 |
| 18 | Frostfawn | Ice | Frostfawn (4) → Rimestag (6) → **Gravewinter (10)** | 4 | Frost Gore — Single 2, 2 dmg | **Glacial Gore — Cone, 3 dmg, Chill 1 per enemy hit** · Aura: Dread Presence · **TYRANT** | survived 3 | survived 7 |
| 19 | Floecub | Ice | Floecub (4) → Frostursa (6) → **Maulberg (8)** | 4 | Ice Swipe — Single 1, 2 dmg | **Avalanche Maul — Single 1, 4 dmg, Chill 1** | dealt 3 | dealt 7 |
| 20 | Pupfloe | Ice | Pupfloe (4) → **Floefang (6)** | 4 | — | **Breach Bite — Single 2, 3 dmg, Chill 1** | — | dealt 3 |
| 21 | Quillet | Electric | Quillet (4) → **Galvaquill (7)** | 3 | — | **Quill Burst — Burst, 2 dmg** · Trait: Static Quills (§3) | — | survived 3 |
| 22 | Slithrin | Water | Slithrin (4) → **Servenom (6)** | 4 | — | **Venom Fang — Single 1, 2 dmg, Poison** | — | dealt 3 |
| 23 | Pebblepaw | Ground | Pebblepaw (4) → **Pumarok (6)** | 5 | — | **Pounce — Single 2, 3 dmg, Lunge** | — | dealt 4 |
| 24 | Shriket | Dark | Shriket (4) → **Butcherbeak (5)** | 5 | — | **Impale — Single 1, 2 dmg, Pin** · Trait: Butcher (§3) | — | dealt 4 |

**Gravewinter's special (line 18) is updated:** Glacial Gore — Cone, 3 dmg, **+1 per existing Chill stack on each target**, then Chill 1 per enemy hit.

**Tyrants:** lines 1, 11, and 18 carry the Rival keyword on their finals; the tyrant-phase draft (§1) puts exactly one on each team. **Line 13 (Tavrik) is single-stage:** it enters play in its only form, at full strength, and never evolves — no evolution tracking applies to it. Duskpard's **Skulk arrives at the middle stage** — the only trait in the game on a non-final form.

---

## 7 · Type chart

Super-effective = ×2 on the focus unit only (§3). Everything not listed = normal damage. No resist tier, no immunities.

| Attacker | doubles vs |
|---|---|
| Fire | Grass, Ice |
| Water | Fire, Ground |
| Grass | Water, Ground |
| Electric | Water, Flying |
| Ground | Fire, Electric |
| Flying | Grass |
| Psychic | — (nothing, by design — future types will prey on it) |
| Dark | Psychic |
| Ice | Grass, Ground, Flying |

---

## 8 · UI requirements

- 8×8 board; clear side colors; units show name initial/icon, HP, stage; Pin/Burn badges.
- Selecting a unit highlights reachable squares; selecting an attack previews exactly the hit squares and marks where the ×2 focus can land; focus pick prompt when needed.
- Visible turn banner with **activations remaining (3 → 0)** and already-activated units marked.
- **Battle log** (scrolling): every move, attack with damage math ("Magma Stream: 3 → 6 super-effective"), effect, aura trigger, d4 roll, evolution, KO.
- Evolution moment should feel like an event (animation or at minimum a modal/flash).
- "End turn" button (a player may bank fewer than 3 activations).
- Rules reference modal: type chart, patterns, effects (content from this spec).
- Works on mobile (tap targets ≥ 40px; board scales).

## 9 · Engineering discipline

- Pure, unit-testable engine separated from DOM: `engine.js` (state in, state out) + `ui.js` + `data.js`.
- **Tests (required, run with `node test.js` — no framework needed):** movement BFS with blocking; each pattern's hit-square set (incl. Cone triangle = 4 squares, Lance pierce, Bomb plus-shape, Scatter Manhattan range); focus ×2 single-target enforcement; friendly fire off (Lance passes over an ally harmlessly; Single blocked by an ally body; Cone/Burst/Bomb/Scatter ignore allies on hit squares); Push cancellation; Pin/Burn turn-start timing (Burn N ticks N dmg at each of the victim's next 2 turn starts even if never activated — Magma Stream 2/tick, Scorching Howl 1/tick; reapplying resets, never stacks, higher N wins); Scorching Howl's burn lands only on the cone's near square (empty/ally near square = no burn, even with enemies in the far row); Poison execute (no damage; 3rd applied stack = instant KO regardless of HP; stacks persist; KO credited to applier); Recoil self-KO; Lunge legality; Talonlock (forced lunge on pin; self-root timing; double vs pinned incl. pins from other units; ×2 cap with super-effective; Stoop Strike usable while rooted); Tyrantbane (immune to tyrant Specials/Auras incl. friendly Local Storm, while tyrant Basics hit normally; tyrant Lance passes through Tavrik to units beyond; attacks vs tyrants legal only at range 1 and doubled with ×2 cap; range-2 Napebite at a tyrant is an illegal declaration; Blood Scent speed 4→6 toggles on enemy tyrant final-evolution and reverts on its KO; pre-evolutions get none of this); tyrant-phase draft (each team exactly one tyrant; third tyrant + 11 lines cut = 12 out; snake starts with flip loser); Chill stacking → Speed 0 → Hard Freeze (no move/attack, Fire ×2 that turn, cap holds; single stack freezes Speed-2 units); Hex +1 on attacks and Burn ticks for 2 turns; Lure pull-cancel + Hex; Skulk pathing through bodies; Backstab facing + flanking triggers and +2-after-doubling math; Telegrab relocation legality + persistent Telesmash counters; Blink ignores blockers; Dread Presence −1 (min 1) and start-of-turn Chill; Glacial Gore +1 per pre-existing Chill stack (counted before the new stack); Static Quills 1-dmg reflect on adjacent attacks only (no tick/aura trigger); Butcher +2 vs pinned after doubling (and not on the same Impale that applies the pin); shared Poison counters across Ossiyena and Servenom with 3rd-stack KO credit; evolution thresholds & +2 capped refresh; Hungry Depths heal amounts and starve; Local Storm friendly damage; Earthquake blocked-square no-move; rivals draft enforcement; win + simultaneity rule.
- Seeded RNG used ONLY by Earthquake (host-generated in remote mode).
- **Serialization test:** a mid-game state survives `JSON.parse(JSON.stringify(state))` and replays identically; every guest intent type round-trips through the message protocol.
- Pause and ask before: adding any dependency beyond PeerJS, deviating from any Pinned ruling, or changing any number in §6/§7.
- Final deliverable includes a short **README**: how to deploy to GitHub Pages, how to host/join a remote game, and the symmetric-NAT limitation + hotseat fallback.
- Verification gate before done: all tests pass + a full manual game played start to finish via the checklist below.

## 10 · Acceptance checklist (manual)

1. Draft enforces the tyrant phase (winner picks a tyrant, loser picks from the remaining two, third tyrant cut) then the 10-pick snake starting with the flip loser; every team ends with exactly one tyrant.
2. Units placed only on back two rows; battle starts with 12 base forms.
3. A turn allows exactly ≤3 distinct activations; a pinned unit can attack but not move during its controller's next turn, and the pin clears at that turn's end.
4. Friendly fire off: a Lance fired through an allied unit damages only the enemies beyond it; a Single is blocked by an ally's body (no shot); a Magma Stream victim ticks 2 burn damage at each of its next two turn starts even if it never activates, while a Scorching Howl burn ticks 1 and lands only on the near-square unit; a unit hit by Marrow Hurl three times dies instantly on the third hit (e.g. a full-HP Bulwhark at 8 HP), with poison stacks visible on the unit throughout.
5. Super-effective doubles exactly one unit per attack; focus prompt appears on multi-hit.
6. A unit evolves at start of turn with +2 HP capped (verify: damaged middle → final ≠ full).
7. Pyroclasm using Magma Stream takes 2 recoil and can KO itself; Burn ticks (at victims' turn starts) and its KOs credit Pyroclasm's "dealt" counter.
8. Tempestdrake's Local Storm hits adjacent allies at end of turn.
9. Terradon's Earthquake rolls a visible d4 per adjacent enemy at start of enemy turn; blocked rolls don't move.
10. Leviadon must bite if adjacent (heals 3 ally / 2 enemy, capped), starves for 1 otherwise.
11. Win triggers immediately on last KO, including via aura; simultaneity rule honored.
12. Whole game playable on a phone.
13. **Tyrantbane:** Magma Stream and Local Storm deal zero to Tavrik (and a tyrant's Lance still hits units behind it) while a tyrant Basic deals 2; Tavrik's adjacent Basic deals 4 vs Tempestdrake but only 2 vs a Galewyrm; Napebite cannot be declared at a tyrant 2 squares away; Tavrik's speed reads 6 the moment an enemy Galewyrm becomes Tempestdrake and reads 4 again when it dies.
14. **Talonlock:** Peregale pins a unit → it force-lunges adjacent and can't walk next turn, but can Stoop Strike a new target (and relocate) while rooted; its Basic deals 4 vs a pinned unit; vs a pinned Grass unit the hit is still ×2, not ×4.
15. **Remote:** host on one machine, join by room code from a second machine/browser profile; a full game (draft → win) plays with every action appearing on both screens; the guest's focus picks and Hungry Depths choices work; Earthquake rolls match on both screens.
16. **New types:** Gravewinter's cone Chills a Speed-2 base into Hard Freeze (it skips its turn and takes double from a Fire attack that turn, still ×2 total); Pantherebus skulks through a wall of units and backstabs from the rear for +2 after doubling; Archistrix's third Telegrab on the same unit deals 3; Mawlantern's lure drags a unit 1 closer and Hexes it (+1 from a following Burn tick included); the draft opens with both tyrant picks and exactly 12 lines sit out.
17. **Wave-2 roster:** Glacial Gore vs a 2-stack-Chilled target deals 3+2 (or ×2 then +2 if super-effective); hitting Galvaquill with an adjacent Basic costs the attacker 1 HP afterward; Butcherbeak's Basic deals 4 vs a unit Peregale pinned; a unit with 2 Ossiyena stacks dies to Servenom's first bite (credit Servenom).
18. **Remote disconnect:** kill the guest's tab mid-game, rejoin with the same code, and play resumes from the synced state.

## 11 · Out of scope (do not build)

AI opponent, accounts/logins, matchmaking or lobbies beyond a room code, spectators, TURN relay servers, chat (testers have Discord), sound, campaign/story, balance changes, additional monsters, alternate win conditions. This is a faithful digitization of tabletop v7 (Playtest #7) for human-vs-human beta testing — nothing more.
