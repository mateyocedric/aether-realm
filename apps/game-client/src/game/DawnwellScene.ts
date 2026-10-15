import Phaser from 'phaser';
import type { ContentPack, MapDefinition, SpriteDefinition } from '@aether/content';
import type { DeepReadonly, EnemyHandle, ObservedGameState } from '@aether/game-core';
import type { GameController } from '../bridge/GameController';
import { textEntryHasFocus } from './input';

type Actor = {
  root: Phaser.GameObjects.Container;
  visual: Phaser.GameObjects.Container;
  kind: 'player' | 'enemy' | 'npc';
  enemy: EnemyHandle | null;
  npcId: string | null;
};

/** Rendering/input only. All movement arrives through the typed session bridge. */
export class DawnwellScene extends Phaser.Scene {
  private readonly controller: GameController;
  private readonly pack: ContentPack;
  private readonly map: MapDefinition;
  private state: DeepReadonly<ObservedGameState>;
  private player: Actor | null = null;
  private readonly actors: Actor[] = [];
  private readonly enemies = new Map<string, Actor>();
  private destination!: Phaser.GameObjects.Graphics | Phaser.GameObjects.Image;
  private selection!: Phaser.GameObjects.Graphics | Phaser.GameObjects.Image;
  private unsubscribe: (() => void) | null = null;
  private failed = false;
  private frames = 0;
  private lastPosition = '';

