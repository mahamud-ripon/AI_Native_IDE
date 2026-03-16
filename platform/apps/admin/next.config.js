/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  
  // Enable experimental features for Next.js 15
  experimental: {
    serverActions: {
      allowedOrigins: ['*.platform.io', 'localhost:3000'],
    },
  },
  
  // Environment variables exposed to browser
  env: {
    NEXT_PUBLIC_API_URL: process.env.API_GATEWAY_URL || 'http://localhost:8000',
    NEXT_PUBLIC_WS_URL: process.env.WS_URL || 'ws://localhost:8000',
  },
  
  // Redirects for common routes
  async redirects() {
    return [
      {
        source: '/admin',
        destination: '/',
        permanent: true,
      },
    ];
  },
};

module.exports = nextConfig;
