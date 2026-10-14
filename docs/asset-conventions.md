# M1 Asset Conventions

These conventions describe prepared original assets consumed by the content contracts. Preparing sheets, clips, anchors, and overlays is separate from generating or drawing artwork. [The game specification](game-design.md) determines required original assets and animations.

## Ground coordinates and anchors

- World origin is top-left; X increases right and Y increases down. Positions refer to feet on the shallow ground plane.
- `groundAnchorPx` is a local pixel point inside each frame, measured from that frame's top-left. It is not a world position or an atlas-wide coordinate.
- A local point renders at `(localPoint − groundAnchorPx) × worldUnitsPerPixel` relative to the actor's world ground point.
- Sort the assembled character's root by world ground Y. Layer ordering happens within that root and does not change movement or melee distance.
- Frame rectangles must remain inside declared sheet dimensions. Clip and attachment frame indices must exist. Ground anchors and attachment points must fit each referenced frame.

## Animation vocabulary

| Actor | Required clip names |
| --- | --- |
| Guardian and compatible weapon overlays | `idle`, `walk`, `basic_attack`, `heavy_strike`, `mend`, `death` |
| Thornling | `idle`, `walk`, `attack`, `hit`, `death` |
| Keeper Mira | `idle` |

Clips list explicit frame indices, a positive integer `frameDurationMs`, and a looping flag. Duplicate clip names fail validation; repeated frame indices within a clip are allowed for held poses. Source frame rectangles are explicit, allowing normalized sheet/atlas exports without relying on filenames.

Animation timing is presentation metadata. Attack damage, mana consumption, shared recovery, cooldowns, and respawn timing follow accepted authority events and deadlines, not animation frames.

## Facing, layers, and attachment points

- V1 source frames face right. Render left-facing characters by mirroring the complete assembly around its ground point; mirror attachment/effect positions with it.
- Each appearance declares one rig family and exactly one body layer. Hair, face, and cosmetic overlays can be added from compatible assets later.
- Layers have distinct numeric draw orders. The default placeholder body uses order 10; render the equipped weapon overlay above it, using order 20 as the initial rendering convention.
- Weapon graphics are referenced by item definitions and are resolved from observed equipment. They are not permanently baked into a player's appearance selection.
- V1 uses frame-aligned overlays: rig family, canvas/frame geometry, ground anchor, scale, facing, clip names/sequences, and timing match the body. Validation checks compatibility for appearance layers and available weapons.
- Named attachment points contain a frame index and frame-local pixel position. `weapon_hand` is the sample socket name for hand/effect placement. Attachment names must be unique per frame. Additional moving frames require their own socket positions when the effect uses that socket.
- Cosmetic shape, tint, and layer order do not change hit distance, stats, speed, or walk bounds.

## Explicit placeholder metadata

No original art or audio files are available in M1. Every asset manifest entry is `status: "placeholder"` with a reason, and contains no invented path or attribution. Referenced asset IDs exist, so unresolved artwork is distinguishable from a broken content reference.

The sample includes **provisional metadata only**:

| Sprite family | Sheet/frame size | Ground anchor | Scale |
| --- | --- | --- | --- |
| `guardian_v1`, including both weapon overlays | 128×128 pixels | (64,112) | 1 world unit/pixel |
| `thornling_v1` | 64×64 pixels | (32,56) | 1 world unit/pixel |
| `mira_v1` | 96×128 pixels | (48,112) | 1 world unit/pixel |

Every placeholder clip references only frame 0 at 100 ms/frame. Idle and walk loop; other clips do not. The sample Guardian socket is frame 0 at (84,64). These values exercise contract structure and compatibility; they are not final artwork dimensions, animation pacing, or available sprite sheets. Agree final metadata during original asset production without changing gameplay values.

An M2 preview may render explicitly labeled geometric stand-ins for unresolved assets. It must not attempt to load a placeholder as a real texture or sound.

## Ready assets

Ready entries include a pack-relative `assets/` file path, SHA-256 checksum, creator, original source, license/attribution, and `original: true`. Preserve editable source artwork/audio separately from prepared runtime files.

The CLI verifies ready-file existence/checksums and confines resolved paths to the pack. Browser validation checks manifest structure and cross-references. `--require-ready-assets` rejects placeholders; future publication also needs immutable release packaging, asset provenance review, runtime compatibility, and staged verification.

Stable asset IDs do not depend on filenames. A new asset import cannot reuse an existing definition ID. No AQW art, characters, maps, interface artwork, or audio is supplied or required by this sample.
