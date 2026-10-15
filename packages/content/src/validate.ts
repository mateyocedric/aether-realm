import { contentPackSchema } from './schemas.ts';
import type { ContentPack, Point, RewardDefinition, SpriteDefinition } from './schemas.ts';

export type DiagnosticCode = 'missing_id' | 'duplicate_id' | 'invalid_value' | 'unsupported_behavior'
  | 'missing_reference' | 'invalid_reference' | 'asset_placeholder' | 'unreachable_dialogue' | 'cyclic_prerequisite';
export interface Diagnostic { severity: 'error' | 'warning'; code: DiagnosticCode; path: string; message: string }
export type ValidationResult =
  | { success: true; data: ContentPack; diagnostics: Diagnostic[] }
  | { success: false; diagnostics: Diagnostic[] };

const collections = ['assets', 'sprites', 'appearances', 'characters', 'maps', 'classes', 'skills', 'items', 'enemies', 'quests', 'npcs', 'dialogues'] as const;
type Collection = typeof collections[number];
const playerClips = ['idle', 'walk', 'basic_attack', 'heavy_strike', 'mend', 'death'];

/** Pure browser-safe validation. File existence/hashes are checked by the CLI. */
export function validateContentPack(input: unknown, options: { requireReadyAssets?: boolean } = {}): ValidationResult {
  const diagnostics: Diagnostic[] = [];
  const error = (code: DiagnosticCode, path: string, message: string) => diagnostics.push({ severity: 'error', code, path, message });

  // Detect duplicate global IDs even if another record has a schema error.
  if (typeof input === 'object' && input !== null) {
    const raw = input as Record<string, unknown>;
    const seen = new Map<string, string>();
    const register = (record: unknown, path: string) => {
      if (typeof record !== 'object' || record === null || !('id' in record) || typeof record.id !== 'string') return;
      const first = seen.get(record.id);
      if (first) error('duplicate_id', `${path}.id`, `ID "${record.id}" already defined at ${first}`);
      else seen.set(record.id, `${path}.id`);
    };
    register(raw.manifest, 'manifest');
    for (const group of collections) {
      const records = raw[group];
      if (Array.isArray(records)) records.forEach((record, index) => register(record, `${group}[${index}]`));
    }
  }

  const parsed = contentPackSchema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const last = String(issue.path.at(-1));
      const actual = issue.path.reduce<unknown>((value, key) =>
        typeof value === 'object' && value !== null ? Reflect.get(value, typeof key === 'symbol' ? key : String(key)) : undefined, input);
      const missingId = (actual === undefined || actual === '') && (last === 'id' || last.endsWith('Id'));
      const unsupported = issue.code === 'unrecognized_keys' || ['kind', 'target', 'runtimeCompatibility', 'schemaVersion'].includes(last);
      const code = missingId ? 'missing_id' : unsupported ? 'unsupported_behavior' : 'invalid_value';
      error(code, issue.path.map(String).join('.') || '$', issue.message);
    }
    return { success: false, diagnostics };
  }
  const pack = parsed.data;
  const index = new Map<Collection, Set<string>>(collections.map(group => [group, new Set(pack[group].map(record => record.id))]));
  const ref = (group: Collection, value: string, path: string) => {
    if (!index.get(group)!.has(value)) error('missing_reference', path, `Missing ${group} ID "${value}"`);
  };
  const unique = (values: readonly (string | number)[], path: string) => {
    const seen = new Set<string | number>();
    values.forEach((value, i) => {
      if (seen.has(value)) error('duplicate_id', `${path}[${i}]`, `Duplicate local ID/value "${value}"`);
      seen.add(value);
    });
  };
  const assetRef = (value: string, kind: ContentPack['assets'][number]['kind'], path: string) => {
    ref('assets', value, path);
    const asset = pack.assets.find(asset => asset.id === value);
    if (asset && asset.kind !== kind) error('invalid_reference', path, `Asset "${value}" must be ${kind}, got ${asset.kind}`);
  };
  const grantRefs = (grants: RewardDefinition['items'], path: string) => {
    unique(grants.map(grant => grant.itemId), path);
    grants.forEach((grant, i) => ref('items', grant.itemId, `${path}[${i}].itemId`));
  };
  const rewardRefs = (reward: RewardDefinition, path: string) => grantRefs(reward.items, `${path}.items`);
  const requiredClips = (spriteId: string, required: readonly string[], path: string) => {
    const sprite = pack.sprites.find(sprite => sprite.id === spriteId);
    if (sprite) for (const name of required) {
      if (!sprite.clips.some(clip => clip.name === name)) error('invalid_reference', path, `Sprite "${spriteId}" lacks required clip "${name}"`);
    }
  };
  const compatible = (body: SpriteDefinition, layer: SpriteDefinition, path: string) => {
    const signature = (sprite: SpriteDefinition) => JSON.stringify({
      rig: sprite.rigFamily, sheet: sprite.sheet, frames: [...sprite.frames].sort((a, b) => a.index - b.index),
      anchor: sprite.groundAnchorPx, scale: sprite.worldUnitsPerPixel, facing: sprite.facing,
      clips: [...sprite.clips].sort((a, b) => a.name.localeCompare(b.name)),
    });
    if (signature(body) !== signature(layer)) error('invalid_reference', path, `Sprite "${layer.id}" is not frame/anchor/clip-compatible with "${body.id}"`);
  };

  pack.assets.forEach((asset, i) => {
    if (asset.status === 'placeholder') diagnostics.push({
      severity: options.requireReadyAssets ? 'error' : 'warning', code: 'asset_placeholder',
      path: `assets[${i}]`, message: `${asset.id}: ${asset.reason}`,
    });
  });

  pack.sprites.forEach((sprite, i) => {
    const path = `sprites[${i}]`;
    assetRef(sprite.assetId, 'sprite_sheet', `${path}.assetId`);
    unique(sprite.frames.map(frame => frame.index), `${path}.frames`);
    unique(sprite.clips.map(clip => clip.name), `${path}.clips`);
    unique(sprite.attachments.map(attachment => `${attachment.name}:${attachment.frame}`), `${path}.attachments`);
    for (const frame of sprite.frames) {
      if (frame.x + frame.width > sprite.sheet.widthPx || frame.y + frame.height > sprite.sheet.heightPx)
        error('invalid_value', `${path}.frames`, `Frame ${frame.index} exceeds sheet bounds`);
      if (sprite.groundAnchorPx.x < 0 || sprite.groundAnchorPx.x > frame.width || sprite.groundAnchorPx.y < 0 || sprite.groundAnchorPx.y > frame.height)
        error('invalid_value', `${path}.groundAnchorPx`, `Ground anchor is outside frame ${frame.index}`);
    }
    sprite.clips.forEach((clip, c) => clip.frames.forEach((frame, f) => {
      if (!sprite.frames.some(candidate => candidate.index === frame)) error('missing_reference', `${path}.clips[${c}].frames[${f}]`, `Missing sprite frame ${frame}`);
    }));
    sprite.attachments.forEach((attachment, a) => {
      const frame = sprite.frames.find(frame => frame.index === attachment.frame);
      if (!frame) error('missing_reference', `${path}.attachments[${a}].frame`, `Missing sprite frame ${attachment.frame}`);
      else if (attachment.positionPx.x < 0 || attachment.positionPx.x > frame.width || attachment.positionPx.y < 0 || attachment.positionPx.y > frame.height)
        error('invalid_value', `${path}.attachments[${a}].positionPx`, 'Attachment is outside its local frame');
    });
  });

  pack.appearances.forEach((appearance, i) => {
    const path = `appearances[${i}]`;
    const bodies = appearance.layers.filter(layer => layer.slot === 'body');
    if (bodies.length !== 1) error('invalid_value', `${path}.layers`, 'Appearance needs exactly one body layer');
    unique(appearance.layers.map(layer => layer.order), `${path}.layers.order`);
    unique(appearance.palette.map(channel => channel.channel), `${path}.palette`);
    const body = pack.sprites.find(sprite => sprite.id === bodies[0]?.spriteId);
    appearance.layers.forEach((layer, l) => {
      ref('sprites', layer.spriteId, `${path}.layers[${l}].spriteId`);
      const sprite = pack.sprites.find(sprite => sprite.id === layer.spriteId);
      if (sprite && sprite.rigFamily !== appearance.rigFamily) error('invalid_reference', `${path}.layers[${l}]`, 'Layer rig family differs from appearance');
      if (body && sprite) compatible(body, sprite, `${path}.layers[${l}]`);
    });
  });

  pack.maps.forEach((map, i) => {
    const path = `maps[${i}]`, bounds = map.walkable;
    assetRef(map.backgroundAssetId, 'background', `${path}.backgroundAssetId`);
    if (map.presentation) {
      assetRef(map.presentation.destinationMarkerAssetId, 'effect', `${path}.presentation.destinationMarkerAssetId`);
      assetRef(map.presentation.selectionMarkerAssetId, 'effect', `${path}.presentation.selectionMarkerAssetId`);
    }
    if (bounds.minX < 0 || bounds.minY < 0 || bounds.maxX > map.world.width || bounds.maxY > map.world.height || bounds.minX >= bounds.maxX || bounds.minY >= bounds.maxY)
      error('invalid_value', `${path}.walkable`, 'Walk rectangle must have positive area inside the world');
    if (map.safeArea.boundaryX < bounds.minX || map.safeArea.boundaryX >= bounds.maxX)
      error('invalid_value', `${path}.safeArea`, 'Safe boundary must leave both safe and combat ground');
    const placement = (point: Point, at: string) => {
      if (point.x < bounds.minX || point.x > bounds.maxX || point.y < bounds.minY || point.y > bounds.maxY)
        error('invalid_value', at, 'Placement is outside walkable ground');
    };
    placement(map.playerSpawn, `${path}.playerSpawn`);
    if (map.playerSpawn.x > map.safeArea.boundaryX) error('invalid_value', `${path}.playerSpawn`, 'Player spawn must be in the safe area');
    unique([...map.enemies.map(p => p.id), ...map.npcs.map(p => p.id)], `${path}.placements`);
    map.enemies.forEach((p, e) => {
      ref('enemies', p.enemyId, `${path}.enemies[${e}].enemyId`);
      placement(p.position, `${path}.enemies[${e}].position`);
      if (p.position.x <= map.safeArea.boundaryX) error('invalid_value', `${path}.enemies[${e}]`, 'Enemy spawn must be outside the safe area');
    });
    map.npcs.forEach((p, n) => { ref('npcs', p.npcId, `${path}.npcs[${n}].npcId`); placement(p.position, `${path}.npcs[${n}].position`); });
  });

  pack.classes.forEach((definition, i) => {
    const path = `classes[${i}]`, levels = definition.progression.levels;
    unique(definition.skillIds, `${path}.skillIds`);
    definition.skillIds.forEach((skillId, s) => {
      ref('skills', skillId, `${path}.skillIds[${s}]`);
      const skill = pack.skills.find(skill => skill.id === skillId);
      if (skill?.target === 'selected_enemy' && skill.range !== definition.meleeRange) error('invalid_value', `${path}.skillIds[${s}]`, 'Melee skill range must match class melee range');
    });
    if (levels.length !== definition.progression.levelCap || levels.at(-1)?.cumulativeXp !== definition.progression.xpCap)
      error('invalid_value', `${path}.progression`, 'Level count/cap and final XP threshold/cap must match');
    levels.forEach((level, l) => {
      if (level.level !== l + 1 || (l === 0 ? level.cumulativeXp !== 0 : level.cumulativeXp <= levels[l - 1]!.cumulativeXp))
        error('invalid_value', `${path}.progression.levels[${l}]`, 'Levels must start at 1/0 XP and increase consecutively with increasing thresholds');
    });
  });
  pack.skills.forEach((skill, i) => {
    assetRef(skill.iconAssetId, 'icon', `skills[${i}].iconAssetId`);
    assetRef(skill.effectAssetId, 'effect', `skills[${i}].effectAssetId`);
    assetRef(skill.soundAssetId, 'audio', `skills[${i}].soundAssetId`);
  });
  pack.items.forEach((item, i) => {
    assetRef(item.iconAssetId, 'icon', `items[${i}].iconAssetId`);
    if (item.kind === 'weapon') { ref('sprites', item.visualSpriteId, `items[${i}].visualSpriteId`); requiredClips(item.visualSpriteId, playerClips, `items[${i}].visualSpriteId`); }
  });
  pack.enemies.forEach((enemy, i) => {
    const path = `enemies[${i}]`;
    ref('sprites', enemy.spriteId, `${path}.spriteId`);
    requiredClips(enemy.spriteId, ['idle', 'walk', 'attack', 'hit', 'death'], `${path}.spriteId`);
    rewardRefs(enemy.rewards, `${path}.rewards`);
    unique(enemy.questDrops.map(drop => `${drop.questId}:${drop.itemId}`), `${path}.questDrops`);
    enemy.questDrops.forEach((drop, d) => {
      ref('quests', drop.questId, `${path}.questDrops[${d}].questId`);
      ref('items', drop.itemId, `${path}.questDrops[${d}].itemId`);
      const quest = pack.quests.find(quest => quest.id === drop.questId);
      if (quest && (quest.objective.enemyId !== enemy.id || quest.objective.itemId !== drop.itemId)) error('invalid_reference', `${path}.questDrops[${d}]`, 'Drop does not match the referenced quest objective');
    });
  });
  pack.quests.forEach((quest, i) => {
    const path = `quests[${i}]`;
    unique(quest.prerequisites, `${path}.prerequisites`);
    quest.prerequisites.forEach((value, p) => ref('quests', value, `${path}.prerequisites[${p}]`));
    ref('enemies', quest.objective.enemyId, `${path}.objective.enemyId`);
    ref('items', quest.objective.itemId, `${path}.objective.itemId`);
    if (pack.items.find(item => item.id === quest.objective.itemId)?.kind !== 'quest_material') error('invalid_reference', `${path}.objective.itemId`, 'Collection objective requires a quest material');
    ref('npcs', quest.turnIn.npcId, `${path}.turnIn.npcId`);
    const turnInNpc = pack.npcs.find(npc => npc.id === quest.turnIn.npcId);
    if (turnInNpc && !turnInNpc.questIds.includes(quest.id)) error('invalid_reference', `${path}.turnIn.npcId`, 'Turn-in NPC does not offer this quest');
    grantRefs(quest.turnIn.consume, `${path}.turnIn.consume`);
    rewardRefs(quest.turnIn.rewards, `${path}.turnIn.rewards`);
    if (quest.turnIn.consume.length !== 1 || quest.turnIn.consume[0]?.itemId !== quest.objective.itemId || quest.turnIn.consume[0]?.count !== quest.objective.count)
      error('invalid_value', `${path}.turnIn.consume`, 'Consumption must match the single collection objective');
    const enemy = pack.enemies.find(enemy => enemy.id === quest.objective.enemyId);
    if (enemy && !enemy.questDrops.some(drop => drop.questId === quest.id && drop.itemId === quest.objective.itemId)) error('invalid_reference', `${path}.objective`, 'Objective enemy does not supply the required active-quest drop');
  });
  const visiting = new Set<string>(), visited = new Set<string>();
  const visitQuest = (questId: string) => {
    if (visiting.has(questId)) { error('cyclic_prerequisite', `quests.${questId}.prerequisites`, 'Quest prerequisite cycle'); return; }
    if (visited.has(questId)) return;
    visiting.add(questId);
    pack.quests.find(quest => quest.id === questId)?.prerequisites.forEach(visitQuest);
    visiting.delete(questId); visited.add(questId);
  };
  pack.quests.forEach(quest => visitQuest(quest.id));

  pack.npcs.forEach((npc, i) => {
    const path = `npcs[${i}]`;
    ref('appearances', npc.appearanceId, `${path}.appearanceId`);
    assetRef(npc.portraitAssetId, 'portrait', `${path}.portraitAssetId`);
    ref('dialogues', npc.dialogueId, `${path}.dialogueId`);
    const dialogue = pack.dialogues.find(dialogue => dialogue.id === npc.dialogueId);
    if (dialogue && dialogue.npcId !== npc.id) error('invalid_reference', `${path}.dialogueId`, 'Dialogue belongs to another NPC');
    unique(npc.questIds, `${path}.questIds`);
    npc.questIds.forEach((questId, q) => {
      ref('quests', questId, `${path}.questIds[${q}]`);
      const quest = pack.quests.find(quest => quest.id === questId);
      if (quest && (quest.turnIn.npcId !== npc.id || quest.turnIn.range !== npc.interactionRange)) error('invalid_reference', `${path}.questIds[${q}]`, 'Quest NPC/range differs from its interaction definition');
    });
    const appearance = pack.appearances.find(a => a.id === npc.appearanceId);
    appearance?.layers.forEach(layer => requiredClips(layer.spriteId, ['idle'], `${path}.appearanceId`));
  });
  pack.dialogues.forEach((dialogue, i) => {
    const path = `dialogues[${i}]`, nodes = new Map(dialogue.nodes.map(node => [node.id, node]));
    ref('npcs', dialogue.npcId, `${path}.npcId`);
    const npc = pack.npcs.find(npc => npc.id === dialogue.npcId);
    if (npc && npc.dialogueId !== dialogue.id) error('invalid_reference', `${path}.npcId`, 'NPC links to a different dialogue');
    unique(dialogue.nodes.map(node => node.id), `${path}.nodes`);
    if (!nodes.has(dialogue.entryNodeId)) error('missing_reference', `${path}.entryNodeId`, `Missing entry node "${dialogue.entryNodeId}"`);
    dialogue.nodes.forEach((node, n) => {
      unique(node.choices.map(choice => choice.id), `${path}.nodes[${n}].choices`);
      node.choices.forEach((choice, c) => {
        const at = `${path}.nodes[${n}].choices[${c}]`;
        if (choice.nextNodeId !== null && !nodes.has(choice.nextNodeId)) error('missing_reference', `${at}.nextNodeId`, `Missing dialogue node "${choice.nextNodeId}"`);
        if (choice.condition.kind === 'quest_state') ref('quests', choice.condition.questId, `${at}.condition.questId`);
        if (choice.action) {
          ref('quests', choice.action.questId, `${at}.action.questId`);
          if (npc && !npc.questIds.includes(choice.action.questId)) error('invalid_reference', `${at}.action.questId`, 'NPC does not offer this quest');
        }
      });
    });
    const reached = new Set<string>(), pending = [dialogue.entryNodeId];
    while (pending.length) {
      const nodeId = pending.pop()!;
      if (reached.has(nodeId)) continue;
      reached.add(nodeId);
      nodes.get(nodeId)?.choices.forEach(choice => { if (choice.nextNodeId !== null) pending.push(choice.nextNodeId); });
    }
    dialogue.nodes.forEach((node, n) => { if (!reached.has(node.id)) error('unreachable_dialogue', `${path}.nodes[${n}]`, `Node "${node.id}" is unreachable from entry`); });
  });

  pack.characters.forEach((character, i) => {
    const path = `characters[${i}]`;
    ref('classes', character.classId, `${path}.classId`);
    ref('appearances', character.appearanceId, `${path}.appearanceId`);
    ref('maps', character.initialMapId, `${path}.initialMapId`);
    grantRefs(character.inventory, `${path}.inventory`);
    ref('items', character.equipment.weaponItemId, `${path}.equipment.weaponItemId`);
    if (!character.inventory.some(grant => grant.itemId === character.equipment.weaponItemId)) error('invalid_reference', `${path}.equipment.weaponItemId`, 'Starting weapon must be owned in inventory');
    const occupiedSlots = character.inventory.reduce((total, grant) => {
      const item = pack.items.find(item => item.id === grant.itemId);
      return total + (item?.stackable ? 1 : grant.count);
    }, 0);
    if (occupiedSlots > pack.rules.inventory.slots) error('invalid_value', `${path}.inventory`, 'Starting inventory exceeds slot capacity');
    if (pack.items.find(item => item.id === character.equipment.weaponItemId)?.kind !== 'weapon') error('invalid_reference', `${path}.equipment.weaponItemId`, 'Equipment reference must be a weapon');
    const appearance = pack.appearances.find(a => a.id === character.appearanceId);
    appearance?.layers.forEach(layer => requiredClips(layer.spriteId, playerClips, `${path}.appearanceId`));
    const body = pack.sprites.find(sprite => sprite.id === appearance?.layers.find(layer => layer.slot === 'body')?.spriteId);
    if (body) for (const item of pack.items) {
      if (item.kind === 'weapon') {
        const visual = pack.sprites.find(sprite => sprite.id === item.visualSpriteId);
        if (visual) compatible(body, visual, `items.${item.id}.visualSpriteId`);
      }
    }
  });

  return diagnostics.some(d => d.severity === 'error') ? { success: false, diagnostics } : { success: true, data: pack, diagnostics };
}
