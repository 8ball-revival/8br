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
      {
        // WCC static brand assets in /public (e.g. the homepage hero banner).
        pathname: '/wcc-*',
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
      // Legacy "Cups" URLs now live under "Tournaments".
      { source: '/cups', destination: '/tournaments', permanent: true },
      { source: '/cups/:path*', destination: '/tournaments/:path*', permanent: true },
      // Canonical host (www → apex) for cueverse.net.
      // Set WCC_WWW_HOST="www.cueverse.net" + WCC_APEX_ORIGIN="https://cueverse.net".
      ...(process.env.WCC_WWW_HOST && process.env.WCC_APEX_ORIGIN
        ? [
            {
              source: '/:path*',
              has: [{ type: 'host' as const, value: process.env.WCC_WWW_HOST }],
              destination: `${process.env.WCC_APEX_ORIGIN}/:path*`,
              permanent: true,
            },
          ]
        : []),
    ]
  },
}

export default withPayload(nextConfig, { devBundleServerPackages: false })
