import type { ContentPack, Point } from '@aether/content';
import type { CommandId, DeepReadonly, EnemyHandle, GameCommand, GameSession, ObservedGameState, Unsubscribe } from '@aether/game-core';

export type UiIntent =
  | { kind: 'move'; destination: Point }
  | { kind: 'select_target'; target: EnemyHandle | null }
  | { kind: 'inspect_npc'; npcId: string }
  | { kind: 'input_focus'; blocked: boolean }
  | { kind: 'deferred_action' };
export interface HudSnapshot {
  name: string; className: string; level: number; health: number; maxHealth: number; mana: number; maxMana: number;
  status: string; ready: boolean; sceneStatus: 'loading' | 'ready' | 'error'; selectedEnemy: string | null; selectedHealth: number | null; selectedMaxHealth: number | null; message: string;
}

/** Session-neutral typed bridge. React subscribes to stable HUD projections only. */
export class GameController {
  readonly content: ContentPack;
  private readonly session: GameSession;
  private state: DeepReadonly<ObservedGameState>;
  private hud!: Readonly<HudSnapshot>;
  private message = 'Click the ground to move. Illustrated assets are placeholders.';
  private sceneStatus: HudSnapshot['sceneStatus'] = 'loading';
  private readonly renderListeners = new Set<(state: DeepReadonly<ObservedGameState>) => void>();
  private readonly hudListeners = new Set<() => void>();
  private readonly cleanups: Unsubscribe[] = [];
  private blocked = false;
  private disposed = false;
  private commandNumber = 0;

  constructor(session: GameSession, content: ContentPack) {
    this.session = session; this.content = content; this.state = session.getState(); this.updateHud();
    this.cleanups.push(session.observeState(state => {
      this.state = state; this.updateHud();
      for (const listener of this.renderListeners) listener(state);
    }));
    this.cleanups.push(session.observeEvents(event => {
      if (event.kind === 'command_feedback' && event.feedback.status === 'rejected') {
        this.message = event.feedback.message; this.updateHud();
      }
    }));
  }
  connect = (): Promise<void> => this.session.connect({ expectedContentReleaseId: this.content.manifest.releaseId });
  getRenderState = (): DeepReadonly<ObservedGameState> => this.state;
  getHudSnapshot = (): Readonly<HudSnapshot> => this.hud;
  observeHud = (listener: () => void): Unsubscribe => { this.hudListeners.add(listener); return () => { this.hudListeners.delete(listener); }; };
  observeRender = (listener: (state: DeepReadonly<ObservedGameState>) => void): Unsubscribe => {
    this.renderListeners.add(listener); listener(this.state); return () => { this.renderListeners.delete(listener); };
  };
  reportError(message: string): void { this.message = message; this.sceneStatus = 'error'; this.updateHud(); }
  setSceneReady(ready: boolean): void { if (!this.disposed) { this.sceneStatus = ready ? 'ready' : 'loading'; this.updateHud(); } }

  async dispatch(intent: UiIntent): Promise<void> {
    if (this.disposed) return;
    if (intent.kind === 'input_focus') { this.blocked = intent.blocked; return; }
    if (this.blocked) return;
    if (intent.kind === 'deferred_action') {
      this.message = 'Combat is deferred to M3. This milestone supports movement and selection.'; this.updateHud(); return;
    }
    if (intent.kind === 'inspect_npc') {
      const npc = this.content.npcs.find(npc => npc.id === intent.npcId);
      const map = this.content.maps.find(map => map.id === this.state.room?.mapId);
      const placement = map?.npcs.find(p => p.npcId === intent.npcId);
      const player = this.state.room?.players.find(p => p.characterId === this.state.personal?.progress.characterId);
      if (!npc || !placement || !player) return;
      this.message = Math.hypot(player.position.x - placement.position.x, player.position.y - placement.position.y) > npc.interactionRange
        ? `Move closer to ${npc.name} (within ${npc.interactionRange} world units).`
        : `${npc.name} is ready to meet you. Dialogue and quest execution arrive in M3.`;
      this.updateHud(); return;
    }
    const command: GameCommand = intent.kind === 'move'
      ? { kind: 'move_to', destination: intent.destination }
      : { kind: 'select_target', target: intent.target };
    await this.session.submit({ id: `ui_command_${++this.commandNumber}` as CommandId, command });
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cleanups.forEach(cleanup => cleanup());
    this.renderListeners.clear(); this.hudListeners.clear();
    void this.session.disconnect();
  }
  private updateHud(): void {
    if (this.disposed) return;
    const personal = this.state.personal;
    const definition = this.content.classes.find(c => c.id === personal?.progress.classId) ?? this.content.classes[0]!;
    const target = personal?.roomState?.selectedTarget;
    const enemy = this.state.room?.enemies.find(enemy => enemy.handle.instanceId === target?.instanceId && enemy.handle.encounterId === target?.encounterId);
    const next: HudSnapshot = {
      name: personal?.progress.name ?? 'Local guest', className: definition.name, level: personal?.progress.level ?? 1,
      health: personal?.recovery.health ?? definition.baseStats.maxHealth, maxHealth: definition.baseStats.maxHealth,
      mana: personal?.recovery.mana ?? definition.baseStats.maxMana, maxMana: definition.baseStats.maxMana,
      status: this.state.connection.status, ready: this.state.connection.status === 'ready', sceneStatus: this.sceneStatus,
      selectedEnemy: enemy ? this.content.enemies.find(e => e.id === enemy.definitionId)?.name ?? null : null,
      selectedHealth: enemy?.health ?? null, selectedMaxHealth: enemy?.maxHealth ?? null,
      message: this.state.connection.status === 'error' ? this.state.connection.message : this.message,
    };
    // Position/authority time are intentionally absent. Walking never notifies React.
    if (this.hud && JSON.stringify(next) === JSON.stringify(this.hud)) return;
    this.hud = Object.freeze(next); for (const listener of this.hudListeners) listener();
  }
}
