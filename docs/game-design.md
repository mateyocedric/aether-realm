# Dawnwell Glade — First Multiplayer Slice

## Purpose and milestone

This document is the Phase 1 specification for an original, AQW-inspired browser multiplayer RPG. It defines the first playable target for **Next.js + TypeScript + Phaser + SpacetimeDB**.

The central playtest question is: **is exploring and fighting alongside another player enjoyable?**

The introduction should take approximately **5–10 minutes** through learning the controls, meeting Keeper Mira, fighting, returning to the shrine, and equipping a reward. It must be playable alone; a second player makes shared encounters faster without reducing either player's rewards. Actual pacing will be measured during playtests.

Phase 1 delivers this specification, the map layout, original asset requirements, and acceptance scenarios. Phase 2 establishes the application, backend, and development environment. The later playable slice includes one shared map, one class, one enemy type, one quest, inventory, equipment, saved progress, room chat, and reconnect support.

### Defaults and boundaries

- Desktop-first mouse and keyboard controls.
- One shared room, capped at **eight characters**, including disconnected characters retained during the reconnect grace period. A full room shows a retryable room-full message.
- Fixed enemy strength, deterministic personal rewards, and a maximum character level of 3.
- Bright, illustrated fantasy with original artwork, names, maps, and audio.
- Trading, PvP, guilds, crafting, marketplaces, and monetization are deferred. Additional maps, parties, and dungeon instances belong to later milestones.

## Adventure and visual direction

**Dawnwell Glade** is a woodland clearing surrounding a luminous aether shrine. Corrupted **Thornlings**, small creatures of tangled roots and cracked aether crystals, inhabit the clearing. **Keeper Mira** asks adventurers to recover shards to help sustain the shrine.

The Guardian is a readable, sword-wielding silhouette with practical armor and a bright aether accent. Use illustrated shapes, warm greens and gold around the shrine, and cooler violet corruption around the Thornlings. The side-view scene has a shallow ground plane rather than platforming or jumping. Selection outlines, health bars, and action feedback must remain readable against the environment.

The core loop is:

1. Enter as a browser guest and create the single Guardian character for that identity.
2. Meet Keeper Mira at the safe shrine and accept the quest.
3. Move into the clearing, select a Thornling, and fight alone or alongside another player.
4. Earn personal XP, gold, and quest shards from contributed kills.
5. Return to Mira, complete the quest, and equip the Dawnwell Blade.
6. Continue fighting toward level 3, chat with nearby players, and reconnect with progress intact.

Quest completion is personal character progress. It does not change the shared map or complete the quest for other characters.

## Map and movement

### Coordinate system and layout

The fixed scene is **1280×720 world units**, with its origin at the top-left. X increases rightward and Y increases downward. Positions refer to the character's ground point at its feet; combat distance uses these positions.

Walkable ground is the inclusive rectangle **x=64–1216, y=440–640**. The safe shrine occupies the portion with **x≤400**. Combat takes place at **x>400**.

```text
                        DAWNWELL GLADE
                         1280 × 720

          Illustrated woodland and shrine backdrop

  y=440  +--------------------+----------------------------------+
         |    SAFE SHRINE      |          COMBAT CLEARING         |
         |                    |                       T3          |
         |                    |     T1                            |
         |       Mira         |                                  |
         |    Player spawn    |                                  |
         |                    |            T2              T4    |
  y=640  +--------------------+----------------------------------+
       x=64                 x=400                              x=1216
```

The schematic labels the areas; the following coordinates define placement:

| Landmark | Ground position | Purpose |
| --- | --- | --- |
| Player spawn | (160, 540) | First entry and death respawn |
| Keeper Mira | (260, 540) | Dialogue, quest acceptance, and turn-in |
| T1 | (560, 490) | Thornling spawn |
| T2 | (750, 600) | Thornling spawn |
| T3 | (960, 480) | Thornling spawn |
| T4 | (1130, 600) | Thornling spawn |
| Safe boundary | x=400 | Visible transition from shrine to clearing |

Keep blocking scenery outside the walkable rectangle. Decorative ground markings must preserve the appearance of traversable ground. Characters and enemies pass through each other, so another player cannot block movement.

### Movement rules

