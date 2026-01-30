import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
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
