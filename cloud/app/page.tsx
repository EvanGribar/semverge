import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { OpenWorkspace } from './landing-actions';
import { NotesScene, QueueScene } from './landing-scenes';
import './landing.css';

const manrope = localFont({
  src: '../../website/manrope-variable.ttf',
  variable: '--landing-font',
  weight: '200 800',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'SemVerge — Release readiness for GitHub',
  description: 'See what’s ready to ship, what’s holding it up, and what changed for customers and engineers.',
  openGraph: { title: 'SemVerge — Release readiness for GitHub', description: 'Release blockers, customer notes, and verification evidence in one workspace.', type: 'website' },
  other: { 'page-type': 'software', 'site-kind': 'software' },
};

const github = 'https://github.com/EvanGribar/semverge';

export default function LandingPage() {
  return (
    <div className={`landing ${manrope.variable}`}>
      <header className="nav landing-nav">
        <div className="wrap">
          <a className="skip-link" href="#top">Skip to content</a>
          <a className="landing-brand" href="/">SemVerge<span aria-hidden="true">.</span></a>
          <nav aria-label="Main navigation">
            <a href="#workflow">Workflow</a>
            <a href={github}>GitHub</a>
          </nav>
          <OpenWorkspace inNavigation />
        </div>
      </header>
      <main id="top" className="landing-main">
        <section id="hero" className="landing-hero">
          <div className="wrap hero-grid">
            <div className="hero-text hero-copy" data-enter>
              <h1>Release readiness<br className="hero-break" /> for GitHub</h1>
              <p>See what’s ready to ship, what’s holding it up, and what changed for customers and engineers.</p>
              <div className="landing-actions">
                <OpenWorkspace />
                <a className="landing-link" href={`${github}#quick-start`}>Get the GitHub Action</a>
              </div>
            </div>
            <QueueScene />
          </div>
        </section>

        <section id="workflow" className="section landing-workflow">
          <div className="wrap">
            <h2>One release, two audiences</h2>
            <p className="workflow-lead">Give product and support the customer story. Give engineers the version, the changelog, and the migration steps.</p>
            <div className="workflow-grid">
              <NotesScene />
              <ol className="workflow-steps">
                <li>
                  <h3>Plan in GitHub</h3>
                  <p>The open-source CLI and Action calculate the next version. The release PR records what ships and which requirements are still open.</p>
                </li>
                <li>
                  <h3>Review in SemVerge Cloud</h3>
                  <p>Read blockers and release notes, browse version history, and follow the evidence back to GitHub.</p>
                </li>
                <li>
                  <h3>Verify after publication</h3>
                  <p>See the recorded post-release result alongside the published version.</p>
                </li>
                <li className="workflow-action"><OpenWorkspace /></li>
              </ol>
            </div>
          </div>
        </section>
      </main>
      <footer className="closing landing-footer">
        <div className="wrap">
          <nav aria-label="Footer"><a href="/">SemVerge</a><a href={github}>MIT-licensed on GitHub</a></nav>
        </div>
      </footer>
    </div>
  );
}
