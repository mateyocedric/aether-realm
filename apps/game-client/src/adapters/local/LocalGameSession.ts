import { pointSchema, validateContentPack } from '@aether/content';
import type { ContentPack, Point } from '@aether/content';
import type {
  GameSession, ObservedGameState, DeepReadonly, SessionConnectOptions, SessionCredentials, Unsubscribe,
  CommandEnvelope, CommandFeedback, CommandRejection, GameEvent, CharacterId, IdentityId,
  InventoryItemId, RoomId, EnemyInstanceId, EncounterId, EventId,
} from '@aether/game-core';

export interface LocalClock {
  now(): number;
  requestFrame(callback: () => void): number;
  cancelFrame(id: number): void;
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

/** Disposable M2 development simulation. No combat, rewards, persistence, or network. */
export class LocalGameSession implements GameSession {
  private readonly pack: ContentPack;
  private readonly clock: LocalClock;
  private readonly token = `local_${crypto.randomUUID()}`;
  private state: ObservedGameState = freeze({
    connection: { status: 'disconnected', readiness: { content: false, room: false, personal: false } },
    authorityTimeMs: null, room: null, personal: null,
  });
  private readonly states = new Set<(state: DeepReadonly<ObservedGameState>) => void>();
  private readonly events = new Set<(event: DeepReadonly<GameEvent>) => void>();
  private readonly credentials = new Set<(credentials: Readonly<SessionCredentials>) => void>();
  private frame: number | null = null;
  private generation = 0;
  private lastStep = 0;
  private eventNumber = 0;

  constructor(content: unknown, clock: LocalClock) {
    const validated = validateContentPack(content);
    if (!validated.success) throw new Error(validated.diagnostics.filter(d => d.severity === 'error').map(d => `${d.path}: ${d.message}`).join('\n'));
    this.pack = freeze(validated.data);
    this.clock = clock;
  }

  getState = (): DeepReadonly<ObservedGameState> => this.state;
  estimateAuthorityTimeMs = (): number | null => this.state.connection.status === 'ready' ? this.clock.now() : null;
  observeState = (listener: (state: DeepReadonly<ObservedGameState>) => void): Unsubscribe => {
    this.states.add(listener); listener(this.state);
    return () => { this.states.delete(listener); };
  };
  observeEvents = (listener: (event: DeepReadonly<GameEvent>) => void): Unsubscribe => {
    this.events.add(listener); return () => { this.events.delete(listener); };
  };
  observeCredentials = (listener: (credentials: Readonly<SessionCredentials>) => void): Unsubscribe => {
    this.credentials.add(listener);
    if (this.state.connection.status === 'ready') listener(this.credentialSnapshot());
    return () => { this.credentials.delete(listener); };
  };

  async connect(options: Readonly<SessionConnectOptions>): Promise<void> {
    if (options.expectedContentReleaseId !== this.pack.manifest.releaseId) {
      await this.disconnect();
      this.publish({ ...this.state, connection: { status: 'error', readiness: { content: false, room: false, personal: false }, message: 'Content release mismatch.', retryable: false } });
      throw new Error('Content release mismatch.');
    }
    if (this.state.connection.status === 'ready') return;
    const generation = ++this.generation;
    this.publish({ ...this.state, connection: { status: 'connecting', readiness: { content: false, room: false, personal: false } } });
    await Promise.resolve();
    if (generation !== this.generation) throw new Error('Local connection was cancelled.');
    this.publish({ ...this.state, connection: { status: 'subscribing', readiness: { content: true, room: false, personal: false } } });
    await Promise.resolve();
    if (generation !== this.generation) throw new Error('Local connection was cancelled.');
    if (!this.state.room) this.initializeRoom();
    this.publish({ ...this.state, room: this.state.room ? { ...this.state.room, players: this.state.room.players.map(player => ({ ...player, connected: true })) } : null, authorityTimeMs: this.clock.now(), connection: { status: 'ready', readiness: { content: true, room: true, personal: true }, contentReleaseId: this.pack.manifest.releaseId } });
    for (const listener of this.credentials) listener(this.credentialSnapshot());
    this.lastStep = this.clock.now();
    this.schedule();
  }

