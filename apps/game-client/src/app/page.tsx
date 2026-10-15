import Link from 'next/link';

export default function Entrance() {
  return <main className="entrance">
    <div className="mode-badge"><i /> Local Development</div>
    <div className="entrance-star" aria-hidden="true">✦</div>
    <span className="eyebrow">A woodland beginning</span>
    <h1>Aether</h1><h2>Dawnwell Glade</h2>
    <p>Meet the light of the Dawnwell. Walk its clearing, find Keeper Mira, and take your first steps as a Guardian.</p>
    <Link className="enter-button" href="/play" prefetch={false}>Enter the glade <span>→</span></Link>
    <small>M2 local scene preview · Labeled placeholder art<br />Combat and multiplayer are still to come.</small>
  </main>;
}
