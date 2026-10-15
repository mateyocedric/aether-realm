import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { CommandId, GameCommand, GameSession } from '@aether/game-core';
import { validateContentPack } from '@aether/content';
import { LocalGameSession } from '../src/adapters/local/LocalGameSession.ts';
import type { LocalClock } from '../src/adapters/local/LocalGameSession.ts';
import { GameController } from '../src/bridge/GameController.ts';

const parsed = validateContentPack(JSON.parse(readFileSync(new URL('../../../content/dawnwell-glade/pack.json', import.meta.url), 'utf8')));
assert.ok(parsed.success); const content = parsed.data;
class Clock implements LocalClock {
  time = 10_000;
  next = 0;
  frames = new Map<number, () => void>();
  now = () => this.time;
  requestFrame = (callback: () => void) => { const id = ++this.next; this.frames.set(id, callback); return id; };
  cancelFrame = (id: number) => { this.frames.delete(id); };
  advance(ms: number) { this.time += ms; const callbacks = [...this.frames.values()]; this.frames.clear(); callbacks.forEach(callback => callback()); }
}
let number = 0;
const submit = (session: GameSession, command: GameCommand) => session.submit({ id: `test_${++number}` as CommandId, command });
async function setup() {
  const clock = new Clock(), session = new LocalGameSession(content, clock);
  await session.connect({ expectedContentReleaseId: content.manifest.releaseId }); return { clock, session };
}
const position = (session: GameSession) => session.getState().room!.players[0]!.position;

test('local session validates content and goes through all readiness gates', async t => {
  const invalid = structuredClone(content); invalid.maps[0]!.enemies[0]!.enemyId = 'missing';
  assert.throws(() => new LocalGameSession(invalid, new Clock()), /Missing enemies/);
  const clock = new Clock(), session = new LocalGameSession(content, clock); t.after(() => session.disconnect());
  const states: string[] = []; const unsubscribe = session.observeState(state => { if (states.at(-1) !== state.connection.status) states.push(state.connection.status); });
  assert.equal((await submit(session, { kind: 'move_to', destination: { x: 300, y: 600 } })).status, 'rejected');
  const connection = session.connect({ expectedContentReleaseId: content.manifest.releaseId });
  const early = await submit(session, { kind: 'move_to', destination: { x: 300, y: 600 } });
  assert.equal(early.status, 'rejected');
  await connection;
  assert.deepEqual(states, ['disconnected', 'connecting', 'subscribing', 'ready']);
  assert.deepEqual(session.getState().connection.readiness, { content: true, room: true, personal: true });
  assert.deepEqual(position(session), { x: 160, y: 540 });
  assert.equal(session.getState().room!.enemies.length, 4);
  unsubscribe();
});

test('movement covers 180 units each second horizontally and diagonally', async t => {
  const { session, clock } = await setup(); t.after(() => session.disconnect());
  await submit(session, { kind: 'move_to', destination: { x: 900, y: 540 } }); clock.advance(1000);
  assert.deepEqual(position(session), { x: 340, y: 540 });
  await session.disconnect();
  const diagonal = new LocalGameSession(content, clock); t.after(() => diagonal.disconnect());
  await diagonal.connect({ expectedContentReleaseId: content.manifest.releaseId });
  await submit(diagonal, { kind: 'move_to', destination: { x: 400, y: 640 } }); clock.advance(1000);
  const point = position(diagonal);
  assert.ok(Math.abs(Math.hypot(point.x - 160, point.y - 540) - 180) < 1e-9);
  assert.ok(point.x < 400 && point.y < 640);
  clock.advance(1000);
  assert.deepEqual(position(diagonal), { x: 400, y: 640 });
  assert.equal(diagonal.getState().personal!.roomState!.destination, null);
});

test('destinations clamp to bounds and malformed coordinates cannot move the actor', async t => {
  const { session, clock } = await setup(); t.after(() => session.disconnect());
  await submit(session, { kind: 'move_to', destination: { x: -1000, y: 5000 } });
  assert.deepEqual(session.getState().personal!.roomState!.destination, { x: 64, y: 640 }); clock.advance(1000);
  assert.deepEqual(position(session), { x: 64, y: 640 });
  for (const destination of [{ x: NaN, y: 600 }, { x: Infinity, y: 600 }]) {
    const feedback = await submit(session, { kind: 'move_to', destination }); assert.equal(feedback.status, 'rejected');
  }
  assert.deepEqual(position(session), { x: 64, y: 640 });
  await submit(session, { kind: 'move_to', destination: { x: 5000, y: -1000 } }); clock.advance(20_000);
  assert.deepEqual(position(session), { x: 1216, y: 440 });
});

test('facing changes with horizontal travel; vertical movement retains it', async t => {
  const { session, clock } = await setup(); t.after(() => session.disconnect());
  await submit(session, { kind: 'move_to', destination: { x: 64, y: 540 } }); clock.advance(1000);
  assert.equal(session.getState().room!.players[0]!.facing, 'left');
  await submit(session, { kind: 'move_to', destination: { x: 64, y: 640 } }); clock.advance(1000);
  assert.equal(session.getState().room!.players[0]!.facing, 'left');
  await submit(session, { kind: 'move_to', destination: { x: 244, y: 640 } }); clock.advance(1000);
  assert.equal(session.getState().room!.players[0]!.facing, 'right');
});