  async disconnect(): Promise<void> {
    this.generation++;
    if (this.frame !== null) this.clock.cancelFrame(this.frame);
    this.frame = null;
    this.publish({
      ...this.state,
      connection: { status: 'disconnected', readiness: { content: false, room: false, personal: false } },
      room: this.state.room ? { ...this.state.room, players: this.state.room.players.map(p => ({ ...p, connected: false })) } : null,
      personal: this.state.personal ? {
        ...this.state.personal,
        roomState: this.state.personal.roomState ? { ...this.state.personal.roomState, destination: null, pendingAction: null } : null,
      } : null,
    });
  }

  async submit(envelope: DeepReadonly<CommandEnvelope>): Promise<DeepReadonly<CommandFeedback>> {
    let feedback: CommandFeedback;
    const reject = (reason: CommandRejection, message: string): CommandFeedback => ({ commandId: envelope.id, status: 'rejected', reason, message });
    if (this.state.connection.status !== 'ready') {
      feedback = reject(this.state.connection.status === 'disconnected' ? 'disconnected' : 'not_ready', 'The local session is not ready.');
    } else {
      const command = envelope.command;
      const room = this.state.room, personal = this.state.personal;
      if (!room || !personal?.roomState) feedback = reject('not_ready', 'No active room.');
      else if (command.kind === 'move_to') {
        const parsed = pointSchema.safeParse(command.destination);
        if (!parsed.success) feedback = reject('invalid_request', 'Destination must contain finite world coordinates.');
        else {
          // Reconcile the previous path up to receipt time. Idle time must not
          // count toward movement that starts with this new intention.
          this.step();
          const map = this.pack.maps.find(map => map.id === room.mapId)!;
          const destination = {
            x: Math.max(map.walkable.minX, Math.min(map.walkable.maxX, parsed.data.x)),
            y: Math.max(map.walkable.minY, Math.min(map.walkable.maxY, parsed.data.y)),
          };
          this.publish({ ...this.state, personal: { ...personal, roomState: { ...personal.roomState, destination, pendingAction: null } } });
          feedback = { commandId: envelope.id, status: 'accepted' };
        }
      } else if (command.kind === 'select_target') {
        const target = command.target;
        if (target && !room.enemies.some(enemy => enemy.handle.instanceId === target.instanceId && enemy.handle.encounterId === target.encounterId && enemy.health > 0)) {
          feedback = reject('invalid_target', 'The selected enemy is not in this encounter.');
        } else {
          this.publish({ ...this.state, personal: { ...personal, roomState: { ...personal.roomState, selectedTarget: target, pendingAction: null } } });
          feedback = { commandId: envelope.id, status: 'accepted' };
        }
      } else if (command.kind === 'leave_room') {
        await this.disconnect();
        this.publish({ ...this.state, room: null, personal: this.state.personal ? { ...this.state.personal, roomState: null } : null });
        feedback = { commandId: envelope.id, status: 'accepted' };
      } else {
        feedback = reject('invalid_request', 'This interaction is deferred beyond the M2 movement foundation.');
      }
    }
    const event: GameEvent = { id: `local_event_${++this.eventNumber}` as EventId, atMs: this.clock.now(), kind: 'command_feedback', feedback };
    freeze(event);
    for (const listener of this.events) listener(event);
    return feedback;
  }

