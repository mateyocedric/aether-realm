# M2 — Local Game Client Foundation

## Result and running the app

**M2 acceptance criteria are satisfied.** The Next.js app loads validated Dawnwell content into a browser-only Phaser scene. A disposable `GameSession` adapter owns local movement, and a typed controller bridges scene input/observations with React panels.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open http://127.0.0.1:3000 and choose **Enter the glade**, or visit `/play`. Both routes identify the experience as **Local Development**. The scene contains labeled geometric placeholders for the Guardian, Keeper Mira, four Thornlings, and the map. Original asset references stay in the validated content definitions.

The roadmap, game specification, M1 source/tests, and repository instructions were inspected before implementation. Neither source design document was changed. Next.js generated an app-local `AGENTS.md`; its relevant installed framework guides were read and the generated instructions retained.

## Implementation and boundaries

- **Client-only Phaser:** A Client Component dynamically loads the host with `ssr: false`. Initialization is deferred to a cancellable frame so React Strict Mode's discarded effect does not create a second game. Cleanup cancels pending initialization, disconnects the resize observer, and destroys the game/canvas.
- **Scene cleanup:** Scene shutdown/destroy removes pointer and canvas-key listeners and unsubscribes from render state. Controller disposal unsubscribes from the session and cancels the adapter's scheduling loop through disconnect.
- **Typed bridge:** `GameController` accepts typed UI intentions, sends typed `GameSession` commands, and observes read-only state. Phaser receives movement snapshots outside React state. React uses `useSyncExternalStore` against an identity/resource/status/message projection that stays referentially stable during walking.
- **Local adapter:** Uses an injected clock/scheduler, validates content and destinations with M1, and maintains one simulation callback. Movement normalizes the ground-point vector, uses class speed and elapsed authority time, clamps requests to map bounds, snaps at arrival, and derives facing. A new intention reconciles previous movement before starting its next path so idle time cannot increase speed.
- **Content loading:** The content route validates the canonical JSON pack, the browser loader validates its response, and the adapter validates its input. Invalid content displays a clear load error before Phaser mounts. No second copy of the sample pack is maintained.
- **Assets:** Backgrounds, sprite frames, idle poses, anchors, scale, facing, and weapon references come from definitions. Ready files are served by asset ID with path containment and checksum checks. Placeholder entries are never requested as files; they render labeled stand-ins. Optional map presentation references select destination/selection assets.
- **Scaling/input:** Phaser FIT scaling and a resize observer preserve the fixed world dimensions. Pointer positions are converted through the scene camera. Canvas-only input and DOM panels isolate world clicks; text entry suppresses shortcuts, and holding a key does not repeat requests.
- **Scope:** Enemy selection and NPC proximity feedback are presentation foundations. Disabled action buttons identify M3. Combat, dialogue execution, quest completion, inventory actions, chat delivery, builders, and multiplayer remain deferred.

The adapter-selection point is in `GameClient`; scene and panels depend on the controller/session contracts, not the local adapter. Default production builds disable the local preview. An explicit local-preview build is available with `NEXT_PUBLIC_GAME_MODE=local-development pnpm build`, followed by `pnpm start`. No authoritative production adapter is supplied.

## Files changed

### Added source/configuration

| Area | Files |
| --- | --- |
| App setup/instructions | `apps/game-client/package.json`, `apps/game-client/tsconfig.json`, `apps/game-client/next.config.mjs`, `apps/game-client/AGENTS.md` |
| Routes and styles | `apps/game-client/src/app/layout.tsx`, `apps/game-client/src/app/page.tsx`, `apps/game-client/src/app/play/page.tsx`, `apps/game-client/src/app/globals.css` |
| Content/asset delivery | `apps/game-client/src/server/content.ts`, `apps/game-client/src/app/api/content/route.ts`, `apps/game-client/src/app/api/assets/route.ts`, `apps/game-client/src/game/content.ts` |
| Local simulation and bridge | `apps/game-client/src/adapters/local/LocalGameSession.ts`, `apps/game-client/src/bridge/GameController.ts` |
| Phaser/input/HUD | `apps/game-client/src/game/PhaserHost.tsx`, `apps/game-client/src/game/DawnwellScene.ts`, `apps/game-client/src/game/input.ts`, `apps/game-client/src/ui/GameClient.tsx` |
| Verification | `apps/game-client/test/local-session.test.ts`, `tests/browser/game.spec.ts`, `playwright.config.ts` |
| Report | `docs/m2-implementation.md` |

### Updated existing files

