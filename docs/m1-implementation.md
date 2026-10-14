# M1 Implementation Report

## Result

**M1 acceptance criteria are satisfied for the contracts/sample-content milestone.** The shared packages, Dawnwell sample definitions, runtime/reference validation, asset conventions, and initial session port are implemented. Original image/audio files remain explicitly unavailable; no game UI, adapter, builder, or SpacetimeDB implementation is included.

Both [the roadmap](development-roadmap.md) and [the game specification](game-design.md) were read before implementation and remain unchanged. The repository previously contained those two documents, with no existing package conventions or applicable `AGENTS.md`. The implementation follows the proposed pnpm workspace and two-package structure.

## Added files

All 20 files below are new; neither source document was edited.

| Area | Files | Purpose |
| --- | --- | --- |
| Workspace | `.gitignore`, `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `tsconfig.json` | Pinned tools/dependencies, workspace packages, strict type checking, test/validation commands |
| Overview | `README.md` | Setup, commands, API boundaries, and milestone limitations |
| Content package | `packages/content/package.json`, `packages/content/src/index.ts`, `packages/content/src/schemas.ts`, `packages/content/src/validate.ts` | Strict schemas, inferred types, supported presets, diagnostics, semantic/reference checks |
| Content checks | `packages/content/test/dawnwell.test.ts`, `packages/content/test/validation.test.ts` | Independent source-value regressions, malformed-content/reference tests, asset/CLI checks |
| Game Core | `packages/game-core/package.json`, `packages/game-core/src/index.ts`, `packages/game-core/src/session.ts`, `packages/game-core/test/contracts.test.ts` | Type-only session port, commands, deep-readonly observations, lifecycle/readiness and compile-time boundary checks |
| Sample pack | `content/dawnwell-glade/pack.json` | Exact Dawnwell gameplay definitions, supported rule policies, default appearances, explicit placeholders |
| CLI | `tools/content/validate.ts` | JSON validation, diagnostics, ready-file verification, nonzero failure exits |
| Documentation | `docs/asset-conventions.md`, `docs/m1-implementation.md` | Asset metadata/placeholder conventions and this acceptance report |

## Checks run

`pnpm check` passed, running:

- `pnpm typecheck`: strict TypeScript checking, including compile-time rejection of wrong runtime ID kinds, forged command fields, premature readiness, mutable observations, and nonexistent reward APIs.
- `pnpm validate:content`: Dawnwell schema/semantic/reference validation passed with **26 explicit asset-placeholder warnings** and no errors.
- `pnpm test`: **22 tests passed; zero failures or skips**.

Tests cover exact gameplay IDs, map coordinates, stats, skill values, enemy policies/rewards, quest flow definitions, inventory/progression values, manual combat policies, recovery and reconnect policies. Derived content arithmetic matches the specification: damage 10/22/8, 175 XP/50 gold after the quest, level-2 reward attack 17, and 300 XP at the level cap.

Failure checks include missing/duplicate IDs, multiple broken references, negative/nonfinite/coerced/fractional count values, unsupported mechanics/scripts/fields, invalid map/safe placements, progression mismatches, quest supply/consumption/cycles, NPC relationships, unowned equipment, inventory slot accounting, invalid sprite frames/anchors/clips/attachments/layers, and dialogue link/reachability errors.

CLI tests verify nonzero exits for malformed JSON, missing ready files, checksum mismatch, path traversal, and escaping symlinks. `--require-ready-assets` intentionally rejects the sample placeholders. Passing that guard is deferred until original assets exist; it is not claimed as publishing readiness.

The source documents' SHA-256 hashes were checked before and after implementation and match. Runtime gameplay, multiplayer behavior, privacy enforcement, concurrency, persistence, and reconnect guarantees remain later-milestone tests.

## Acceptance evidence

| M1 criterion | Evidence | Status |
| --- | --- | --- |
| Minimum shared content contracts and runtime validation | Strict Zod schemas and inferred types for maps, characters/appearance, sprites/animations, classes, skills, items, enemies, quests, NPCs, dialogue, rules, and sample manifest | Satisfied |
| Exact Dawnwell IDs, positions, numeric values, and policies | Hand-authored JSON pack plus independent source-value regression tests | Satisfied |
| Missing/duplicate IDs, invalid values, and unsupported definitions fail clearly | Severity/code/path/message diagnostics and failing-input tests; duplicates are reported even alongside schema failures | Satisfied |
| Cross-reference and semantic integrity | Expected-category/kind checks, map bounds, clip/rig compatibility, quest supply/consumption/NPC consistency, dialogue links/reachability, and progression consistency | Satisfied |
| Asset conventions established without pretending art exists | Explicit placeholder union, required clip metadata, anchors/facing/layers/sockets, asset documentation, and ready-asset guard | Satisfied for M1; original assets pending |
| Initial networking-independent session port | Type-only `GameSession`, intentions, lifecycle, readiness, immutable state/events, distinct runtime IDs, private credentials | Satisfied; adapters deferred |
| Client can later consume reusable definitions | No Dawnwell-specific constraints in generic validators; alternative valid placement/speed fixture passes | Contract capability satisfied; client loading is M2 |
| Meaningful checks pass | Full `pnpm check`, 22 tests, strict type checking, source-document integrity check | Satisfied |

## Unresolved decisions and deliberate limits

- **Original asset production:** Final canvas dimensions, frame counts/timings, palettes, and attachment positions remain art decisions. Current single-frame metadata is clearly labeled provisional. Player customization and an appearance-change command belong to M4.
- **Guest sessions:** Character naming restrictions and same-identity multi-tab policy must be decided before real integration. The interface provides identity/token types without choosing a connection policy or storage implementation.
- **Operational gameplay:** Chat/rate/history limits, server scheduling cadence, restart/elapsed-time recovery, deployment/storage, and backup/restore remain the roadmap's M3a/M6/M7 decisions.
- **Expanded inventory/content:** Stack/count limits and full-inventory reward behavior are needed before publishing content beyond Dawnwell's bounded item set. Initial inventory slot validation accounts for nonstackable copies.
- **Publishing:** The manifest describes a sample schema/runtime/release identity. Immutable release hashing, migration/activation, remote creator authorization, and server/client compatibility enforcement remain M7 work. Ready-file validation alone is not publication.
- **Runtime behavior:** Rule presets encode required semantics but do not execute them. M2 implements the local adapter; M3a/M6 implement and verify authoritative behavior. Unsupported mechanics require contract/runtime/server changes before authoring.
- **Structural failures:** Schema diagnostics are collected first; graph checks require structurally valid data. This prevents unsafe casts or partial interpretation of malformed packs.

Next milestone: implement the [M2 client foundation checklist](development-roadmap.md#7-first-client-development-milestone-checklist) against these contracts and the validated sample pack.
