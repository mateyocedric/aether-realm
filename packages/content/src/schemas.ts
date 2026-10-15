import { z } from 'zod';

// No coercion, defaults, or unknown fields: authoring errors must stay visible.
export const contentIdSchema = z.string().regex(/^[a-z][a-z0-9_]*$/);
const text = z.string().refine(value => value.trim().length > 0, 'Must contain text');
const number = z.number().finite();
const count = number.int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const positiveCount = count.positive();
const positive = number.positive();
const id = contentIdSchema;
const header = { id, name: text };
export const pointSchema = z.strictObject({ x: number, y: number });
export const rectangleSchema = z.strictObject({ minX: number, maxX: number, minY: number, maxY: number });
const itemGrant = z.strictObject({ itemId: id, count: positiveCount });
export const rewardSchema = z.strictObject({ xp: count, gold: count, items: z.array(itemGrant) });
const stats = z.strictObject({ maxHealth: positiveCount, maxMana: count, attack: count, defense: count });

const assetKind = z.enum(['background', 'sprite_sheet', 'icon', 'portrait', 'effect', 'audio']);
const relativePath = z.string().refine(
  value => /^assets\/[a-zA-Z0-9_./-]+$/.test(value) && !value.split('/').some(part => part === '..' || part === '' || part === '.'),
  'Must be a safe pack-relative assets/ path',
);
export const assetSchema = z.discriminatedUnion('status', [
  z.strictObject({ ...header, kind: assetKind, status: z.literal('placeholder'), reason: text }),
  z.strictObject({
    ...header, kind: assetKind, status: z.literal('ready'), path: relativePath,
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    provenance: z.strictObject({ original: z.literal(true), creator: text, source: text, license: text }),
  }),
]);

export const animationNameSchema = z.enum(['idle', 'walk', 'basic_attack', 'heavy_strike', 'mend', 'death', 'attack', 'hit']);
export const animationClipSchema = z.strictObject({
  name: animationNameSchema, frames: z.array(count).min(1), frameDurationMs: positiveCount, loop: z.boolean(),
});
export const spriteSchema = z.strictObject({
  ...header, assetId: id, rigFamily: id,
  sheet: z.strictObject({ widthPx: positiveCount, heightPx: positiveCount }),
  frames: z.array(z.strictObject({
    index: count, x: count, y: count, width: positiveCount, height: positiveCount,
  })).min(1),
  groundAnchorPx: pointSchema,
  worldUnitsPerPixel: positive,
  facing: z.strictObject({ source: z.literal('right'), left: z.literal('mirror_x') }),
  clips: z.array(animationClipSchema).min(1),
  attachments: z.array(z.strictObject({ name: id, frame: count, positionPx: pointSchema })),
});
export const appearanceSchema = z.strictObject({
  ...header, rigFamily: id,
  layers: z.array(z.strictObject({
    slot: z.enum(['body', 'hair', 'face', 'cosmetic']), spriteId: id, order: count,
  })).min(1),
  palette: z.array(z.strictObject({ channel: id, color: z.string().regex(/^#[a-fA-F0-9]{6}$/) })),
});

export const mapSchema = z.strictObject({
  ...header,
  world: z.strictObject({ width: positive, height: positive, origin: z.literal('top_left') }),
  backgroundAssetId: id, walkable: rectangleSchema,
  presentation: z.strictObject({ destinationMarkerAssetId: id, selectionMarkerAssetId: id }).optional(),
  safeArea: z.strictObject({ kind: z.literal('x_at_or_below'), boundaryX: number, blockCombatBothWays: z.literal(true) }),
  playerSpawn: pointSchema,
  enemies: z.array(z.strictObject({ id, enemyId: id, position: pointSchema })),
  npcs: z.array(z.strictObject({ id, npcId: id, position: pointSchema })),
});

const meleeEffect = z.strictObject({ kind: z.literal('melee_damage'), attackMultiplier: positive, minimumDamage: z.literal(1) });
const healEffect = z.strictObject({ kind: z.literal('self_heal'), amount: positiveCount, capAtMaxHealth: z.literal(true) });
const skillCommon = { ...header, manaCost: count, cooldownMs: count, recoveryMs: count, iconAssetId: id, effectAssetId: id, soundAssetId: id };
export const skillSchema = z.discriminatedUnion('target', [
  z.strictObject({ ...skillCommon, target: z.literal('selected_enemy'), range: positive, effect: meleeEffect }),
  z.strictObject({ ...skillCommon, target: z.literal('self'), effect: healEffect }),
]);
export const classSchema = z.strictObject({
  ...header, baseStats: stats,
  perLevel: z.strictObject({ maxHealth: count, attack: count }),
  movementSpeed: positive, meleeRange: positive, skillIds: z.array(id).min(1),
  progression: z.strictObject({
    levels: z.array(z.strictObject({ level: positiveCount, cumulativeXp: count })).min(1),
    levelCap: positiveCount, xpCap: count, xpMode: z.literal('cumulative_clamped'),
    refillResourcesOnLevelUp: z.literal(false),
  }),
});
export const itemSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    ...header, kind: z.literal('weapon'), stackable: z.literal(false), slot: z.literal('weapon'),
    attackBonus: count, iconAssetId: id, visualSpriteId: id,
  }),
  z.strictObject({ ...header, kind: z.literal('quest_material'), stackable: z.literal(true), stacking: z.literal('one_slot_per_item_id'), iconAssetId: id }),
]);