| Files | Changes |
| --- | --- |
| `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `tsconfig.json`, `.gitignore` | App workspace/dependencies, dev/build/browser scripts, app/browser type checks, explicit dependency installation, generated-artifact ignores |
| `packages/content/src/schemas.ts`, `packages/content/src/validate.ts`, `packages/content/test/validation.test.ts` | Optional map marker references, effect-asset integrity checks, regression coverage |
| `content/dawnwell-glade/pack.json` | References its existing destination/selection marker IDs; gameplay IDs, positions, stats, rewards, and policies remain unchanged |
| `packages/game-core/src/session.ts`, `packages/game-core/test/contracts.test.ts` | Correct `DeepReadonly` to preserve branded primitive IDs, plus a compile-time regression check |
| `README.md`, `docs/asset-conventions.md` | Run/check instructions, mode guard, lifecycle/state separation, and M2 asset integration |

Next-managed `next-env.d.ts`, `.next` output, local dependency caches, and browser artifacts are generated and ignored. Both packages and the app use TypeScript 7.0.2; the installed Next.js 16.4 documentation supports its CLI checker. App type checking generates route types first.

## Verification performed

| Check | Result and evidence |
| --- | --- |
| `pnpm check` | Passed shared/app strict type checking, content validation, and **34 unit tests** |
| Content validation | Exact Dawnwell regression fixtures pass; **26 explicit placeholder warnings**, zero content/reference errors |
| Deterministic movement tests | Horizontal and diagonal travel cover 180 units in one second; requests clamp to x=64–1216/y=440–640; malformed coordinates fail; arrival snaps, facing updates, and idle time does not inflate travel |
| Adapter/bridge tests | Readiness phases, release mismatch, async cancellation, one scheduling loop, detached observers, immutable snapshots, encounter-aware selection, and rejection of deferred commands pass |
| React separation | Unit and browser checks show scene movement updates without frame-by-frame HUD renders |
| `pnpm build` | Optimized default production build passes compilation and native TypeScript checking; browser-only imports do not run during prerendering |
| Explicit local-preview build | `NEXT_PUBLIC_GAME_MODE=local-development pnpm build` passed with the same client-only boundary |
| Built-app HTTP checks | `/play` returns the disabled-by-default production guard; `/api/content` returns the validated 1280×720/four-enemy pack; placeholder assets are rejected as unavailable files |
| `pnpm test:browser` | **8 Chrome tests passed** against the existing local development server |
| Browser movement/scaling | Actual mouse input, clamping, facing, depth=ground Y, and pointer conversion pass at 1400×1100, 860×900, and 620×800 viewport sizes |
| Input isolation | HUD/scratchpad clicks do not move the actor; typing Space/1/2 remains text; returning focus to the canvas restores scene shortcuts |
| Navigation lifecycle | Three exit/re-entry cycles leave one working canvas, stop each previous scene's frame counter, produce no page errors, and preserve functional movement |
| Reusable definitions | A second validated fixture changes spawn, enemy placement, and movement speed without scene code edits; broken references show an error without mounting Phaser |
| Visual review | The generated scene screenshot was inspected for actor placement, labels, HUD visibility, and placeholder/mode clarity |
| Source integrity | Roadmap and game-specification SHA-256 hashes match their pre-implementation values |

Browser-coordinate assertions use the actual browser mouse event, accounting for screen-pixel rounding after CSS scaling. The browser runner reuses an existing local server outside CI and leaves it running; servers it starts are owned by the runner. The separate built-app verification server was stopped after checks.

## Limitations and deferred decisions

- The experience is a single local preview with an ephemeral default Guardian. Leaving/reloading resets the local character; notes are explicitly not saved. There is no real guest authentication, saved progress, cross-tab coordination, or authoritative reconnect behavior.
- Thornlings remain idle; health/mana start at the defined maxima. No attacks, mana spending, regeneration, enemy AI, rewards, quests, or inventory execution are implemented.
- Real sprite/audio files are unavailable. Provisional metadata and labeled geometry remain; animation execution and sound arrive later. Ready-file rendering hooks exist, but current visual acceptance uses the placeholder pack.
- Only Chrome was browser-tested. Desktop-first layout scales down, but mobile gameplay and additional browser compatibility remain later work.
- Character naming/customization policies, chat limits, server timing/restart handling, and hosting/publishing decisions remain at their roadmap gates.

Implementation stops at **M2**. No Creator Studio, SpacetimeDB module, multiplayer adapter, or M3 game loop was added.
