import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { validateContentPack } from '../src/index.ts';

// Independently specified regression expectations from docs/game-design.md.
// These test content/configuration, not an implemented combat simulation.
const parsed = validateContentPack(JSON.parse(readFileSync(new URL('../../../content/dawnwell-glade/pack.json', import.meta.url), 'utf8')));
assert.ok(parsed.success);
const pack = parsed.data;

test('Dawnwell retains all source gameplay IDs and exact map coordinates', () => {
  const gameplayIds = [...pack.maps, ...pack.classes, ...pack.skills, ...pack.enemies, ...pack.items, ...pack.quests, ...pack.npcs].map(d => d.id).sort();
  assert.deepEqual(gameplayIds, ['dawnwell_glade', 'guardian', 'basic_attack', 'heavy_strike', 'mend', 'thornling', 'training_blade', 'dawnwell_blade', 'aether_shard', 'steady_the_dawnwell', 'keeper_mira'].sort());
  const map = pack.maps[0]!;
  assert.deepEqual(map.world, { width: 1280, height: 720, origin: 'top_left' });
  assert.deepEqual(map.walkable, { minX: 64, maxX: 1216, minY: 440, maxY: 640 });
  assert.deepEqual(map.safeArea, { kind: 'x_at_or_below', boundaryX: 400, blockCombatBothWays: true });
  assert.deepEqual(map.playerSpawn, { x: 160, y: 540 });
  assert.deepEqual(map.enemies.map(e => [e.enemyId, e.position]), [
    ['thornling', { x: 560, y: 490 }], ['thornling', { x: 750, y: 600 }],
    ['thornling', { x: 960, y: 480 }], ['thornling', { x: 1130, y: 600 }],
  ]);
  assert.deepEqual(map.npcs.map(n => [n.npcId, n.position]), [['keeper_mira', { x: 260, y: 540 }]]);
});

test('Guardian stats, progression, actions, and equipment reproduce the source arithmetic', () => {
  const guardian = pack.classes[0]!;
  assert.deepEqual(guardian.baseStats, { maxHealth: 120, maxMana: 60, attack: 10, defense: 2 });
  assert.deepEqual(guardian.perLevel, { maxHealth: 20, attack: 2 });
  assert.equal(guardian.movementSpeed, 180); assert.equal(guardian.meleeRange, 64);
  assert.deepEqual(guardian.skillIds, ['basic_attack', 'heavy_strike', 'mend']);
  assert.deepEqual(guardian.progression, {
    levels: [{ level: 1, cumulativeXp: 0 }, { level: 2, cumulativeXp: 100 }, { level: 3, cumulativeXp: 300 }],
    levelCap: 3, xpCap: 300, xpMode: 'cumulative_clamped', refillResourcesOnLevelUp: false,
  });
  assert.deepEqual(pack.skills.map(s => [s.id, s.target, s.manaCost, s.cooldownMs, s.recoveryMs, s.effect]), [
    ['basic_attack', 'selected_enemy', 0, 1200, 300, { kind: 'melee_damage', attackMultiplier: 1, minimumDamage: 1 }],
    ['heavy_strike', 'selected_enemy', 12, 6000, 300, { kind: 'melee_damage', attackMultiplier: 2, minimumDamage: 1 }],
    ['mend', 'self', 18, 10000, 300, { kind: 'self_heal', amount: 36, capAtMaxHealth: true }],
  ]);
  for (const skill of pack.skills) if (skill.target === 'selected_enemy') assert.equal(skill.range, 64);
  const bonuses = pack.items.filter(i => i.kind === 'weapon').map(i => [i.id, i.attackBonus]);
  assert.deepEqual(bonuses, [['training_blade', 2], ['dawnwell_blade', 5]]);
  const attack = guardian.baseStats.attack + 2;
  assert.equal(attack, 12);
  assert.equal(Math.max(1, attack - pack.enemies[0]!.stats.defense), 10);
  assert.equal(Math.max(1, 2 * attack - pack.enemies[0]!.stats.defense), 22);
  assert.equal(Math.max(1, pack.enemies[0]!.stats.attack - guardian.baseStats.defense), 8);
  assert.equal(guardian.baseStats.attack + guardian.perLevel.attack + 5, 17);
});

test('Thornling parameters and contributor reward semantics match the specification', () => {
  const enemy = pack.enemies[0]!;
  assert.deepEqual(enemy.stats, { maxHealth: 150, attack: 10, defense: 2 });
  assert.equal(enemy.movementSpeed, 130);
  assert.deepEqual(enemy.attack, { effect: { kind: 'melee_damage', attackMultiplier: 1, minimumDamage: 1 }, range: 64, intervalMs: 2000, firstAttackDelayMs: 2000 });
  assert.deepEqual(enemy.behavior, {
    kind: 'first_attacker_pursuit', idle: 'at_spawn', engageOn: 'damage',
    retarget: 'nearest_living_contributor_in_spawn_leash', tieBreak: 'character_id', leash: 240,
    respectSafeArea: true, respectWalkBounds: true, reset: 'return_home_full_health_clear_contributions',
    freshEncounterOnReset: true, freshEncounterOnRespawn: true,
  });
  assert.equal(enemy.respawnMs, 10000);
  assert.deepEqual(enemy.rewards, { xp: 25, gold: 5, items: [] });
  assert.deepEqual(enemy.questDrops, [{ questId: 'steady_the_dawnwell', itemId: 'aether_shard', count: 1, condition: 'active_quest_contributed_kill_after_acceptance' }]);
  assert.deepEqual(pack.rules.rewards, {
    eligibility: 'damaging_contributors_remaining_in_room', distribution: 'full_personal',
    retainThroughDeath: true, retainThroughRespawn: true, retainedDisconnectedEligible: true,
    clearOnReset: true, clearOnRemoval: true, resolution: 'once_per_encounter_atomic',
  });
});

