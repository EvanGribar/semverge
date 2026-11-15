import type { Metadata } from 'next';
import './styles.css';

export const metadata: Metadata = {
  title: 'SemVerge Cloud',
  description: 'See what’s shipping, what changed, and what’s blocking your next release.',
};

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" data-type="software"><body>{children}</body></html>;
}