- Clicking ground requests a destination. Finite destinations outside the walking rectangle are clamped to its nearest point; malformed coordinates are rejected.
- Guardians move at **180 world units per second**, including diagonal movement. Movement follows a straight segment within the rectangle.
- The backend controls position and speed. A client sends destinations rather than authoritative positions or elapsed time.
- Phaser renders movement smoothly between authoritative updates and sorts character depth by ground-position Y.
- Ground movement cancels a pending attack while retaining the selected target. Room exit, disconnection, and death stop movement and cancel pending actions.
- The shrine prevents combat across its boundary: enemies cannot enter it, attack a character inside it, or be attacked by a character standing inside it.

## Controls and interface

| Input | Behavior |
| --- | --- |
| Ground click | Move to the requested destination |
| Enemy click | Select that enemy and display its health; selection alone does not attack |
| Space | Request one basic attack |
| 1 | Request Heavy Strike against the selected enemy |
| 2 | Use Mend on self |
| Action buttons | Perform the same actions as Space, 1, and 2 |
| Keeper Mira click | Open dialogue when within 64 units; otherwise show an approach prompt |
| Enter in chat | Focus chat or submit the typed message |

React provides the character health/mana display, selected-enemy health, action buttons and cooldowns, inventory/equipment panel, quest tracker, dialogue, chat, and connection status. Phaser owns the scene, characters, effects, selection marker, and movement rendering.

Clicks handled by panels do not reach the game world. Text input suppresses gameplay shortcuts, and Space does not scroll the page when used as a game control. Holding an attack key does not generate repeated attacks.

Chat is room-scoped plain text. A disconnected client cannot send messages or gameplay commands. Show clear feedback for missing targets, cooldowns, recovery, insufficient mana, and connection loss.

## Guardian class and combat

### Starting character and derived stats

A new Guardian starts at level 1 with **0 XP**, **0 gold**, full health and mana, and a Training Blade already equipped.

| Stat | Level 1 value | Progression |
| --- | ---: | --- |
| Maximum health | 120 | +20 per level |
| Maximum mana | 60 | Unchanged in this slice |
| Intrinsic attack | 10 | +2 per level |
| Equipped attack | 12 | Intrinsic attack + Training Blade's +2 |
| Defense | 2 | Unchanged in this slice |
| Movement speed | 180 | World units per second |
| Melee range | 64 | Ground-point distance |

Equipment bonuses are derived from the equipped item once. Replacing a weapon replaces its bonus rather than adding both bonuses.

### Actions

| Action | Effect | Mana cost | Cooldown |
| --- | --- | ---: | ---: |
| Basic attack | One melee hit: `max(1, attack − target defense)` | 0 | 1.2 seconds |
| Heavy Strike | One melee hit: `max(1, 2 × attack − target defense)` | 12 | 6 seconds |
| Mend | Restore 36 health to self, capped at maximum health | 18 | 10 seconds |

At level 1 with the Training Blade, a basic attack deals **10** damage and Heavy Strike deals **22** damage to a Thornling. A Thornling's attack deals **8** damage to that Guardian.

### Manual attacks and pending actions

- Each accepted attack input requests exactly one strike. There is no automatic attack loop.
- Basic attack and Heavy Strike require a living selected enemy in the same room. If it is outside melee range, approach it and execute the requested attack once when in range.
- Keep at most one pending action. A new valid attack request replaces the previous pending request; it does not create a queue.
- Ground movement, target changes, target death, player death, room exit, and disconnection cancel pending attacks.
- At execution, validate the target, room, safe boundary, range, mana, cooldown, and shared recovery again. Stop movement before applying the action.
- Spend mana and start cooldowns only when the action executes. An approach request reserves neither mana nor cooldowns.
- Reject inputs during their cooldown or shared recovery. Rejected inputs do not replace an existing valid pending action.
- Each executed action blocks all three actions for **0.3 seconds** of shared recovery, independently of their individual cooldowns.
- A valid Mend stops movement, cancels the pending attack, and heals self. It does not need an enemy target.
- Death disables actions and movement until respawn.

### Recovery and death

Out of combat means no enemy is pursuing the character and at least **six seconds** have passed since the character last dealt or took damage. While out of combat, restore **6 health and 6 mana per second**, capped at their maxima. Use elapsed server time for recovery.

