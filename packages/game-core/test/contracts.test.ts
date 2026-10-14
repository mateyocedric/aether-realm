import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GameCommand, GameSession, CharacterId, DeepReadonly, ObservedGameState, ConnectionState } from '../src/index.ts';

// Compile-time checks for the future adapter/UI boundary. Never executed.
function typeBoundary(session: GameSession, state: DeepReadonly<ObservedGameState>, characterId: CharacterId) {
  // @ts-expect-error A character ID cannot masquerade as an enemy instance ID.
  const wrongTarget: GameCommand = { kind: 'select_target', target: { instanceId: characterId, encounterId: characterId } };
  // @ts-expect-error A client cannot submit computed damage.
  const forgedDamage: GameCommand = { kind: 'request_action', skillId: 'basic_attack', target: null, damage: 999 };
  // @ts-expect-error A ready session requires all three subscription/content gates.
  const premature: ConnectionState = { status: 'ready', readiness: { content: true, room: false, personal: true }, contentReleaseId: 'sample' };
  // @ts-expect-error Observed state is immutable to consumers.
  state.connection.status = 'ready';
  // @ts-expect-error Consumers cannot push inventory grants into observed progress.
  state.personal?.progress.inventory.push({});
  // @ts-expect-error No action execution or reward grant interface is exposed.
  session.grantRewards(999);
  return [wrongTarget, forgedDamage, premature];
}
void typeBoundary;

test('game-core exports types without an adapter or runtime implementation', async () => {
  const exported = await import('../src/index.ts');
  assert.deepEqual(Object.keys(exported), []);
});