  private credentialSnapshot(): Readonly<SessionCredentials> {
    return freeze({ identityId: `${this.token}_identity` as IdentityId, guestToken: this.token });
  }
  private initializeRoom(): void {
    const template = this.pack.characters[0]!;
    const definition = this.pack.classes.find(c => c.id === template.classId)!;
    const map = this.pack.maps.find(m => m.id === template.initialMapId)!;
    const characterId = `${this.token}_character` as CharacterId;
    const inventory = template.inventory.map((entry, i) => ({ id: `${this.token}_item_${i}` as InventoryItemId, itemId: entry.itemId, count: entry.count }));
    const weapon = inventory.find(item => item.itemId === template.equipment.weaponItemId)!;
    const previous = this.state.personal;
    const health = previous?.recovery.health ?? definition.baseStats.maxHealth;
    const mana = previous?.recovery.mana ?? definition.baseStats.maxMana;
    this.publish({
      ...this.state,
      room: {
        roomId: `${this.token}_room` as RoomId, mapId: map.id, contentReleaseId: this.pack.manifest.releaseId,
        players: [{ characterId, name: `Local ${definition.name}`, classId: definition.id, appearanceId: template.appearanceId, weaponItemId: template.equipment.weaponItemId, level: template.startingLevel, position: { ...map.playerSpawn }, health, maxHealth: definition.baseStats.maxHealth, facing: 'right', connected: true }],
        enemies: map.enemies.map(placement => {
          const enemy = this.pack.enemies.find(e => e.id === placement.enemyId)!;
          return { handle: { instanceId: `${this.token}_${placement.id}` as EnemyInstanceId, encounterId: `${this.token}_${placement.id}_initial` as EncounterId }, definitionId: enemy.id, placementId: placement.id, position: { ...placement.position }, health: enemy.stats.maxHealth, maxHealth: enemy.stats.maxHealth, state: 'idle', targetCharacterId: null, respawnAtMs: null };
        }), chat: [],
      },
      personal: {
        progress: previous?.progress ?? { characterId, ownerIdentityId: this.credentialSnapshot().identityId, name: `Local ${definition.name}`, classId: definition.id, appearanceId: template.appearanceId, level: template.startingLevel, cumulativeXp: template.startingXp, gold: template.startingGold, inventory, equipment: { weapon: weapon.id }, quests: this.pack.quests.map(quest => ({ questId: quest.id, state: 'available' })) },
        recovery: previous?.recovery ?? { health, mana, lastDamageAtMs: null, cooldownUntilMs: {}, sharedRecoveryUntilMs: 0, respawnAtMs: null, disconnectExpiresAtMs: null },
        roomState: { characterId, destination: null, selectedTarget: null, pendingAction: null, pursuingEnemies: [], contributedEncounters: [] },
      },
    });
  }
  private publish(state: ObservedGameState): void {
    this.state = freeze(state);
    for (const listener of this.states) listener(this.state);
  }
  private schedule(): void {
    if (this.frame !== null || this.state.connection.status !== 'ready') return;
    this.frame = this.clock.requestFrame(() => {
      this.frame = null;
      if (this.state.connection.status !== 'ready') return;
      this.step(); this.schedule();
    });
  }
  private step(): void {
    const now = this.clock.now(), elapsed = Math.max(0, now - this.lastStep) / 1000;
    this.lastStep = now;
    const room = this.state.room, personal = this.state.personal, destination = personal?.roomState?.destination;
    if (!room || !personal?.roomState || !destination) return;
    const player = room.players.find(p => p.characterId === personal.progress.characterId)!;
    const definition = this.pack.classes.find(c => c.id === player.classId)!;
    const dx = destination.x - player.position.x, dy = destination.y - player.position.y;
    const distance = Math.hypot(dx, dy), travel = Math.min(distance, definition.movementSpeed * elapsed);
    const position: Point = distance === 0 || travel === distance ? { ...destination }
      : { x: player.position.x + dx / distance * travel, y: player.position.y + dy / distance * travel };
    this.publish({
      ...this.state, authorityTimeMs: now,
      room: { ...room, players: room.players.map(p => p.characterId === player.characterId ? { ...p, position, connected: true, facing: dx < 0 ? 'left' : dx > 0 ? 'right' : p.facing } : p) },
      personal: { ...personal, roomState: { ...personal.roomState, destination: travel === distance ? null : destination } },
    });
  }
}
