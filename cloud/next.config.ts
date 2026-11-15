import { resolve } from 'node:path';
import type { NextConfig } from 'next';

const root = resolve(__dirname, '..');
const config: NextConfig = {
  async headers() {
    return [{
      source: '/workspaces/:path*',
      headers: [
        { key: 'Cache-Control', value: 'private, no-store' },
        // Workspace forms need their Origin header for the server's same-origin check.
        { key: 'Referrer-Policy', value: 'same-origin' },
        { key: 'X-Robots-Tag', value: 'noindex' },
      ],
    }];
  },
  turbopack: { root },
  outputFileTracingRoot: root,
};

export default config;
