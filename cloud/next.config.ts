import { resolve } from 'node:path';
import type { NextConfig } from 'next';

const root = resolve(__dirname, '..');
const config: NextConfig = {
  async headers() {
    return [{
      source: '/workspaces/:path*',
      headers: [
        { key: 'Cache-Control', value: 'private, no-store' },
        { key: 'Referrer-Policy', value: 'no-referrer' },
        { key: 'X-Robots-Tag', value: 'noindex' },
      ],
    }];
  },
  turbopack: { root },
  outputFileTracingRoot: root,
};

export default config;
