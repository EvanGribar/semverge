import { Stage } from './kit/stage'
import type { Act } from './kit/act'
import { Window } from './kit/window'
import { Collapse } from './kit/motion/collapse'
import './hero.css'

// Illustrative reconstruction of the workspace in PR #145; association is not causation.
type Scene = { linked: boolean }
const initial: Scene = { linked: false }
async function story(a: Act<Scene>) {
  a.mark('incident')
  await a.wait(2400)
  a.mark('association')
  a.put({ linked: true })
  await a.wait(7000)
}
export default function SemvergeContext() {
  return <Stage width={760} height={440} compact={{ below: 650, width: 358, height: 340 }} theme="dark" palette="mono" fidelity="realistic" initial={initial} poster={{ linked: true }} script={story} play="once" className="sv-stage">
    {(s, _rect, layout) => <Window title="semverge" lights="grey" sidebarWidth={168} sidebar={layout === 'compact' ? undefined : <Side />} className="sv-window">
      <div className="sv-body">
        <div className="sv-context">checkout <span>/</span> production</div>
        <div className="sv-title">Checkout endpoint unavailable</div>
        <div className="sv-meta"><span className="sv-status">Open</span><span>checkout · production</span></div>
        <div className="sv-section">Incident timeline</div>
        <div className="sv-record"><div className="sv-time">10:16</div><div><strong>Monitor incident opened</strong><p>Two consecutive HTTP checks failed</p></div></div>
        <Collapse open={s.linked} reveal="drop"><div className="sv-record"><div className="sv-time">10:18</div><div><strong>Release evidence linked</strong><p>checkout v2.8.0 · linked by an operator</p></div></div></Collapse>
        <div className="sv-note">A linked release is context, not a proven cause</div>
      </div>
    </Window>}
  </Stage>
}
function Side() {
  return <div className="sv-side"><div className="sv-wordmark">semverge</div><div>Overview</div><div>Releases</div><div>Monitoring</div><div className="sv-selected">Incidents</div><div className="sv-side-context">Service<br /><strong>checkout</strong><br />production</div></div>
}
