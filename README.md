# Aether

Original AQW-inspired browser RPG. **M1 implements shared content and session contracts, sample definitions, and validation.** The Game Client, adapters, Creator Studio, and authoritative server are later milestones.

The gameplay source of truth is [Dawnwell Glade](docs/game-design.md). Development order and architecture are in the [roadmap](docs/development-roadmap.md).

## Development checks

Use Node **24.12 or newer** and the pinned pnpm version from `package.json`. Node runs the TypeScript checks/tests through native type stripping; the separate compiler check verifies their types. [Node TypeScript documentation](https://nodejs.org/api/typescript.html).

```sh
pnpm install --frozen-lockfile
pnpm check
```

Individual checks:

```sh
pnpm typecheck
pnpm validate:content
pnpm test
```

Validate another JSON pack or require completed assets:

```sh
pnpm validate:content path/to/pack.json
pnpm validate:content --require-ready-assets
```

The Dawnwell sample currently has **26 explicitly declared image/audio placeholders**. Normal validation reports warnings and succeeds on definitions/references. The ready-assets check intentionally fails until original files and their provenance/checksums are supplied. This is not a full publishing pipeline.

## Workspace

| Location | Responsibility |
| --- | --- |
| `packages/content` (`@aether/content`) | Zod schemas, inferred types, pure runtime/reference validation |
| `packages/game-core` (`@aether/game-core`) | Type-only `GameSession`, commands, immutable observed state, events, lifecycle/readiness |
| `content/dawnwell-glade/pack.json` | Hand-authored sample definitions, rules, and placeholder metadata |
| `tools/content/validate.ts` | JSON validation CLI and ready-file existence/checksum checks |
| `docs/asset-conventions.md` | Coordinate, animation, facing, overlay, attachment, and placeholder conventions |
| `docs/m1-implementation.md` | M1 acceptance evidence, changed-file inventory, and unresolved decisions |

The packages currently export ESM TypeScript source for workspace consumers; no publishing/build distribution is implemented. Future browser apps must compile workspace sources. Shared source has no React, Phaser, browser-storage, or SpacetimeDB imports.

## Content API

`@aether/content` exports definition schemas and their inferred TypeScript types, plus `validateContentPack(unknown, options)`. Validation returns a discriminated success result with parsed data or errors, and diagnostics containing severity, code, path, and message. Types come from the same [Zod schema definitions](https://zod.dev/api) used at runtime.

All objects are strict, numeric values are finite, counts/timings are safe integers, and inputs are not coerced. Validation reports schema issues together; duplicate global IDs are also detected when records contain schema errors. Cross-reference/semantic checks run after structural validation succeeds. Invalid structural data is never cast into a valid pack.

Global IDs are unique across definition collections and the manifest. Placement IDs are map-local; frame indices, clip names, attachments, dialogue nodes, and choice IDs have explicit local uniqueness checks. References resolve against the expected collection and asset kind. Other valid packs can use the supported behavior vocabulary without inheriting Dawnwell's coordinates or balance numbers.

`asset.status = "placeholder"` carries a reason and no fake file URL or provenance. Ready assets require a safe pack-relative path, SHA-256 checksum, and original-asset provenance. The browser-safe validator checks definitions; the CLI checks ready files and rejects missing/tampered files or paths resolving outside the pack.

## Session boundary

`@aether/game-core` exports types only. `GameSession` describes connection/disconnection, readiness, commands, observed snapshots, events, credentials, unsubscribe functions, and an estimated authority clock. No adapter is implemented.

- Connection becomes `ready` only when content, room, and personal subscriptions are all applied. Reconnection clears readiness until refreshed snapshots arrive.
- Commands express intentions and include a command ID. They do not carry an acting identity, damage, rewards, authoritative position, or client timestamp.
- Runtime IDs are branded strings, separate from definition IDs and from one another. Enemy handles include encounter IDs so stale requests can be rejected after reset/respawn.
- Saved progress, room state, and recovery state are distinct contracts. Observed data is deeply read-only; credentials are delivered separately from snapshots.
- Command acceptance can mean a pending approach. Accepted presentation events carry deduplication IDs; adapters must not replay commands after reconnect.
- `disconnect()` means connection loss and eventual grace-period handling. The `leave_room` intention requests room removal. Future adapters enforce that distinction.

UI bridges and adapter behavior are M2/M3a work. These contracts do not claim multiplayer correctness, secure persistence, or implemented combat.
