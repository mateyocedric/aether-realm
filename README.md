# Aether

Original AQW-inspired browser RPG. **M2 adds the local Next.js/Phaser client foundation** on top of M1's shared content/session contracts and validated sample definitions. Combat, quest execution, inventory interactions, Creator Studio, and authoritative multiplayer remain later milestones.

The gameplay source of truth is [Dawnwell Glade](docs/game-design.md). Development order and architecture are in the [roadmap](docs/development-roadmap.md).

## Run the local client

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open http://127.0.0.1:3000 and choose **Enter the glade**. `/play` displays **Local Development** mode, labeled geometric asset placeholders, movement, selection, identity/resources, and session status. Local characters/notes reset when leaving or reloading; this milestone does not save gameplay progress.

The Next.js application is in `apps/game-client`. Both the shared packages and app use pinned TypeScript 7. Next's installed documentation confirms its CLI checker supports that version. `next typegen` prepares generated route types before app type checking. Next-managed `next-env.d.ts` is ignored and regenerated rather than manually maintained.

## Development checks

Use Node **24.12 or newer** and the pinned pnpm version from `package.json`. Node runs unit tests through native type stripping; separate compiler checks verify shared and app types. [Node TypeScript documentation](https://nodejs.org/api/typescript.html).

```sh
pnpm check
pnpm test:browser
NEXT_PUBLIC_GAME_MODE=local-development pnpm build
```

Individual checks:

```sh
pnpm typecheck
pnpm validate:content
pnpm test
```

`pnpm test:browser` uses the installed Google Chrome channel. It starts a local Next.js server when needed and reuses an existing local server outside CI. A server started by the test runner is stopped afterward; an existing user server is left running. Set `E2E_BASE_URL` to another localhost URL when needed. Trace/failure images and the scene screenshot are generated under ignored `test-results/`.

An ordinary `pnpm build` succeeds with the local preview disabled. An explicit preview build uses the environment flag above; run `pnpm start` to serve it. No production networking adapter exists. This guard prevents accidental activation of the local simulator in an ordinary production build.

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
| `apps/game-client` | Local adapter, typed controller/bridge, browser-only Phaser host, responsive scene, React HUD, and content/asset routes |
| `tests/browser`, `playwright.config.ts` | Browser input, resize, content loading, and navigation/lifecycle checks |
| `docs/asset-conventions.md` | Coordinate, animation, facing, overlay, attachment, and placeholder conventions |
| `docs/m1-implementation.md` | M1 acceptance evidence, changed-file inventory, and unresolved decisions |
| `docs/m2-implementation.md` | M2 implementation, verification evidence, changed files, and limitations |

The packages currently export ESM TypeScript source for workspace consumers; no publishing/build distribution is implemented. Future browser apps must compile workspace sources. Shared source has no React, Phaser, browser-storage, or SpacetimeDB imports.

## Content API

`@aether/content` exports definition schemas and their inferred TypeScript types, plus `validateContentPack(unknown, options)`. Validation returns a discriminated success result with parsed data or errors, and diagnostics containing severity, code, path, and message. Types come from the same [Zod schema definitions](https://zod.dev/api) used at runtime.

All objects are strict, numeric values are finite, counts/timings are safe integers, and inputs are not coerced. Validation reports schema issues together; duplicate global IDs are also detected when records contain schema errors. Cross-reference/semantic checks run after structural validation succeeds. Invalid structural data is never cast into a valid pack.

Global IDs are unique across definition collections and the manifest. Placement IDs are map-local; frame indices, clip names, attachments, dialogue nodes, and choice IDs have explicit local uniqueness checks. References resolve against the expected collection and asset kind. Other valid packs can use the supported behavior vocabulary without inheriting Dawnwell's coordinates or balance numbers.

`asset.status = "placeholder"` carries a reason and no fake file URL or provenance. Ready assets require a safe pack-relative path, SHA-256 checksum, and original-asset provenance. The browser-safe validator checks definitions; the CLI checks ready files and rejects missing/tampered files or paths resolving outside the pack.

## Session boundary

`@aether/game-core` exports types only. `GameSession` describes connection/disconnection, readiness, commands, observed snapshots, events, credentials, unsubscribe functions, and an estimated authority clock. M2 implements the disposable local adapter inside the Game Client; a network adapter is still deferred.

- Connection becomes `ready` only when content, room, and personal subscriptions are all applied. Reconnection clears readiness until refreshed snapshots arrive.
- Commands express intentions and include a command ID. They do not carry an acting identity, damage, rewards, authoritative position, or client timestamp.
- Runtime IDs are branded strings, separate from definition IDs and from one another. Enemy handles include encounter IDs so stale requests can be rejected after reset/respawn.
- Saved progress, room state, and recovery state are distinct contracts. Observed data is deeply read-only; credentials are delivered separately from snapshots.
- Command acceptance can mean a pending approach. Accepted presentation events carry deduplication IDs; adapters must not replay commands after reconnect.
- `disconnect()` means connection loss and eventual grace-period handling. The `leave_room` intention requests room removal. Future adapters enforce that distinction.

The typed `GameController` bridge forwards read-only scene state and projects a stable HUD snapshot for React. Phaser receives frame-by-frame movement outside React state. The local adapter uses an injected clock/scheduler, validates content and destinations, and owns normalized movement; it rejects deferred commands without gameplay side effects. These checks do not claim multiplayer correctness, secure persistence, or implemented combat.
