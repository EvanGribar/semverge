'use client';

import { Button } from '@ui-sdk/react/button';

export function OpenWorkspace({ inNavigation = false }: { inNavigation?: boolean }) {
  return (
    <Button className={`landing-button ${inNavigation ? 'nav-action' : 'action-arrow'}`} render={<a href="/releases" />}>
      Open workspace
    </Button>
  );
}
