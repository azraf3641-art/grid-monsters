# Reconciliation notes

## Round 1 (engine build) — 2026-06-10

Initial run: 193 passed, 3 failed.

### Test-side fix (harness, not assertions)

- **Tests:** `patterns.test.js` — "Single: super-effective auto-doubles its one target — Stormbolt 8 vs Flying, 4 vs Ground (§7 Electric beats Flying)" and "Basic: 2 dmg, doubled iff attacker type beats target — Fire Basic KOs a 4hp Grass; deals plain 2 to Water via diagonal adjacency (§7)".
- **What was wrong:** the shared `act()` helper in `tests/helpers.js` unconditionally sent `{t:'endActivation'}` after the attack. In both tests the attack KOs the defender's last unit, so the game is already over and the engine (correctly) throws "the game is over". The assertions themselves were correct and are unchanged; `act()` now returns immediately when `state.phase === 'over'`.
- **Citation:** SPEC.md §1 Winning — "A player wins immediately when all 6 enemy units are KO'd"; CONTRACT.md Actions table — phase `over` accepts only `{t:'rematch'}`, and `applyAction` "Throws Error … on any illegal action (wrong player, wrong phase, …)".

### Engine-side fix (recorded for context; no test changed)

- **Test that caught it:** `traits.test.js` — "Tyrantbane: Magma Stream deals 0 to Tavrik, no burn; the Lance passes THROUGH and hits the unit beyond; recoil still applies (SPEC §3 Tyrant-proof)" (`assertEq(unit.burn, {n:2, ticks:2})`).
- **What was wrong:** the engine stored the burner's id inside the burn object (`burn: {n, ticks, by}`), violating the CONTRACT.md state-shape pin `burn: null | { n, ticks }`. The attribution itself is required by SPEC.md §3 ("Burn ticks credit the unit that applied the Burn"), so it now lives in a sibling unit field `burnBy` (set on application, higher/newer N wins credit on reapplication, deleted when the burn expires; absent/`null` ⇒ tick credits no one — matches mkBattle-built states). All burn-attribution tests (`status.test.js`, `flow.test.js`) still pass.
