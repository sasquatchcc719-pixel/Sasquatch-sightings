import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: '/sightings',
        destination: '/tap',
        permanent: false,
      },
      ...[
        'radar',
        'reviews',
        'coverage',
        'briefing',
        'grid',
        'sweep',
        'opportunities',
        'truck',
        'alerts',
      ].map((view) => ({
        source: '/admin/telegram',
        has: [{ type: 'query' as const, key: 'view', value: view }],
        destination: `/admin/telegram/${view}`,
        permanent: false,
      })),
    ]
  },
  cacheComponents: true,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.supabase.co',
      },
    ],
  },
}

export default nextConfig
