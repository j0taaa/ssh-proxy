import { scaffoldStatus } from "@ssh-proxy/protocol";

export default function Home() {
  return (
    <main>
      <section aria-labelledby="scaffold-title">
        <p className="eyebrow">Browser SSH Proxy</p>
        <h1 id="scaffold-title">Scaffold ready</h1>
        <p>{scaffoldStatus}</p>
        <p className="note">SSH connection flows are intentionally not implemented in this scaffold task.</p>
      </section>
    </main>
  );
}
