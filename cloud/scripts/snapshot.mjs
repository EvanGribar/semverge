import { cp, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../../', import.meta.url);
const [manifest, customerNotes, changelog] = await Promise.all(
  ['release-manifest.json', 'RELEASE_NOTES.md', 'CHANGELOG.md'].map(
    (file) => readFile(new URL(file, root), 'utf8'),
  ),
);
await writeFile(
  new URL('../app/public-release.json', import.meta.url),
  JSON.stringify({ manifest: JSON.parse(manifest), customerNotes, changelog }),
);

// Resolve the shared kit against Cloud's React dependencies on clean builds.
await cp(fileURLToPath(new URL('website/stageshow/kit/', root)), fileURLToPath(new URL('../app/stageshow-kit/', import.meta.url)), { recursive: true });
