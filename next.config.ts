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
  outputFileTracingIncludes: {
    '/api/admin/ops/invoices/**': ['./public/images/services/**/*'],
    '/api/admin/ops/appointments{,/**}': ['./public/images/services/**/*'],
    '/api/tech/appointments/**': ['./public/images/services/**/*'],
    '/api/cron/invoice-emails': ['./public/images/services/**/*'],
  },
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
