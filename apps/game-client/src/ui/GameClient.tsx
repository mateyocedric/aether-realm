'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { GameSession } from '@aether/game-core';
import { GameController } from '../bridge/GameController';
import { loadContent } from '../game/content';

const PhaserHost = dynamic(() => import('../game/PhaserHost'), { ssr: false, loading: () => <div className="scene-loading">Preparing the scene…</div> });
const localEnabled = process.env.NODE_ENV === 'development' || process.env.NEXT_PUBLIC_GAME_MODE === 'local-development';

export default function GameClient() {
  const [controller, setController] = useState<GameController | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!localEnabled) return;
    const abort = new AbortController();
    let active = true, owned: GameController | null = null;
    void (async () => {
      try {
        const content = await loadContent(abort.signal);
        // This is the only adapter-selection point; renderer/panels see GameSession.
        const { LocalGameSession } = await import('../adapters/local/LocalGameSession');
        if (!active) return;
        const session: GameSession = new LocalGameSession(content, {
          now: () => performance.timeOrigin + performance.now(),
          requestFrame: callback => requestAnimationFrame(callback), cancelFrame: id => cancelAnimationFrame(id),
        });
        owned = new GameController(session, content);
        await owned.connect();
        if (active) setController(owned);
      } catch (error) {
        if (active) setError(error instanceof Error ? error.message : 'Could not load the game.');
      }
    })();
    return () => { active = false; abort.abort(); owned?.dispose(); };
  }, []);

  if (!localEnabled) return <div className="notice"><h1>Local preview is disabled</h1><p>Run <code>pnpm dev</code>, or build an explicit local preview with <code>NEXT_PUBLIC_GAME_MODE=local-development pnpm build</code>.</p><Link href="/">Return to the entrance</Link></div>;
  if (error) return <div className="notice" role="alert"><h1>Could not enter the glade</h1><p>{error}</p><Link href="/">Return to the entrance</Link></div>;
  if (!controller) return <div className="notice" role="status">Loading and validating the content pack…</div>;
  return <GameExperience controller={controller} />;
}

function GameExperience({ controller }: { controller: GameController }) {
  const hud = useSyncExternalStore(controller.observeHud, controller.getHudSnapshot, controller.getHudSnapshot);
  const renders = useRef(0); renders.current++;
  const content = controller.content;
  const map = content.maps.find(map => map.id === content.characters[0]!.initialMapId)!;
  const definition = content.classes.find(c => c.id === content.characters[0]!.classId)!;
  const placeholders = content.assets.filter(asset => asset.status === 'placeholder').length;
  return <main className="game-shell" data-hud-renders={renders.current}>
    <header className="game-heading">
      <Link className="brand" href="/" prefetch={false}>AETHER <span>Return to entrance</span></Link>
      <div className="mode-badge"><i /> Local Development</div>
    </header>
    <div className="map-heading"><div><span className="eyebrow">First steps in Aether</span><h1>{map.name}</h1></div><p>One local Guardian. Original art is still being prepared.</p></div>
    <section className="world-stage" style={{ aspectRatio: `${map.world.width} / ${map.world.height}` }} aria-label="Game scene">
      <PhaserHost controller={controller} />
      <aside className="hud-panel" data-game-panel onPointerDown={event => event.stopPropagation()} aria-label="Character HUD">
        <div className="identity"><div className="avatar">✦</div><div><strong>{hud.name}</strong><span>{hud.className} · Level {hud.level}</span></div></div>
        <div className="resource"><span>Health</span><strong>{hud.health} / {hud.maxHealth}</strong><progress className="health" value={hud.health} max={hud.maxHealth} aria-label="Health" /></div>
        <div className="resource"><span>Mana</span><strong>{hud.mana} / {hud.maxMana}</strong><progress className="mana" value={hud.mana} max={hud.maxMana} aria-label="Mana" /></div>
        <div className="connection"><i className={hud.ready ? 'online' : ''} /><span data-session-status>{hud.status}</span></div>
      </aside>
      <aside className="notes-panel" data-game-panel onPointerDown={event => event.stopPropagation()} aria-label="Local scratchpad">
        <label htmlFor="local-notes">Local scratchpad <span>not saved</span></label>
        <textarea id="local-notes" placeholder="Your notes on the glade…" rows={2} onFocus={() => { void controller.dispatch({ kind: 'input_focus', blocked: true }); }} onBlur={() => { void controller.dispatch({ kind: 'input_focus', blocked: false }); }} />
      </aside>
      {hud.sceneStatus === 'loading' && <div className="scene-loading" role="status">Preparing placeholder assets…</div>}
      {hud.sceneStatus === 'error' && <div className="scene-loading error" role="alert">{hud.message}</div>}
      <div className="scene-caption">{placeholders} asset placeholders · {map.world.width} × {map.world.height} world</div>
    </section>
    <section className="control-bar" data-game-panel onPointerDown={event => event.stopPropagation()} aria-label="Game controls">
      <div className="movement-help"><span className="eyebrow">Explore the clearing</span><p>Click ground to move <span>· {definition.movementSpeed} units/s</span></p><small>Click a Thornling to select it. Mira waits by the shrine.</small></div>
      <div className="actions">{definition.skillIds.map((id, index) => { const skill = content.skills.find(s => s.id === id)!; return <button key={id} type="button" disabled title="Combat is deferred to M3"><kbd>{index === 0 ? 'Space' : index}</kbd><span>{skill.name}</span><small>M3</small></button>; })}</div>
    </section>
    <div className="feedback" role="status" data-game-feedback>{hud.message}{hud.selectedEnemy && <span className="selected">Selected: {hud.selectedEnemy} · {hud.selectedHealth} / {hud.selectedMaxHealth}</span>}</div>
    <footer className="milestone-note">M2 · Scene, movement &amp; input foundation. Combat, quests, inventory interactions, and multiplayer are later milestones.</footer>
  </main>;
}
