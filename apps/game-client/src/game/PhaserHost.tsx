'use client';

import Phaser from 'phaser';
import { useEffect, useRef } from 'react';
import type { GameController } from '../bridge/GameController';
import { DawnwellScene } from './DawnwellScene';

export default function PhaserHost({ controller }: { controller: GameController }) {
  const parent = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = parent.current;
    if (!element) return;
    let game: Phaser.Game | null = null;
    let observer: ResizeObserver | null = null;
    // Strict Mode's throwaway effect is cancelled before creating a Phaser game.
    const mount = requestAnimationFrame(() => {
      const state = controller.getRenderState();
      const mapId = state.room?.mapId ?? controller.content.characters[0]!.initialMapId;
      const map = controller.content.maps.find(map => map.id === mapId)!;
      try {
        game = new Phaser.Game({
          type: Phaser.CANVAS, parent: element, width: map.world.width, height: map.world.height,
          backgroundColor: '#293f38', scene: [new DawnwellScene(controller)],
          scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
          input: { keyboard: false }, audio: { noAudio: true },
        });
        observer = new ResizeObserver(() => { game?.scale.refresh(); });
        observer.observe(element);
      } catch (error) { controller.reportError(error instanceof Error ? error.message : 'Scene initialization failed.'); }
    });
    return () => {
      cancelAnimationFrame(mount); observer?.disconnect();
      controller.setSceneReady(false); game?.destroy(true);
    };
  }, [controller]);
  return <div className="phaser-parent" ref={parent} />;
}
