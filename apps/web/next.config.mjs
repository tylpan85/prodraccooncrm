import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  transpilePackages: ['@openclaw/shared'],
  turbopack: {
    root: path.resolve(__dirname, '../..'),
  },
  allowedDevOrigins: ['192.168.1.215', '73.111.4.104'],
  async rewrites() {
    return [
      { source: '/api/:path*', destination: 'http://127.0.0.1:4000/api/:path*' },
    ];
  },
};

export default nextConfig;
