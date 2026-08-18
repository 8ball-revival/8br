import { withPayload } from '@payloadcms/next/withPayload'
import type { NextConfig } from 'next'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(__filename)

const nextConfig: NextConfig = {
  images: {
    /*
      Media is served from /api/media/file/** and normally referenced with a relative path, which is
      what localPatterns below allows. But once NEXT_PUBLIC_SITE_URL is configured, Payload returns
      ABSOLUTE urls for uploads (https://8br.gg/api/media/file/...), and an absolute url is a REMOTE
      one as far as the optimizer is concerned — localPatterns does not apply to it. With no
      remotePatterns declared the optimizer refuses the request outright, and every next/image brand
      asset renders as a broken image while the underlying file serves perfectly well on its own.

      That is exactly what happened on the first production deploy: the header logo and the homepage
      hero banner 400'd through /_next/image, while /api/media/file/8br-logo.png returned 200.

      So the site's own origin is declared here too. It is derived from NEXT_PUBLIC_SITE_URL rather
      than hardcoded, so staging and any future domain keep working without another edit.
    */
    remotePatterns: (() => {
      const raw = process.env.NEXT_PUBLIC_SITE_URL
      if (!raw) return []
      try {
        const url = new URL(raw)
        return [{
          protocol: url.protocol.replace(':', '') as 'http' | 'https',
          hostname: url.hostname,
          pathname: '/api/media/file/**',
        }]
      } catch {
        return []
      }
    })(),
    localPatterns: [
      {
        pathname: '/api/media/file/**',
      },
      {
        // 8BR static brand assets in /public (e.g. the homepage hero banner).
        pathname: '/8br-*',
      },
      {
        // Static brand assets in /public/assets/branding (header logo, homepage banner).
        pathname: '/assets/branding/**',
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
      // Set SITE_WWW_HOST="www.cueverse.net" + SITE_APEX_ORIGIN="https://cueverse.net".
      ...(process.env.SITE_WWW_HOST && process.env.SITE_APEX_ORIGIN
        ? [
            {
              source: '/:path*',
              has: [{ type: 'host' as const, value: process.env.SITE_WWW_HOST }],
              destination: `${process.env.SITE_APEX_ORIGIN}/:path*`,
              permanent: true,
            },
          ]
        : []),
    ]
  },
}

export default withPayload(nextConfig, { devBundleServerPackages: false })
