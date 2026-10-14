import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { validateContentPack } from '../src/index.ts';
import type { ContentPack, DiagnosticCode } from '../src/index.ts';

const source: unknown = JSON.parse(readFileSync(new URL('../../../content/dawnwell-glade/pack.json', import.meta.url), 'utf8'));
const parsed = validateContentPack(source);
assert.ok(parsed.success, JSON.stringify(parsed.diagnostics));
const baseline = parsed.data;
const clone = () => structuredClone(baseline);
function expectError(pack: unknown, code: DiagnosticCode, pattern?: RegExp) {
  const result = validateContentPack(pack);
  assert.equal(result.success, false);
  assert.ok(result.diagnostics.some(d => d.severity === 'error' && d.code === code && (!pattern || pattern.test(d.message))), JSON.stringify(result.diagnostics));
}

test('Dawnwell definitions validate with honest placeholder warnings; release readiness fails', () => {
  assert.equal(parsed.diagnostics.filter(d => d.severity === 'error').length, 0);
  assert.equal(parsed.diagnostics.filter(d => d.code === 'asset_placeholder').length, baseline.assets.length);
  const ready = validateContentPack(source, { requireReadyAssets: true });
  assert.equal(ready.success, false);
  assert.ok(ready.diagnostics.every(d => d.severity === 'error' && d.code === 'asset_placeholder'));
});

test('missing definitions and multiple broken references are reported together', () => {
  const pack = clone();
  pack.classes[0]!.skillIds.push('missing_skill');
  pack.maps[0]!.enemies[0]!.enemyId = 'missing_enemy';
  pack.npcs[0]!.dialogueId = 'missing_dialogue';
  const result = validateContentPack(pack);
  assert.equal(result.success, false);
  for (const id of ['missing_skill', 'missing_enemy', 'missing_dialogue']) assert.ok(result.diagnostics.some(d => d.code === 'missing_reference' && d.message.includes(id)));
});

test('missing required IDs and duplicate global IDs fail without throwing', () => {
  const pack = clone();
  // Test untyped external JSON, not a TypeScript-approved object.
  const raw = pack as unknown as { classes: Record<string, unknown>[] };
  delete raw.classes[0]!.id;
  expectError(pack, 'missing_id');
  const numeric = clone();
  (numeric.classes[0]! as unknown as Record<string, unknown>).id = 123;
  expectError(numeric, 'invalid_value');
  const duplicate = clone();
  duplicate.items[0]!.id = duplicate.classes[0]!.id;
  expectError(duplicate, 'duplicate_id', /guardian/);
});

test('duplicate IDs remain visible alongside schema failures', () => {
  const pack = clone();
  pack.skills.push(structuredClone(pack.skills[0]!));
  pack.enemies[0]!.stats.maxHealth = -1;
  const result = validateContentPack(pack);
  assert.equal(result.success, false);
  assert.ok(result.diagnostics.some(d => d.code === 'duplicate_id'));
  assert.ok(result.diagnostics.some(d => d.code === 'invalid_value'));
});

test('invalid numeric data is rejected rather than coerced', () => {
  for (const value of [-1, 0, Number.NaN, Number.POSITIVE_INFINITY, '150']) {
    const pack = clone();
    (pack.enemies[0]!.stats as unknown as Record<string, unknown>).maxHealth = value;
    expectError(pack, 'invalid_value');
  }
  const pack = clone();
  pack.rules.room.capacity = 2.5;
  expectError(pack, 'invalid_value');
});

test('unsupported effects, AI, map geometry, and dialogue reward scripts fail', () => {
  const variants = [
    (pack: ContentPack) => { (pack.skills[0]!.effect as unknown as Record<string, unknown>).kind = 'damage_over_time'; },
    (pack: ContentPack) => { (pack.enemies[0]!.behavior as unknown as Record<string, unknown>).kind = 'scripted_ai'; },
    (pack: ContentPack) => { (pack.maps[0]! as unknown as Record<string, unknown>).portals = []; },
    (pack: ContentPack) => { (pack.dialogues[0]!.nodes[0]!.choices[0]!.action as unknown as Record<string, unknown>).kind = 'grant_gold'; },
  ];
  for (const mutate of variants) { const pack = clone(); mutate(pack); expectError(pack, 'unsupported_behavior'); }
});

