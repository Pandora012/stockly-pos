import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { createApp } from './app.js';

dotenv.config({ path: new URL('../../../.env', import.meta.url) });
const production = process.env.NODE_ENV === 'production';
const jwtSecret = process.env.JWT_SECRET;
const webOrigin = process.env.WEB_ORIGIN;
const sameSite = process.env.COOKIE_SAME_SITE ?? 'lax';
if (!jwtSecret || jwtSecret.length < 32 || jwtSecret.includes('replace-with-') || !webOrigin || !['lax', 'strict', 'none'].includes(sameSite)) {
  throw new Error('Configure a real JWT_SECRET (32+ characters), WEB_ORIGIN, and a valid COOKIE_SAME_SITE.');
}
if (sameSite === 'none' && !production) throw new Error('SameSite=None requires HTTPS and production mode.');
if (production && !webOrigin.startsWith('https://')) {
  throw new Error('WEB_ORIGIN must use HTTPS in production.');
}

const db = new PrismaClient();
const app = createApp(db, { production, jwtSecret, webOrigin, sameSite });
const server = app.listen(Number(process.env.PORT ?? 4000), () => console.log('Stockly API listening'));
process.on('SIGTERM', () => server.close(() => db.$disconnect()));
