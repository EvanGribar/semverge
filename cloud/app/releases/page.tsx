import { Workspace } from '../workspace';
import { loadQueue, loadReleaseHistory } from '../workspace-data';

export const revalidate = 300;

export default async function ReleasesPage() {
  const [published, queue] = await Promise.all([loadReleaseHistory(), loadQueue()]);
  return <Workspace example={published} queue={queue} />;
}