export const enemySchema = z.strictObject({
  ...header, spriteId: id, stats: z.strictObject({ maxHealth: positiveCount, attack: count, defense: count }), movementSpeed: positive,
  attack: z.strictObject({ effect: meleeEffect, range: positive, intervalMs: positiveCount, firstAttackDelayMs: count }),
  behavior: z.strictObject({
    kind: z.literal('first_attacker_pursuit'), idle: z.literal('at_spawn'), engageOn: z.literal('damage'),
    retarget: z.literal('nearest_living_contributor_in_spawn_leash'), tieBreak: z.literal('character_id'),
    leash: positive, respectSafeArea: z.literal(true), respectWalkBounds: z.literal(true),
    reset: z.literal('return_home_full_health_clear_contributions'), freshEncounterOnReset: z.literal(true),
    freshEncounterOnRespawn: z.literal(true),
  }),
  respawnMs: positiveCount, rewards: rewardSchema,
  questDrops: z.array(z.strictObject({
    questId: id, itemId: id, count: positiveCount,
    condition: z.literal('active_quest_contributed_kill_after_acceptance'),
  })),
});

export const questStateSchema = z.enum(['available', 'active', 'completed']);
export const questSchema = z.strictObject({
  ...header, prerequisites: z.array(id),
  states: z.tuple([z.literal('available'), z.literal('active'), z.literal('completed')]),
  objective: z.strictObject({ kind: z.literal('contributed_enemy_item_collection'), enemyId: id, itemId: id, count: positiveCount }),
  turnIn: z.strictObject({ npcId: id, range: positive, consume: z.array(itemGrant).min(1), rewards: rewardSchema }),
  completion: z.literal('once_per_character_atomic'), surplusItems: z.literal('retain'),
  sharedMapChanges: z.literal(false),
});
export const npcSchema = z.strictObject({
  ...header, appearanceId: id, portraitAssetId: id, dialogueId: id,
  interactionRange: positive, outOfRange: z.literal('approach_prompt'), questIds: z.array(id),
});
const dialogueCondition = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('always') }),
  z.strictObject({ kind: z.literal('quest_state'), questId: id, state: questStateSchema }),
]);
const dialogueAction = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('accept_quest'), questId: id }),
  z.strictObject({ kind: z.literal('turn_in_quest'), questId: id }),
]);
export const dialogueSchema = z.strictObject({
  ...header, npcId: id, entryNodeId: id,
  nodes: z.array(z.strictObject({
    id, text,
    choices: z.array(z.strictObject({
      id, text, condition: dialogueCondition, action: dialogueAction.nullable(), nextNodeId: id.nullable(),
    })),
  })).min(1),
});
export const characterSchema = z.strictObject({
  ...header, classId: id, appearanceId: id, initialMapId: id,
  startingLevel: z.literal(1), startingXp: z.literal(0), startingGold: z.literal(0),
  startingResources: z.literal('full'), inventory: z.array(itemGrant),
  equipment: z.strictObject({ weaponItemId: id }),
});

