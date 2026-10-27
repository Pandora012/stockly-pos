import dotenv from 'dotenv';

dotenv.config({ path: new URL('../../.env', import.meta.url) });

const config = {
  output: 'standalone',
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  env: { NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000' }
};

export default config;
