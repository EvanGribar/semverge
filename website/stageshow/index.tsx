import { Stage, Window } from '../../kit'
import './hero.css'

// Illustrative reconstruction of the workspace in PR #145; association is not causation.
export default function SemvergeContext() {
  return <Stage width={760} height={440} compact={{ below: 760, width: 358, height: 340 }} theme="dark" palette="mono" fidelity="realistic" initial={{}} className="sv-stage">
    {(_s, _rect, layout) => <Window title="semverge" lights="grey" sidebarWidth={168} sidebar={layout === 'compact' ? undefined : <Side />} className="sv-window">
      <div className="sv-body">
        <div className="sv-context">checkout <span>/</span> production</div>
        <div className="sv-title">Checkout endpoint unavailable</div>
        <div className="sv-meta"><span className="sv-status">Open</span><span>checkout · production</span></div>
        <div className="sv-section">Incident timeline</div>
        <div className="sv-record"><div className="sv-time">10:16</div><div><strong>Monitor incident opened</strong><p>Two consecutive HTTP checks failed</p></div></div>
        <div className="sv-record"><div className="sv-time">10:18</div><div><strong>Release evidence linked</strong><p>checkout v2.8.0 · linked by an operator</p></div></div>
        <div className="sv-note">A linked release is context, not a proven cause</div>
      </div>
    </Window>}
  </Stage>
}
function Side() {
  return <div className="sv-side"><div className="sv-wordmark">semverge</div><div>Overview</div><div>Releases</div><div>Monitoring</div><div className="sv-selected">Incidents</div><div className="sv-side-context">Service<br /><strong>checkout</strong><br />production</div></div>
}

