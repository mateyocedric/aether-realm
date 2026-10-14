import type { ContentId, Point, QuestState } from '@aether/content';

/** Runtime IDs are distinct from each other and from definition IDs. */
export type RuntimeId<Kind extends string> = string & { readonly __runtimeId: Kind };
export type CharacterId = RuntimeId<'character'>;
export type IdentityId = RuntimeId<'identity'>;
export type RoomId = RuntimeId<'room'>;
export type EnemyInstanceId = RuntimeId<'enemy_instance'>;
export type EncounterId = RuntimeId<'encounter'>;
export type InventoryItemId = RuntimeId<'inventory_item'>;
export type CommandId = RuntimeId<'command'>;
export type EventId = RuntimeId<'event'>;
/** Adapter-normalized authority epoch milliseconds; never supplied as command time. */
export type AuthorityTimeMs = number;
export type Unsubscribe = () => void;
export type DeepReadonly<T> = T extends readonly (infer V)[] ? readonly DeepReadonly<V>[]
  : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

export interface EnemyHandle { instanceId: EnemyInstanceId; encounterId: EncounterId }
export type EntityRef = { kind: 'character'; characterId: CharacterId } | { kind: 'enemy'; enemy: EnemyHandle };

/** Intention only: no identity, position override, damage, rewards, or client time. */
export type GameCommand =
  | { kind: 'create_character'; templateId: ContentId; name: string }
  | { kind: 'move_to'; destination: Point }
  | { kind: 'select_target'; target: EnemyHandle | null }
  | { kind: 'request_action'; skillId: ContentId; target: EnemyHandle | null }
  | { kind: 'accept_quest'; questId: ContentId; npcId: ContentId }
  | { kind: 'turn_in_quest'; questId: ContentId; npcId: ContentId }
  | { kind: 'equip_item'; inventoryItemId: InventoryItemId }
  | { kind: 'send_chat'; text: string }
  | { kind: 'leave_room' };
export interface CommandEnvelope { id: CommandId; command: GameCommand }
export type CommandRejection = 'not_ready' | 'disconnected' | 'invalid_request' | 'no_target'
  | 'invalid_target' | 'out_of_range' | 'safe_area' | 'cooldown' | 'recovery' | 'insufficient_mana'
  | 'dead' | 'in_combat' | 'quest_ineligible' | 'not_owned' | 'room_full' | 'content_mismatch';
export type CommandFeedback =
  | { commandId: CommandId; status: 'accepted' }
  | { commandId: CommandId; status: 'rejected'; reason: CommandRejection; message: string };

export interface InventoryEntry { id: InventoryItemId; itemId: ContentId; count: number }
export interface SavedCharacterProgress {
  characterId: CharacterId;
  ownerIdentityId: IdentityId;
  name: string;
  classId: ContentId;
  appearanceId: ContentId;
  level: number;
  cumulativeXp: number;
  gold: number;
  inventory: readonly InventoryEntry[];
  equipment: { weapon: InventoryItemId | null };
  quests: readonly { questId: ContentId; state: QuestState }[];
}
export interface CharacterRecoveryState {
  health: number;
  mana: number;
  lastDamageAtMs: AuthorityTimeMs | null;
  cooldownUntilMs: Readonly<Record<ContentId, AuthorityTimeMs>>;
  sharedRecoveryUntilMs: AuthorityTimeMs;
  respawnAtMs: AuthorityTimeMs | null;
  disconnectExpiresAtMs: AuthorityTimeMs | null;
}
export interface PlayerPresence {
  characterId: CharacterId;
  name: string;
  classId: ContentId;
  appearanceId: ContentId;
  weaponItemId: ContentId | null;
  level: number;
  position: Point;
  health: number;
  maxHealth: number;
  facing: 'right' | 'left';
  connected: boolean;
}
export interface EnemyObservation {
  handle: EnemyHandle;
  definitionId: ContentId;
  placementId: ContentId;
  position: Point;
  health: number;
  maxHealth: number;
  state: 'idle' | 'pursuing' | 'returning_home' | 'dead';
  targetCharacterId: CharacterId | null;
  respawnAtMs: AuthorityTimeMs | null;
}
export interface CharacterRoomState {
  characterId: CharacterId;
  destination: Point | null;
  selectedTarget: EnemyHandle | null;
  pendingAction: { skillId: ContentId; target: EnemyHandle } | null;
  pursuingEnemies: readonly EnemyHandle[];
  contributedEncounters: readonly EncounterId[];
}
export interface RoomObservation {
  roomId: RoomId;
  mapId: ContentId;
  contentReleaseId: ContentId;
  players: readonly PlayerPresence[];
  enemies: readonly EnemyObservation[];
  chat: readonly { id: EventId; characterId: CharacterId; name: string; text: string; atMs: AuthorityTimeMs }[];
}
export interface SubscriptionReadiness { content: boolean; room: boolean; personal: boolean }
export type ConnectionState =
  | { status: 'ready'; readiness: { content: true; room: true; personal: true }; contentReleaseId: ContentId }
  | { status: 'disconnected' | 'connecting' | 'reconnecting' | 'subscribing'; readiness: SubscriptionReadiness }
  | { status: 'error'; readiness: SubscriptionReadiness; message: string; retryable: boolean };
export interface ObservedGameState {
  connection: ConnectionState;
  authorityTimeMs: AuthorityTimeMs | null;
  room: RoomObservation | null;
  personal: { progress: SavedCharacterProgress; recovery: CharacterRecoveryState; roomState: CharacterRoomState | null } | null;
}
export type GameEvent = { id: EventId; atMs: AuthorityTimeMs } & (
  | { kind: 'damage'; source: EntityRef; target: EntityRef; amount: number; skillId: ContentId | null }
  | { kind: 'healed'; characterId: CharacterId; amount: number; skillId: ContentId }
  | { kind: 'died' | 'respawned'; entity: EntityRef }
  | { kind: 'reward_granted'; encounterId: EncounterId | null; xp: number; gold: number; items: readonly { itemId: ContentId; count: number }[] }
  | { kind: 'command_feedback'; feedback: CommandFeedback }
);
export interface SessionConnectOptions { expectedContentReleaseId: ContentId; guestToken?: string }
export interface SessionCredentials { identityId: IdentityId; guestToken: string }

/**
 * M1 port only. Adapters are M2/M3a work.
 * connect resolves once required subscriptions and matching content are applied.
 * submit must reject before readiness; acceptance may mean a pending approach,
 * not a completed strike. disconnect is connection loss, leave_room is removal.
 * Observers receive the current snapshot immediately and subsequent replacements.
 * Effects come from deduplicated events; reconnect must not replay commands.
 * Tokens are private, reported separately from observable game state.
 */
export interface GameSession {
  connect(options: Readonly<SessionConnectOptions>): Promise<void>;
  disconnect(): Promise<void>;
  submit(envelope: DeepReadonly<CommandEnvelope>): Promise<DeepReadonly<CommandFeedback>>;
  getState(): DeepReadonly<ObservedGameState>;
  observeState(listener: (state: DeepReadonly<ObservedGameState>) => void): Unsubscribe;
  observeEvents(listener: (event: DeepReadonly<GameEvent>) => void): Unsubscribe;
  observeCredentials(listener: (credentials: Readonly<SessionCredentials>) => void): Unsubscribe;
  estimateAuthorityTimeMs(): AuthorityTimeMs | null;
}
