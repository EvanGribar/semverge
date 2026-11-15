'use client';

import { useState } from 'react';
import { Button } from '@ui-sdk/react/button';
import { Stage } from './stageshow-kit/stage';
import { Window } from './stageshow-kit/window';
import { Collapse } from './stageshow-kit/motion/collapse';
import type { Act } from './stageshow-kit/act';

type QueueState = { open: boolean; file: boolean };
const queueStart: QueueState = { open: false, file: false };
const queuePoster: QueueState = { open: true, file: true };

async function queueStory(act: Act<QueueState>) {
  await act.wait(850);
  await act.move('open-release', { duration: 520 });
  await act.wait(260);
  await act.click();
  act.put({ open: true });
  act.mark('blocker-revealed');
  await act.wait(2350);
  await act.move('missing-file', { duration: 550 });
  await act.wait(260);
  await act.click();
  act.put({ file: true });
  act.mark('file-evidence');
  await act.wait(4850);
}

export function QueueScene() {
  const [replay, setReplay] = useState(0);
  return (
    <div className="queue-stage">
      <div role="img" aria-label="Example release queue. Billing API version 1.8.0 is blocked by a missing migration guide. The previous release, 1.7.0, was published.">
        <Stage key={replay} width={690} height={500} compact={{ below: 560, width: 358, height: 338 }}
          palette="mono" fidelity="realistic" className="landing-stage" play="once"
          cursor={{ at: 'queue-name', idle: 2200 }} initial={queueStart} poster={queuePoster} script={queueStory}>
          {(scene) => (
            <Window url="SemVerge Cloud · Example" lights="grey" className="demo-window">
              <div className="demo-queue">
                <div className="demo-topline"><span>Releases</span><span data-target="queue-name">billing-api</span></div>
                <div className="demo-version"><span>v1.7.0</span> <span>→</span> v1.8.0</div>
                <div className="demo-queue-label">Open release plan</div>
                <div className="demo-release-row" data-target="open-release" data-cursor="pointer">
                  <span>v1.8.0</span><span className="demo-status">Blocked</span>
                </div>
                <div className="demo-past-row"><span>v1.7.0</span><span>Published</span></div>
                <Collapse open={scene.open} reveal="drop">
                  <div className="demo-evidence" data-target="missing-file" data-cursor="pointer">
                    <strong>Migration guide missing</strong>
                    <span>Required file · MIGRATION.md</span>
                  </div>
                  <div className="demo-file-result" data-active={scene.file}>Add the guide to clear this release check.</div>
                </Collapse>
              </div>
            </Window>
          )}
        </Stage>
      </div>
      <Button className="demo-replay" onClick={() => setReplay((value) => value + 1)}>Replay queue walkthrough</Button>
    </div>
  );
}

type NotesState = { view: 'customer' | 'technical' };
const notesStart: NotesState = { view: 'customer' };
const notesPoster: NotesState = { view: 'technical' };

async function notesStory(act: Act<NotesState>) {
  await act.wait(3000);
  await act.move('technical-tab', { duration: 600 });
  await act.wait(220);
  await act.click();
  act.put({ view: 'technical' });
  act.mark('technical-notes');
  await act.wait(6300);
}

export function NotesScene() {
  const [replay, setReplay] = useState(0);
  return (
    <div className="notes-stage">
      <div role="img" aria-label="Example release notes. Customer impact describes bulk invoice export. Technical changes show the billing export endpoint and its required permission.">
        <Stage key={replay} width={540} height={315} compact={{ below: 500, width: 358, height: 300 }}
          theme="dark" palette="mono" fidelity="realistic" className="landing-stage" play="once"
          cursor={{ at: 'customer-tab', idle: 2200 }} initial={notesStart} poster={notesPoster} script={notesStory}>
          {(scene) => (
            <Window url="Release notes · v1.8.0" lights="grey" className="demo-window">
              <div className="demo-note-tabs">
                <span data-target="customer-tab" data-active={scene.view === 'customer'}>Customer impact</span>
                <span data-target="technical-tab" data-cursor="pointer" data-active={scene.view === 'technical'}>Technical changes</span>
              </div>
              <div className="demo-note-panels">
                <div data-active={scene.view === 'customer'}>
                  <strong>Export invoices in bulk</strong>
                  <p>Finance teams can export multiple invoices in one CSV.</p>
                </div>
                <div data-active={scene.view === 'technical'}>
                  <strong>Invoice export endpoint</strong>
                  <code>POST /invoices/export</code>
                  <p>Requires the <code>billing:read</code> permission.</p>
                </div>
              </div>
            </Window>
          )}
        </Stage>
      </div>
      <Button className="demo-replay" onClick={() => setReplay((value) => value + 1)}>Replay release notes walkthrough</Button>
    </div>
  );
}