At zero health, the character dies and stops acting. After **five seconds**, respawn at (160,540) with full health and mana. Preserve XP, gold, inventory, equipment, and quest progress. Ability cooldown deadlines continue through death; respawning does not reset them.

## Thornling behavior and shared encounters

| Property | Value |
| --- | ---: |
| Maximum health | 150 |
| Attack | 10 |
| Defense | 2 |
| Movement speed | 130 units/second |
| Melee range | 64 units |
| Attack interval | 2 seconds |
| Spawn leash | 240 units |
| Respawn delay | 10 seconds |
| Personal kill reward | 25 XP and 5 gold |

- Each of the four placements is an independent enemy instance using the same definition. An idle Thornling stays at its spawn and engages when damaged.
- The first damaging attacker becomes its target. It approaches that target and makes one melee attack every two seconds while in range; its first attack is available two seconds after engagement.
- Thornlings remain within the walkable bounds, outside the safe shrine, and within 240 units of their own spawn.
- A target is invalid if dead, removed from the room, inside the shrine, or outside the spawn leash. Select the nearest living contributor still in the room and valid area; break equal-distance ties by character ID.
- A disconnected character retained during the reconnect grace period remains a valid target and can take damage.
- With no valid target, return home and reset to full health. Clear that encounter's contribution records. It becomes available for a fresh encounter on reaching home.
- Defeat resolves rewards once, clears targeting, and starts a ten-second respawn timer. The respawn starts a new encounter identity so old requests or contributions cannot apply to it.

Every character that dealt damage in the current encounter and remains in the room when it ends receives the full personal reward. Death and respawn preserve contribution credit for that encounter. A retained disconnected character can receive rewards. Actual room exit/removal and enemy reset clear participation.

There is no first-hit ownership, damage-weighted division, or shared loot pickup. Simultaneous lethal actions must yield one enemy defeat and one reward grant per eligible character.

## Quest, inventory, and levels

### Quest: Steady the Dawnwell

Keeper Mira explains the shrine and asks the player to collect **five Aether Shards**.

- The quest states are available, active, and completed.
- Only contributed kills after acceptance grant shards. Each eligible Thornling defeat grants one shard while the quest is active, alongside its normal XP and gold.
- Shards are personal inventory items that stack in one slot. The tracker displays progress toward five shards.
- Turn-in requires the active quest, at least five shards, and proximity within 64 units of Mira.
- Completion consumes five shards and atomically grants **50 XP**, **25 gold**, and one **Dawnwell Blade**, then marks the quest completed.
- Completion is one-time. Repeated turn-in requests grant no additional reward, and completed quests stop granting shards.
- Any extra shards already collected remain in inventory. They have no additional use in this slice.

### Items and equipment

| Stable ID | Item | Behavior |
| --- | --- | --- |
| `training_blade` | Training Blade | Starting weapon; +2 attack |
| `dawnwell_blade` | Dawnwell Blade | Guaranteed quest weapon; +5 attack |
| `aether_shard` | Aether Shard | Stackable quest material |

The inventory has **twelve slots** and equipment has **one weapon slot**. Owned weapons remain inventory items when equipped. Equipping the Dawnwell Blade returns the Training Blade to unequipped ownership. Equipment changes require a living, out-of-combat character and cannot reset resources or cooldowns.

The initial content occupies at most three inventory slots: two distinct weapons and one shard stack.

### Level progression

XP is cumulative. Level 1 starts at 0 XP; level 2 requires **100 XP**; level 3 requires **300 XP**. Clamp cumulative XP at 300 for this slice; gold rewards continue at the level cap.

| Level | Cumulative XP threshold | Maximum health | Intrinsic attack | With Training Blade | With Dawnwell Blade |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 0 | 120 | 10 | 12 | 15 |
| 2 | 100 | 140 | 12 | 14 | 17 |
| 3 | 300 | 160 | 14 | 16 | 19 |

Leveling increases maximum health and intrinsic attack without refilling health or mana. Five quest kills and turn-in grant a fresh character **175 cumulative XP and 50 gold**, leaving it at level 2. Five further kills reach the level-3 cap.