export const rulesSchema = z.strictObject({
  movement: z.strictObject({
    input: z.literal('click_to_move'), path: z.literal('straight_line'), position: z.literal('ground_point'),
    invalidDestination: z.literal('clamp_finite_reject_malformed'), diagonalSpeed: z.literal('normalized'),
    collision: z.literal('pass_through'), renderDepth: z.literal('ground_y'),
    groundMoveRetainsSelection: z.literal(true),
  }),
  combat: z.strictObject({
    input: z.literal('one_press_one_action'), selectionAttacks: z.literal(false), keyRepeat: z.literal('ignore'),
    approach: z.literal('approach_then_strike_once'), distance: z.literal('euclidean_ground_points'),
    maxPendingActions: z.literal(1), pendingReplacement: z.literal('valid_request_replaces'),
    cancelPendingOn: z.tuple([z.literal('ground_move'), z.literal('retarget'), z.literal('target_death'), z.literal('death'), z.literal('room_exit'), z.literal('disconnect')]),
    spendAndCooldown: z.literal('at_execution'), rejectedInput: z.literal('preserve_valid_pending'),
    actionExecution: z.literal('stop_movement'), mendCancelsPending: z.literal(true),
    deathDisablesInput: z.literal(true), textInputSuppressesShortcuts: z.literal(true), panelClicksReachWorld: z.literal(false),
  }),
  recovery: z.strictObject({
    outOfCombatDelayMs: count, requireNoPursuingEnemy: z.literal(true), healthPerSecond: count, manaPerSecond: count,
    respawnMs: positiveCount, respawnResources: z.literal('full'), deathProgressLoss: z.literal('none'),
    resetCooldownsOnRespawn: z.literal(false),
  }),
  room: z.strictObject({
    capacity: positiveCount, reconnectGraceMs: positiveCount, identity: z.literal('one_character_per_browser_guest_token'),
    retainedDisconnectedCounts: z.literal(true), retainedDisconnectedVulnerable: z.literal(true),
    disconnectStopsMovement: z.literal(true), disconnectCancelsPending: z.literal(true),
    replayCommandsOnReconnect: z.literal(false), resetResourcesOnReconnect: z.literal(false),
    resetCooldownsOnReconnect: z.literal(false), lateReconnectSpawn: z.literal('map_player_spawn'),
    expiry: z.literal('remove_presence_and_contributions_retain_recovery'), full: z.literal('retryable_rejection'),
  }),
  rewards: z.strictObject({
    eligibility: z.literal('damaging_contributors_remaining_in_room'), distribution: z.literal('full_personal'),
    retainThroughDeath: z.literal(true), retainThroughRespawn: z.literal(true), retainedDisconnectedEligible: z.literal(true),
    clearOnReset: z.literal(true), clearOnRemoval: z.literal(true), resolution: z.literal('once_per_encounter_atomic'),
  }),
  inventory: z.strictObject({
    slots: positiveCount, equipmentSlots: z.tuple([z.literal('weapon')]),
    equippedItemsRemainOwned: z.literal(true), bonuses: z.literal('replace'),
    changesRequire: z.literal('alive_out_of_combat'), changesResetResourcesOrCooldowns: z.literal(false),
  }),
  chat: z.strictObject({ scope: z.literal('room'), format: z.literal('plain_text'), disconnectedCanSend: z.literal(false) }),
  authority: z.literal('server_validated_intentions_and_timestamps'),
});

export const contentPackSchema = z.strictObject({
  manifest: z.strictObject({
    ...header, schemaVersion: z.literal(1), runtimeCompatibility: z.literal('aether_v1'),
    releaseId: id, status: z.literal('sample'),
  }),
  rules: rulesSchema,
  assets: z.array(assetSchema), sprites: z.array(spriteSchema), appearances: z.array(appearanceSchema),
  characters: z.array(characterSchema).min(1), maps: z.array(mapSchema).min(1), classes: z.array(classSchema).min(1),
  skills: z.array(skillSchema).min(1), items: z.array(itemSchema), enemies: z.array(enemySchema),
  quests: z.array(questSchema), npcs: z.array(npcSchema), dialogues: z.array(dialogueSchema),
});

export type ContentId = z.infer<typeof contentIdSchema>;
export type Point = z.infer<typeof pointSchema>;
export type Rectangle = z.infer<typeof rectangleSchema>;
export type AssetDefinition = z.infer<typeof assetSchema>;
export type AnimationName = z.infer<typeof animationNameSchema>;
export type AnimationClip = z.infer<typeof animationClipSchema>;
export type SpriteDefinition = z.infer<typeof spriteSchema>;
export type AppearanceDefinition = z.infer<typeof appearanceSchema>;
export type CharacterDefinition = z.infer<typeof characterSchema>;
export type MapDefinition = z.infer<typeof mapSchema>;
export type ClassDefinition = z.infer<typeof classSchema>;
export type SkillDefinition = z.infer<typeof skillSchema>;
export type ItemDefinition = z.infer<typeof itemSchema>;
export type EnemyDefinition = z.infer<typeof enemySchema>;
export type QuestDefinition = z.infer<typeof questSchema>;
export type NpcDefinition = z.infer<typeof npcSchema>;
export type DialogueDefinition = z.infer<typeof dialogueSchema>;
export type SliceRules = z.infer<typeof rulesSchema>;
export type QuestState = z.infer<typeof questStateSchema>;
export type RewardDefinition = z.infer<typeof rewardSchema>;
export type ContentPack = z.infer<typeof contentPackSchema>;
