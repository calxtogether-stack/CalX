import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: [
    '@calx/shared',
    '@calx/validation',
    '@calx/design-system',
    '@calx/crypto',
    '@calx/messaging',
  ],
  headers: async () => [
    {
      source: '/(.*)',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Referrer-Policy', value: 'no-referrer' },
      ],
    },
  ],
};

export default nextConfig;