## Multiplayer, persistence, and technical contracts

### Ownership and synchronization

- Phaser owns the game loop, scene lifecycle, asset loading, animation, and interpolation. React owns panels and menus. Use a typed bridge for UI intentions and observed game state.
- Load the Phaser host from a Next.js client component with server rendering disabled. Next.js documents the client-component restriction for `ssr: false` in its [lazy-loading guidance](https://nextjs.org/docs/app/guides/lazy-loading).
- Use a TypeScript SpacetimeDB server module and generated TypeScript client bindings. TypeScript server modules are supported by the official [language documentation](https://spacetimedb.com/docs/intro/language-support/).
- The backend validates destinations, movement speed, ownership, attacks, cooldowns, mana, enemy AI, drops, and rewards. Clients send intentions and never determine damage, XP, gold, or item grants.
- Keep personal progression and inventory records private. Expose caller-authorized personal views and current-room state based on server-owned membership. Client subscription filters do not establish authorization. SpacetimeDB's [view documentation](https://spacetimedb.com/docs/functions/views/) describes caller-aware views.
- Subscribe to the entire current room and the caller's authorized personal data. Ignore commands until initial subscriptions or reconnect subscriptions are ready.
- Use server timestamps for movement integration, cooldowns, regeneration, death, and respawn deadlines. Scheduled work must tolerate missed ticks; see [schedule tables](https://spacetimedb.com/docs/tables/schedule-tables/).
- Reward resolution, quest item consumption, quest completion, and equipment changes must be atomic and validated against the authenticated owner.

### Reusable content definitions

Use reusable `ClassDefinition`, `EnemyDefinition`, `ItemDefinition`, `QuestDefinition`, and `MapDefinition` contracts with stable IDs. Definitions contain the configuration in this document; character ownership and encounter state reference them rather than duplicating their behavior per instance.

| Definition | Stable ID | Required content |
| --- | --- | --- |
| Class | `guardian` | Base stats, level increments, and action IDs |
| Actions | `basic_attack`, `heavy_strike`, `mend` | Effect, cost, range, cooldown, and recovery |
| Enemy | `thornling` | Stats, movement, leash, attacks, respawn, and rewards |
| Items | IDs listed above | Name, kind, stacking behavior, and weapon bonus |
| Quest | `steady_the_dawnwell` | NPC, required item/count, prerequisites, and completion rewards |
| Map | `dawnwell_glade` | World size, walk bounds, safe boundary, player/NPC positions, and enemy placements |
| NPC | `keeper_mira` | Original appearance, dialogue, and associated quest |

Exact database schemas, dependency versions, and deployment configuration are Phase 2 work. The gameplay values and authority boundaries in this document are the implementation target.

### Saved progress and runtime lifecycle

| State | Lifecycle |
| --- | --- |
| Identity, character name, class, XP/level, gold, inventory, equipment, quest state | Saved character progress; survives reload and reconnect |
| Room presence, position, movement, selected target, pending action, enemy aggro, encounter participation | Room runtime; explicitly created, cancelled, reset, or removed |
| Health, mana, cooldown and recovery deadlines, last-damage time, respawn deadline | Character recovery runtime; retained as needed to prevent reconnect resets |
| Enemy instances and respawn deadlines | Room runtime, with a fresh encounter identity after reset/respawn |
| Room chat | Room session state; not character progression |

Runtime describes the lifecycle, not an assumption that database rows are automatically transient. Room and recovery records require explicit cleanup. Persist enough recovery state to preserve resource and cooldown rules across room removal and reconnect.

### Guest identity and reconnection

- Reuse the returned authentication token in the same browser to recover the same identity and character. Clearing that token or using another browser creates a different guest identity; cross-device recovery is deferred.
- On connection loss, disable local commands, stop movement, cancel the pending action, and show reconnect status. The character remains stationary and vulnerable in its room for **30 seconds**.
- Reconnecting within that window resumes the same character state after subscriptions are ready. Do not replay stale commands or reset resources and cooldowns.
- After the grace period, remove room presence and contribution credit. A later reconnect enters at the shrine, subject to room capacity, with saved progress intact.
- Room removal alone does not refill health/mana or shorten cooldowns. Recovery may advance only under the normal out-of-combat rules; a dead character follows its existing five-second respawn deadline.

## Original asset requirements

| Asset group | Required assets |
| --- | --- |
| Map | One 1280×720 composition with woodland backdrop, shrine, safe-boundary landmark, and readable clearing; scenery outside the walk plane |
| Guardian | Idle, walk, basic strike, heavy strike, mend, and death animations; consistent ground anchor and mirrored left/right facing |
| Thornling | Idle, walk/chase, attack, hit reaction, and death animations |
| Keeper Mira | Original NPC illustration/sprite, idle appearance, and dialogue portrait |
| Effects | Movement destination marker, target marker, hit feedback, heavy-strike effect, mend effect, and respawn effect |
| Interface | Three action icons, two weapon icons, shard icon, health/mana/cooldown indicators, and quest-state indicators |
| Audio | Woodland ambience or music, attack/hit, heavy strike, mend, enemy defeat, quest completion, and interface feedback sounds |

Artwork and audio must be original to this project. Record creators, source files, and any applicable licenses or attribution for commissioned or supplied original assets. Do not reuse AQW characters, sprites, maps, names, music, or interface artwork. Preserve AQW-inspired social scene staging while developing the project's own visual identity.

## Acceptance scenarios

These are requirements for the later playable slice. Phase 1 completion means they are documented; it does not mean runtime behavior has already been tested.

| Scenario | Expected outcome |
| --- | --- |
| Two fresh browser identities | Both enter the same room, see one another move, accept the quest, contribute to five shared kills, receive independent rewards, and equip their own Dawnwell Blade |
| Movement boundaries and speed | Finite out-of-bounds destinations clamp correctly; malformed requests fail; diagonal movement respects speed 180; player bodies cannot block each other |
| Safe shrine | Thornlings remain outside it and neither side can attack across the safe boundary |
| Target selection | Clicking an enemy selects it and displays health without dealing damage |
| One manual input | One input produces one strike; holding the key does not repeat it; an out-of-range input approaches and strikes once |
| Pending-action cancellation | Ground movement, retargeting, death, target death, room exit, or disconnect prevents the pending strike |
| Invalid combat requests | Cooldown/recovery spam, missing/dead targets, insufficient mana, and invalid range at execution produce no damage, resource charge, or reward |
| Baseline combat arithmetic | Level-1 Training Blade basic attack deals 10, Heavy Strike deals 22, and a Thornling hit deals 8; Mend restores at most 36 |
| Enemy pursuit and reset | First attacker is pursued; invalid targets retarget to a valid contributor; no valid contributors cause a return/reset and clear prior credit |
| Simultaneous lethal attacks | One defeat is resolved and every eligible contributor is rewarded exactly once |
| Contributor death | Death and respawn preserve the character's credit for an encounter that ends while it remains in the room |
| Death and recovery | Death respawns after five seconds with full resources and preserved progress; cooldowns continue; regeneration requires both inactivity and no pursuing enemy |
| Quest turn-in | Five shards are consumed and XP, gold, blade, and completed status commit together; repeating the request produces no extra reward |
| Progression and equipment | Five kills plus turn-in yield level 2, 175 XP, and 50 gold; equipping the reward yields 17 attack; five further kills reach level 3 |
| Short reconnect | Reconnect during movement or combat within 30 seconds restores authoritative state, preserves damage taken and deadlines, and does not execute a cancelled attack |
| Late reconnect | Presence expires after 30 seconds; re-entry occurs at the shrine with saved progress and no reconnect-triggered resource or cooldown reset |
| Saved state and privacy | Reload preserves progression, inventory, equipment, and quest completion; another identity cannot read or mutate private character data |
| Chat and panels | Messages reach the current room; typing and panel clicks do not trigger movement or attacks; connection loss disables submission |
| Room capacity | The ninth character cannot enter until a slot is free; reconnect grace-period presence counts toward the cap |
| First-session playtest | Players understand movement, targeting, and both skills within two minutes; finish the introduction in roughly 5–10 minutes; and can identify how another player helped |

Phase 1 is complete when this document contains the agreed rules, labeled map, content IDs, asset list, and acceptance scenarios. Combat tuning and pacing changes should update this specification when supported by playtest evidence.