test('idle time before a command is not credited to its movement', async t => {
  const { session, clock } = await setup(); t.after(() => session.disconnect());
  clock.time += 500; // Input occurs between scheduled simulation callbacks.
  await submit(session, { kind: 'move_to', destination: { x: 900, y: 540 } });
  clock.advance(1000);
  assert.deepEqual(position(session), { x: 340, y: 540 });
});

test('one clock loop survives repeated connect; disconnect cancels movement, observers detach', async () => {
  const { session, clock } = await setup();
  await session.connect({ expectedContentReleaseId: content.manifest.releaseId }); assert.equal(clock.frames.size, 1);
  let calls = 0; const unsubscribe = session.observeState(() => calls++);
  await submit(session, { kind: 'move_to', destination: { x: 900, y: 600 } }); clock.advance(250);
  const before = position(session), count = calls; unsubscribe();
  await session.disconnect(); assert.equal(clock.frames.size, 0);
  assert.equal(session.getState().personal!.roomState!.destination, null);
  clock.advance(1000); assert.deepEqual(position(session), before); assert.equal(calls, count);
  await session.connect({ expectedContentReleaseId: content.manifest.releaseId });
  assert.equal(clock.frames.size, 1); assert.equal(session.getState().room!.players[0]!.connected, true);
  assert.deepEqual(position(session), before); await session.disconnect();
});

test('disconnect during async initialization cannot start a stale simulation loop', async () => {
  const clock = new Clock(), session = new LocalGameSession(content, clock);
  const connection = session.connect({ expectedContentReleaseId: content.manifest.releaseId });
  await session.disconnect(); await assert.rejects(connection, /cancelled/);
  assert.equal(session.getState().connection.status, 'disconnected'); assert.equal(clock.frames.size, 0);
});

test('release mismatch fails and leaves no simulation loop', async () => {
  const clock = new Clock(), session = new LocalGameSession(content, clock);
  await assert.rejects(session.connect({ expectedContentReleaseId: 'wrong_release' }), /mismatch/);
  assert.equal(session.getState().connection.status, 'error'); assert.equal(clock.frames.size, 0);
});

test('observations cannot be mutated; M3 actions are rejected without gameplay side effects', async t => {
  const { session } = await setup(); t.after(() => session.disconnect());
  const before = session.getState();
  assert.throws(() => { (before.room!.players[0]!.position as { x: number }).x = 999; }, TypeError);
  for (const command of [
    { kind: 'request_action', skillId: 'basic_attack', target: null },
    { kind: 'turn_in_quest', questId: 'steady_the_dawnwell', npcId: 'keeper_mira' },
    { kind: 'send_chat', text: 'Deferred' },
  ] as const) assert.equal((await submit(session, command)).status, 'rejected');
  assert.deepEqual(session.getState().personal, before.personal);
  assert.deepEqual(session.getState().room!.enemies, before.room!.enemies);
});

test('selection checks encounter identity and ground movement retains the selected enemy', async t => {
  const { session } = await setup(); t.after(() => session.disconnect());
  const enemy = session.getState().room!.enemies[0]!;
  const invalid = await submit(session, { kind: 'select_target', target: { ...enemy.handle, encounterId: 'stale' as typeof enemy.handle.encounterId } });
  assert.equal(invalid.status, 'rejected');
  await submit(session, { kind: 'select_target', target: enemy.handle });
  await submit(session, { kind: 'move_to', destination: { x: 350, y: 600 } });
  assert.deepEqual(session.getState().personal!.roomState!.selectedTarget, enemy.handle);
});

test('bridge publishes scene snapshots while movement does not notify React HUD subscribers', async () => {
  const { session, clock } = await setup(); const bridge = new GameController(session, content);
  bridge.setSceneReady(true);
  let hudCalls = 0, renderCalls = 0;
  const offHud = bridge.observeHud(() => hudCalls++), offRender = bridge.observeRender(() => renderCalls++);
  const initialHud = bridge.getHudSnapshot();
  await bridge.dispatch({ kind: 'move', destination: { x: 900, y: 600 } });
  for (let i = 0; i < 30; i++) clock.advance(16);
  assert.equal(hudCalls, 0); assert.equal(bridge.getHudSnapshot(), initialHud); assert.ok(renderCalls >= 30);
  await bridge.dispatch({ kind: 'input_focus', blocked: true });
  const destination = session.getState().personal!.roomState!.destination;
  await bridge.dispatch({ kind: 'move', destination: { x: 64, y: 440 } });
  assert.deepEqual(session.getState().personal!.roomState!.destination, destination);
  offHud(); offRender(); bridge.dispose(); assert.equal(clock.frames.size, 0);
});

test('a compatible fixture changes spawn, placement, and speed through definitions', async () => {
  const fixture = structuredClone(content); fixture.maps[0]!.playerSpawn = { x: 200, y: 600 };
  fixture.maps[0]!.enemies[0]!.position = { x: 650, y: 500 }; fixture.classes[0]!.movementSpeed = 120;
  const clock = new Clock(), session = new LocalGameSession(fixture, clock);
  await session.connect({ expectedContentReleaseId: fixture.manifest.releaseId });
  assert.deepEqual(position(session), { x: 200, y: 600 });
  assert.deepEqual(session.getState().room!.enemies[0]!.position, { x: 650, y: 500 });
  await submit(session, { kind: 'move_to', destination: { x: 500, y: 600 } }); clock.advance(1000);
  assert.deepEqual(position(session), { x: 320, y: 600 }); await session.disconnect();
});
