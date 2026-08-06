import { withPayload } from '@payloadcms/next/withPayload'
import type { NextConfig } from 'next'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(__filename)

const nextConfig: NextConfig = {
  images: {
    localPatterns: [
      {
        pathname: '/api/media/file/**',
      },
    ],
  },
  webpack: (webpackConfig) => {
    webpackConfig.resolve.extensionAlias = {
      '.cjs': ['.cts', '.cjs'],
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
    }

    return webpackConfig
  },
  turbopack: {
    root: path.resolve(dirname),
  },
  async redirects() {
    return [
      // Canonical host: send www.8br.gg → apex 8br.gg (matches NEXT_PUBLIC_SITE_URL).
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'www.8br.gg' }],
        destination: 'https://8br.gg/:path*',
        permanent: true,
      },
      // Retired duplicate player profile → canonical Luis (same real person).
      { source: '/players/luis-p0027', destination: '/players/luis', permanent: true },
    ]
  },
}

export default withPayload(nextConfig, { devBundleServerPackages: false })