test('world bounds, safe boundary, and placements are coherent', () => {
  const reversed = clone(); reversed.maps[0]!.walkable.minX = 1216;
  expectError(reversed, 'invalid_value', /rectangle/);
  const out = clone(); out.maps[0]!.enemies[0]!.position.y = 700;
  expectError(out, 'invalid_value', /walkable/);
  const safe = clone(); safe.maps[0]!.enemies[0]!.position.x = 400;
  expectError(safe, 'invalid_value', /safe area/);
  const boundary = clone(); boundary.maps[0]!.safeArea.boundaryX = 1216;
  expectError(boundary, 'invalid_value', /boundary/);
  const duplicate = clone(); duplicate.maps[0]!.enemies[1]!.id = duplicate.maps[0]!.enemies[0]!.id;
  expectError(duplicate, 'duplicate_id');
});

test('progression is cumulative, consecutive, and consistent with its cap', () => {
  const decreasing = clone(); decreasing.classes[0]!.progression.levels[2]!.cumulativeXp = 90;
  expectError(decreasing, 'invalid_value');
  const skipped = clone(); skipped.classes[0]!.progression.levels[1]!.level = 3;
  expectError(skipped, 'invalid_value');
  const cap = clone(); cap.classes[0]!.progression.xpCap = 400;
  expectError(cap, 'invalid_value');
});

test('quest supply/consumption and NPC references are checked', () => {
  const noDrop = clone(); noDrop.enemies[0]!.questDrops = [];
  expectError(noDrop, 'invalid_reference', /does not supply/);
  const wrongDrop = clone(); wrongDrop.enemies[0]!.questDrops[0]!.itemId = 'training_blade';
  expectError(wrongDrop, 'invalid_reference', /Drop/);
  const consume = clone(); consume.quests[0]!.turnIn.consume[0]!.count = 4;
  expectError(consume, 'invalid_value', /Consumption/);
  const range = clone(); range.quests[0]!.turnIn.range = 100;
  expectError(range, 'invalid_reference', /range/);
  const offer = clone(); offer.npcs[0]!.questIds = [];
  expectError(offer, 'invalid_reference', /offer/);
  const cycle = clone(); cycle.quests[0]!.prerequisites = ['steady_the_dawnwell'];
  expectError(cycle, 'cyclic_prerequisite');
});

test('starting equipment must be an owned weapon', () => {
  const unowned = clone(); unowned.characters[0]!.inventory = [];
  expectError(unowned, 'invalid_reference', /owned/);
  const material = clone(); material.characters[0]!.equipment.weaponItemId = 'aether_shard';
  expectError(material, 'invalid_reference', /weapon/);
  const full = clone(); full.characters[0]!.inventory[0]!.count = 13;
  expectError(full, 'invalid_value', /slot capacity/);
});

test('sprite frame bounds, clip references, anchors, and layer compatibility fail clearly', () => {
  const clip = clone(); clip.sprites[0]!.clips[0]!.frames = [99];
  expectError(clip, 'missing_reference', /frame 99/);
  const bounds = clone(); bounds.sprites[0]!.frames[0]!.width = 200;
  expectError(bounds, 'invalid_value', /sheet/);
  const anchor = clone(); anchor.sprites[0]!.groundAnchorPx.y = -1;
  expectError(anchor, 'invalid_value', /anchor/);
  const rig = clone(); rig.sprites[1]!.rigFamily = 'other_rig';
  expectError(rig, 'invalid_reference', /compatible/);
  const required = clone(); required.sprites[3]!.clips = required.sprites[3]!.clips.filter(c => c.name !== 'death');
  expectError(required, 'invalid_reference', /death/);
  const attachment = clone(); attachment.sprites[0]!.attachments[0]!.frame = 8;
  expectError(attachment, 'missing_reference', /frame 8/);
});