test('quest, NPC, inventory, and initial character match their exact source requirements', () => {
  const quest = pack.quests[0]!, npc = pack.npcs[0]!, character = pack.characters[0]!;
  assert.deepEqual(quest.prerequisites, []);
  assert.deepEqual(quest.states, ['available', 'active', 'completed']);
  assert.deepEqual(quest.objective, { kind: 'contributed_enemy_item_collection', enemyId: 'thornling', itemId: 'aether_shard', count: 5 });
  assert.deepEqual(quest.turnIn, { npcId: 'keeper_mira', range: 64, consume: [{ itemId: 'aether_shard', count: 5 }], rewards: { xp: 50, gold: 25, items: [{ itemId: 'dawnwell_blade', count: 1 }] } });
  assert.equal(quest.completion, 'once_per_character_atomic'); assert.equal(quest.surplusItems, 'retain'); assert.equal(quest.sharedMapChanges, false);
  assert.equal(npc.interactionRange, 64); assert.equal(npc.outOfRange, 'approach_prompt');
  assert.deepEqual(npc.questIds, ['steady_the_dawnwell']);
  assert.deepEqual(pack.rules.inventory, { slots: 12, equipmentSlots: ['weapon'], equippedItemsRemainOwned: true, bonuses: 'replace', changesRequire: 'alive_out_of_combat', changesResetResourcesOrCooldowns: false });
  assert.equal(character.classId, 'guardian'); assert.equal(character.initialMapId, 'dawnwell_glade');
  assert.equal(character.startingLevel, 1); assert.equal(character.startingXp, 0); assert.equal(character.startingGold, 0); assert.equal(character.startingResources, 'full');
  assert.deepEqual(character.inventory, [{ itemId: 'training_blade', count: 1 }]);
  assert.deepEqual(character.equipment, { weaponItemId: 'training_blade' });
  assert.deepEqual(pack.items.find(i => i.id === 'aether_shard'), { id: 'aether_shard', name: 'Aether Shard', kind: 'quest_material', stackable: true, stacking: 'one_slot_per_item_id', iconAssetId: 'aether_shard_icon' });
  assert.equal(5 * pack.enemies[0]!.rewards.xp + quest.turnIn.rewards.xp, 175);
  assert.equal(5 * pack.enemies[0]!.rewards.gold + quest.turnIn.rewards.gold, 50);
  assert.equal(175 + 5 * pack.enemies[0]!.rewards.xp, 300);
});

test('manual combat, movement, recovery, room, and chat policies retain all source constraints', () => {
  assert.deepEqual(pack.rules.movement, {
    input: 'click_to_move', path: 'straight_line', position: 'ground_point', invalidDestination: 'clamp_finite_reject_malformed',
    diagonalSpeed: 'normalized', collision: 'pass_through', renderDepth: 'ground_y', groundMoveRetainsSelection: true,
  });
  assert.deepEqual(pack.rules.combat, {
    input: 'one_press_one_action', selectionAttacks: false, keyRepeat: 'ignore', approach: 'approach_then_strike_once',
    distance: 'euclidean_ground_points', maxPendingActions: 1, pendingReplacement: 'valid_request_replaces',
    cancelPendingOn: ['ground_move', 'retarget', 'target_death', 'death', 'room_exit', 'disconnect'],
    spendAndCooldown: 'at_execution', rejectedInput: 'preserve_valid_pending', actionExecution: 'stop_movement',
    mendCancelsPending: true, deathDisablesInput: true, textInputSuppressesShortcuts: true, panelClicksReachWorld: false,
  });
  assert.deepEqual(pack.rules.recovery, { outOfCombatDelayMs: 6000, requireNoPursuingEnemy: true, healthPerSecond: 6, manaPerSecond: 6, respawnMs: 5000, respawnResources: 'full', deathProgressLoss: 'none', resetCooldownsOnRespawn: false });
  assert.deepEqual(pack.rules.room, {
    capacity: 8, reconnectGraceMs: 30000, identity: 'one_character_per_browser_guest_token',
    retainedDisconnectedCounts: true, retainedDisconnectedVulnerable: true, disconnectStopsMovement: true, disconnectCancelsPending: true,
    replayCommandsOnReconnect: false, resetResourcesOnReconnect: false, resetCooldownsOnReconnect: false,
    lateReconnectSpawn: 'map_player_spawn', expiry: 'remove_presence_and_contributions_retain_recovery', full: 'retryable_rejection',
  });
  assert.deepEqual(pack.rules.chat, { scope: 'room', format: 'plain_text', disconnectedCanSend: false });
  assert.equal(pack.rules.authority, 'server_validated_intentions_and_timestamps');
});