  constructor(controller: GameController) {
    super({ key: 'shared-map' });
    this.controller = controller; this.pack = controller.content; this.state = controller.getRenderState();
    const mapId = this.state.room?.mapId ?? this.pack.characters[0]!.initialMapId;
    this.map = this.pack.maps.find(map => map.id === mapId)!;
  }
  preload(): void {
    // Texture references come from the pack. Placeholders are never fetched.
    for (const asset of this.pack.assets) {
      if (asset.status === 'ready' && ['background', 'sprite_sheet', 'effect'].includes(asset.kind))
        this.load.image(asset.id, `/api/assets?id=${encodeURIComponent(asset.id)}`);
    }
    this.load.on('loaderror', (file: Phaser.Loader.File) => {
      this.failed = true; this.controller.reportError(`Could not load asset ${file.key}. Check its definition/file.`);
    });
  }
  create(): void {
    if (this.failed) return;
    const canvas = this.game.canvas;
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', `${this.map.name} interactive scene. Click ground to move.`);
    canvas.dataset.worldWidth = String(this.map.world.width);
    canvas.dataset.worldHeight = String(this.map.world.height);
    canvas.dataset.enemyCount = String(this.map.enemies.length);
    canvas.dataset.npcCount = String(this.map.npcs.length);
    this.drawMap();
    this.prepareSprites();
    const personal = this.state.personal;
    const template = this.pack.characters[0]!;
    const name = personal?.progress.name ?? 'Local guest';
    const playerAppearance = this.pack.appearances.find(a => a.id === (personal?.progress.appearanceId ?? template.appearanceId))!;
    const playerSprites = [...playerAppearance.layers].sort((a, b) => a.order - b.order).map(layer => this.pack.sprites.find(s => s.id === layer.spriteId)!);
    const weapon = this.pack.items.find(item => item.id === template.equipment.weaponItemId);
    if (weapon?.kind === 'weapon') playerSprites.push(this.pack.sprites.find(sprite => sprite.id === weapon.visualSpriteId)!);
    this.player = this.actor(name, playerSprites, this.map.playerSpawn.x, this.map.playerSpawn.y, 'player');
    for (const placement of this.map.npcs) {
      const npc = this.pack.npcs.find(npc => npc.id === placement.npcId)!;
      const appearance = this.pack.appearances.find(a => a.id === npc.appearanceId)!;
      const sprites = [...appearance.layers].sort((a, b) => a.order - b.order).map(layer => this.pack.sprites.find(s => s.id === layer.spriteId)!);
      const actor = this.actor(npc.name, sprites, placement.position.x, placement.position.y, 'npc');
      actor.npcId = npc.id;
    }
    for (const placement of this.map.enemies) {
      const enemy = this.pack.enemies.find(enemy => enemy.id === placement.enemyId)!;
      const sprite = this.pack.sprites.find(sprite => sprite.id === enemy.spriteId)!;
      const actor = this.actor(`${enemy.name} · ${placement.id.toUpperCase()}`, [sprite], placement.position.x, placement.position.y, 'enemy');
      this.enemies.set(placement.id, actor);
    }
    this.destination = this.marker(this.map.presentation?.destinationMarkerAssetId, 0xf3d78c);
    this.selection = this.marker(this.map.presentation?.selectionMarkerAssetId, 0xd7aceb);
    this.destination.setVisible(false); this.selection.setVisible(false);
    this.unsubscribe = this.controller.observeRender(state => { this.state = state; });
    this.input.on('pointerdown', this.onPointerDown, this);
    canvas.addEventListener('keydown', this.onKeyDown);
    const cleanup = () => {
      this.unsubscribe?.(); this.unsubscribe = null;
      this.input.off('pointerdown', this.onPointerDown, this);
      canvas.removeEventListener('keydown', this.onKeyDown);
      canvas.dataset.sceneReady = 'false';
    };
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, cleanup);
    this.events.once(Phaser.Scenes.Events.DESTROY, cleanup);
    this.controller.setSceneReady(true); canvas.dataset.sceneReady = 'true';
    this.update();
  }
  update(): void {
    if (!this.player || !this.destination) return;
    const canvas = this.game.canvas;
    canvas.dataset.frames = String(++this.frames);
    const own = this.state.room?.players.find(player => player.characterId === this.state.personal?.progress.characterId);
    if (own) {
      this.player.root.setPosition(own.position.x, own.position.y).setDepth(own.position.y);
      this.player.visual.setScale(own.facing === 'left' ? -1 : 1, 1);
      const position = `${own.position.x}:${own.position.y}:${own.facing}`;
      if (position !== this.lastPosition) {
        this.lastPosition = position;
        canvas.dataset.playerX = String(own.position.x); canvas.dataset.playerY = String(own.position.y);
        canvas.dataset.playerDepth = String(this.player.root.depth); canvas.dataset.playerFacing = own.facing;
      }
    }
    const destination = this.state.personal?.roomState?.destination;
    this.destination.setVisible(!!destination);
    canvas.dataset.destinationX = destination ? String(destination.x) : '';
    canvas.dataset.destinationY = destination ? String(destination.y) : '';
    if (destination) this.destination.setPosition(destination.x, destination.y).setDepth(destination.y - 1);
    for (const enemy of this.state.room?.enemies ?? []) {
      const actor = this.enemies.get(enemy.placementId);
      if (actor) { actor.enemy = { ...enemy.handle }; actor.root.setPosition(enemy.position.x, enemy.position.y).setDepth(enemy.position.y); }
    }
    const target = this.state.personal?.roomState?.selectedTarget;
    const selected = this.state.room?.enemies.find(enemy => enemy.handle.instanceId === target?.instanceId && enemy.handle.encounterId === target?.encounterId);
    this.selection.setVisible(!!selected);
    if (selected) this.selection.setPosition(selected.position.x, selected.position.y).setDepth(selected.position.y - 1);
  }

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    if (pointer.event.target !== this.game.canvas || !pointer.leftButtonDown() || this.state.connection.status !== 'ready') return;
    this.game.canvas.focus({ preventScroll: true });
    void this.controller.dispatch({ kind: 'input_focus', blocked: false });
    const world = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
    // Foreground actors take precedence; scene geometry is not collision geometry.
    const hit = [...this.actors].sort((a, b) => b.root.depth - a.root.depth).find(actor => actor.kind !== 'player' && actor.visual.getBounds().contains(world.x, world.y));
    if (hit?.kind === 'enemy' && hit.enemy) void this.controller.dispatch({ kind: 'select_target', target: hit.enemy });
    else if (hit?.kind === 'npc' && hit.npcId) void this.controller.dispatch({ kind: 'inspect_npc', npcId: hit.npcId });
    else void this.controller.dispatch({ kind: 'move', destination: { x: world.x, y: world.y } });
  }
  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat || textEntryHasFocus() || this.state.connection.status !== 'ready') return;
    if (['Space', 'Digit1', 'Digit2'].includes(event.code)) {
      event.preventDefault(); void this.controller.dispatch({ kind: 'deferred_action' });
    }
  };
  private drawMap(): void {
    const map = this.map, w = map.world.width, h = map.world.height, b = map.walkable;
    const background = this.pack.assets.find(asset => asset.id === map.backgroundAssetId)!;
    if (background.status === 'ready') this.add.image(0, 0, background.id).setOrigin(0).setDisplaySize(w, h);
    else {
      const g = this.add.graphics();
      g.fillStyle(0x293f38).fillRect(0, 0, w, h);
      g.fillStyle(0x405b49).fillRect(0, h * 0.24, w, h * 0.45);
      for (let i = 0; i < 14; i++) {
        const x = (i + 0.5) * w / 14;
        g.fillStyle(0x23382f).fillRect(x - 9, h * 0.1, 18, b.minY - h * 0.1);
        g.fillStyle(i % 2 ? 0x345640 : 0x3f6349).fillCircle(x, h * 0.22, w * 0.066);
      }
      g.fillStyle(0x536852).fillRoundedRect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY, 22);
      g.fillStyle(0x9f9d62, 0.26).fillRect(b.minX, b.minY, map.safeArea.boundaryX - b.minX, b.maxY - b.minY);
      g.lineStyle(1, 0xb9c9a0, 0.12);
      for (let i = 1; i < 12; i++) g.lineBetween(b.minX + (b.maxX - b.minX) * i / 12, b.minY, b.minX + (b.maxX - b.minX) * i / 12, b.maxY);
      const shrineX = (b.minX + map.safeArea.boundaryX) / 2, shrineY = b.minY - 55;
      g.fillStyle(0x8e9b82).fillRoundedRect(shrineX - 65, shrineY + 20, 130, 24, 8);
      g.fillStyle(0xb9c9a0).fillRect(shrineX - 12, shrineY - 66, 24, 87);
      g.fillStyle(0xeed899).fillCircle(shrineX, shrineY - 79, 24);
      this.add.text(shrineX, shrineY - 124, 'SAFE SHRINE', { fontSize: '14px', color: '#f4e4af', letterSpacing: 3 }).setOrigin(0.5);
      this.add.text(w / 2, h * 0.1, 'ILLUSTRATED SCENE PLACEHOLDER', { fontSize: '12px', color: '#acbd9c', letterSpacing: 3 }).setOrigin(0.5);
    }
    const lines = this.add.graphics().setDepth(1);
    lines.lineStyle(2, 0xd1dcb9, 0.45).strokeRoundedRect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY, 12);
    lines.lineStyle(2, 0xeed899, 0.8).lineBetween(map.safeArea.boundaryX, b.minY - 8, map.safeArea.boundaryX, b.maxY + 8);
    this.add.text(map.safeArea.boundaryX + 16, b.minY - 26, 'CLEARING →', { fontSize: '12px', color: '#d8ddbb', letterSpacing: 2 });
  }
  private prepareSprites(): void {
    for (const sprite of this.pack.sprites) {
      const asset = this.pack.assets.find(asset => asset.id === sprite.assetId)!;
      if (asset.status === 'ready') {
        const texture = this.textures.get(asset.id);
        for (const frame of sprite.frames) if (!texture.has(String(frame.index))) texture.add(frame.index, 0, frame.x, frame.y, frame.width, frame.height);
      } else {
        const frame = sprite.frames[0]!, a = sprite.groundAnchorPx;
        const g = this.add.graphics();
        const weapon = this.pack.items.some(item => item.kind === 'weapon' && item.visualSpriteId === sprite.id);
        const enemy = this.pack.enemies.some(enemy => enemy.spriteId === sprite.id);
        if (weapon) {
          const hand = sprite.attachments.find(attachment => attachment.name === 'weapon_hand')?.positionPx ?? { x: a.x + 20, y: a.y - 40 };
          g.fillStyle(0xe8ddbd).fillRect(hand.x - 3, hand.y - 27, 6, 42);
          g.fillStyle(0xc29c56).fillRect(hand.x - 10, hand.y + 13, 20, 4);
        } else if (enemy) {
          g.fillStyle(0x8f70a5).fillEllipse(a.x, a.y - 21, 44, 36);
          g.fillStyle(0x594268).fillTriangle(a.x - 18, a.y - 27, a.x - 28, a.y - 49, a.x - 4, a.y - 37);
          g.fillStyle(0xd3bfdf).fillCircle(a.x + 10, a.y - 29, 4);
          g.fillStyle(0x483b4e).fillRect(a.x - 16, a.y - 5, 8, 6).fillRect(a.x + 8, a.y - 5, 8, 6);
        } else {
          g.fillStyle(0x283b35).fillRect(a.x - 17, a.y - 30, 13, 30).fillRect(a.x + 4, a.y - 30, 13, 30);
          g.fillStyle(0xc4ba86).fillRoundedRect(a.x - 23, a.y - 76, 46, 49, 8);
          g.fillStyle(0xe1c6a0).fillCircle(a.x, a.y - 91, 15);
          g.fillStyle(0x667d6e).fillRoundedRect(a.x - 27, a.y - 67, 12, 33, 3);
          g.fillStyle(0x405147).fillCircle(a.x + 7, a.y - 93, 2);
        }
        g.generateTexture(`placeholder_${sprite.id}`, frame.width, frame.height); g.destroy();
      }
    }
  }
  private actor(name: string, sprites: SpriteDefinition[], x: number, y: number, kind: Actor['kind']): Actor {
    const root = this.add.container(x, y).setDepth(y);
    const visual = this.add.container(0, 0);
    root.add(this.add.ellipse(0, 0, kind === 'enemy' ? 48 : 56, 13, 0x17271f, 0.4));
    root.add(visual);
    let placeholder = false;
    for (const sprite of sprites) {
      const asset = this.pack.assets.find(asset => asset.id === sprite.assetId)!;
      const idleFrame = sprite.clips.find(clip => clip.name === 'idle')?.frames[0] ?? sprite.frames[0]!.index;
      const frame = sprite.frames.find(frame => frame.index === idleFrame)!, scale = sprite.worldUnitsPerPixel;
      placeholder ||= asset.status === 'placeholder';
      visual.add(this.add.image(-sprite.groundAnchorPx.x * scale, -sprite.groundAnchorPx.y * scale,
        asset.status === 'ready' ? asset.id : `placeholder_${sprite.id}`, asset.status === 'ready' ? frame.index : undefined).setOrigin(0).setScale(scale));
    }
    root.add(this.add.text(0, 16, `${name}${placeholder ? '\nplaceholder' : ''}`, { fontSize: '12px', color: kind === 'enemy' ? '#e6c6ee' : '#f0e7c9', align: 'center', backgroundColor: '#23392dbb', padding: { x: 5, y: 3 } }).setOrigin(0.5, 0));
    const actor: Actor = { root, visual, kind, enemy: null, npcId: null }; this.actors.push(actor); return actor;
  }
  private marker(assetId: string | undefined, color: number): Phaser.GameObjects.Graphics | Phaser.GameObjects.Image {
    const asset = this.pack.assets.find(asset => asset.id === assetId);
    if (asset?.status === 'ready') return this.add.image(0, 0, asset.id).setDisplaySize(40, 24);
    const marker = this.add.graphics();
    marker.lineStyle(2, color, 0.9).strokeEllipse(0, 0, 34, 14);
    marker.lineBetween(-5, 0, 5, 0).lineBetween(0, -4, 0, 4);
    return marker;
  }
}