test('dialogue entry, links, local IDs, reachability, and quest references are validated', () => {
  const missing = clone(); missing.dialogues[0]!.entryNodeId = 'missing_node';
  expectError(missing, 'missing_reference', /entry/);
  const broken = clone(); broken.dialogues[0]!.nodes[0]!.choices[0]!.nextNodeId = 'missing_node';
  expectError(broken, 'missing_reference', /dialogue node/);
  const unreachable = clone(); unreachable.dialogues[0]!.nodes.push({ id: 'lost', text: 'Unreachable', choices: [] });
  expectError(unreachable, 'unreachable_dialogue');
  const duplicate = clone(); duplicate.dialogues[0]!.nodes[0]!.choices.push(structuredClone(duplicate.dialogues[0]!.nodes[0]!.choices[0]!));
  expectError(duplicate, 'duplicate_id');
});

test('validator supports other valid placements and numbers without Dawnwell hardcoding', () => {
  const pack = clone();
  pack.manifest.id = 'another_sample_pack';
  pack.maps[0]!.enemies[0]!.position.x = 600;
  pack.classes[0]!.movementSpeed = 200;
  assert.equal(validateContentPack(pack).success, true);
});

const cli = fileURLToPath(new URL('../../../tools/content/validate.ts', import.meta.url));
test('CLI exits nonzero for missing ready files and mismatched checksums', t => {
  const directory = mkdtempSync(join(tmpdir(), 'aether-content-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const pack = clone();
  const original = pack.assets[0]!;
  const bytes = Buffer.from('test fixture');
  pack.assets[0] = {
    id: original.id, name: original.name, kind: original.kind, status: 'ready', path: 'assets/background.png',
    sha256: createHash('sha256').update(bytes).digest('hex'),
    provenance: { original: true, creator: 'Test', source: 'Test fixture', license: 'Test only' },
  };
  const file = join(directory, 'pack.json');
  writeFileSync(file, JSON.stringify(pack));
  const missing = spawnSync(process.execPath, [cli, file], { encoding: 'utf8' });
  assert.equal(missing.status, 1); assert.match(missing.stderr, /asset_file/);
  mkdirSync(join(directory, 'assets'));
  writeFileSync(join(directory, 'assets/background.png'), 'tampered');
  const tampered = spawnSync(process.execPath, [cli, file], { encoding: 'utf8' });
  assert.equal(tampered.status, 1); assert.match(tampered.stderr, /SHA-256 mismatch/);
  writeFileSync(join(directory, 'assets/background.png'), bytes);
  const valid = spawnSync(process.execPath, [cli, file], { encoding: 'utf8' });
  assert.equal(valid.status, 0, valid.stderr); assert.match(valid.stdout, /VALID/);
});

test('CLI readiness mode rejects placeholders; malformed JSON has a readable error', t => {
  const readiness = spawnSync(process.execPath, [cli, '--require-ready-assets'], { encoding: 'utf8' });
  assert.equal(readiness.status, 1); assert.match(readiness.stderr, /asset_placeholder/);
  const directory = mkdtempSync(join(tmpdir(), 'aether-content-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'invalid.json'); writeFileSync(file, '{broken');
  const invalid = spawnSync(process.execPath, [cli, file], { encoding: 'utf8' });
  assert.equal(invalid.status, 1); assert.match(invalid.stderr, /ERROR input/);
});

test('ready asset paths reject traversal and the CLI rejects escaping symlinks', t => {
  const pack = clone(), original = pack.assets[0]!;
  pack.assets[0] = {
    id: original.id, name: original.name, kind: original.kind, status: 'ready', path: 'assets/../outside.png',
    sha256: '0'.repeat(64), provenance: { original: true, creator: 'Test', source: 'Test', license: 'Test only' },
  };
  expectError(pack, 'invalid_value', /safe pack-relative/);
  // Cross-platform symlink behavior is exercised on the development host.
  const directory = mkdtempSync(join(tmpdir(), 'aether-content-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const packDir = join(directory, 'pack'); mkdirSync(join(packDir, 'assets'), { recursive: true });
  const outside = join(directory, 'outside.png'); writeFileSync(outside, 'outside pack');
  const ready = pack.assets[0];
  assert.equal(ready.status, 'ready');
  if (ready.status === 'ready') ready.path = 'assets/background.png';
  symlinkSync(outside, join(packDir, 'assets/background.png'));
  const file = join(packDir, 'pack.json'); writeFileSync(file, JSON.stringify(pack));
  const escaped = spawnSync(process.execPath, [cli, file], { encoding: 'utf8' });
  assert.equal(escaped.status, 1); assert.match(escaped.stderr, /outside the pack/);
});
