/** @type {import('next').NextConfig} */
const nextConfig = {
  // Disable source maps in production — prevents code exposure
  productionBrowserSourceMaps: false,

  // Remove X-Powered-By header
  poweredByHeader: false,

  // Strict React mode
  reactStrictMode: true,

  // Hardened headers
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-DNS-Prefetch-Control',  value: 'on' },
          { key: 'X-Content-Type-Options',   value: 'nosniff' },
          { key: 'X-Frame-Options',          value: 'SAMEORIGIN' },
          { key: 'X-XSS-Protection',         value: '1; mode=block' },
        ],
      },
      {
        // Block crawlers + disable caching on API routes
        source: '/api/:path*',
        headers: [
          { key: 'X-Robots-Tag',  value: 'noindex, nofollow' },
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate' },
        ],
      },
      {
        source: '/_next/static/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
    ];
  },

  // No source maps in production build
  webpack(config, { dev }) {
    if (!dev) config.devtool = false;
    return config;
  },

  experimental: {
    serverActions: { allowedOrigins: ['localhost:3000'] },
  },
};

module.exports = nextConfig;
