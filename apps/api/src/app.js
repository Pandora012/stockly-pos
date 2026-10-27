import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { catalogRouter } from './catalog.js';
import { salesRouter } from './sales.js';
import { reportsRouter } from './reports.js';
import { purchasingRouter } from './purchases.js';

const safeUser = { id: true, name: true, email: true, role: true, isActive: true, createdAt: true, updatedAt: true };
const credentials = z.object({ email: z.string().email().max(255), password: z.string().min(1) }).strict();
const createUser = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(255),
  password: z.string().min(12).max(128)
}).strict();
const editUser = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(12).max(128).optional()
}).strict().refine((value) => Object.keys(value).length > 0);
const dummyHash = bcrypt.hashSync('not-a-real-account', 12);
const cookieName = 'stockly_session';
const csrfName = 'stockly_csrf';

function cookieOptions(config) {
  return { secure: config.production, sameSite: config.sameSite, path: '/' };
}

function csrfValue(secret) {
  const nonce = crypto.randomBytes(32).toString('hex');
  const signature = crypto.createHmac('sha256', secret).update(nonce).digest('hex');
  return `${nonce}.${signature}`;
}

function validCsrf(value, secret) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}\.[0-9a-f]{64}$/.test(value)) return false;
  const [nonce, signature] = value.split('.');
  const expected = crypto.createHmac('sha256', secret).update(nonce).digest();
  return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), expected);
}

export function createApp(db, config) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.production ? 1 : false);
  app.use(helmet());
  app.use(cors({ origin: config.webOrigin, credentials: true }));
  app.use(express.json({ limit: '16kb' }));
  app.use(cookieParser());
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  app.get('/api/auth/csrf', (_req, res) => {
    const token = csrfValue(config.jwtSecret);
    res.cookie(csrfName, token, { ...cookieOptions(config), httpOnly: false });
    res.json({ csrfToken: token });
  });

  app.use('/api', (req, res, next) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
    if (req.get('origin') && req.get('origin') !== config.webOrigin) {
      return res.status(403).json({ error: 'Origin not allowed' });
    }
    const header = req.get('x-csrf-token');
    const cookie = req.cookies[csrfName];
    if (!header || header !== cookie || !validCsrf(header, config.jwtSecret)) {
      return res.status(403).json({ error: 'Invalid CSRF token' });
    }
    next();
  });

  const authenticate = async (req, res, next) => {
    try {
      const token = req.cookies[cookieName];
      if (!token) return res.status(401).json({ error: 'Authentication required' });
      const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'], issuer: 'stockly-api', audience: 'stockly-web' });
      if (typeof payload !== 'object' || typeof payload.sub !== 'string' || !Number.isInteger(payload.version)) {
        return res.status(401).json({ error: 'Invalid session' });
      }
      const user = await db.user.findUnique({ where: { id: payload.sub } });
      if (!user?.isActive || user.sessionVersion !== payload.version) {
        return res.status(401).json({ error: 'Invalid session' });
      }
      req.user = user;
      next();
    } catch (error) {
      if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
        return res.status(401).json({ error: 'Invalid session' });
      }
      next(error);
    }
  };

  const adminOnly = (req, res, next) => req.user.role === 'ADMIN'
    ? next() : res.status(403).json({ error: 'Admin access required' });

  const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false });
  app.post('/api/auth/login', loginLimiter, async (req, res, next) => {
    try {
      const input = credentials.parse(req.body);
      const user = await db.user.findUnique({ where: { email: input.email.trim().toLowerCase() } });
      const matches = await bcrypt.compare(input.password, user?.passwordHash ?? dummyHash);
      if (!user || !matches || !user.isActive) return res.status(401).json({ error: 'Invalid credentials' });
      const token = jwt.sign({ version: user.sessionVersion }, config.jwtSecret, {
        algorithm: 'HS256', subject: user.id, issuer: 'stockly-api', audience: 'stockly-web', expiresIn: '8h'
      });
      res.cookie(cookieName, token, { ...cookieOptions(config), httpOnly: true, maxAge: 8 * 60 * 60 * 1000 });
      res.json({ user: pickUser(user) });
    } catch (error) { next(error); }
  });

  app.get('/api/auth/me', authenticate, (req, res) => res.json({ user: pickUser(req.user) }));
  app.post('/api/auth/logout', authenticate, async (req, res, next) => {
    try {
      await db.user.update({ where: { id: req.user.id }, data: { sessionVersion: { increment: 1 } } });
      res.clearCookie(cookieName, { ...cookieOptions(config), httpOnly: true });
      res.clearCookie(csrfName, { ...cookieOptions(config), httpOnly: false });
      res.status(204).end();
    } catch (error) { next(error); }
  });

  app.get('/api/users', authenticate, adminOnly, async (_req, res, next) => {
    try {
      res.json({ users: await db.user.findMany({ select: safeUser, orderBy: { createdAt: 'desc' } }) });
    } catch (error) { next(error); }
  });
  app.post('/api/users', authenticate, adminOnly, async (req, res, next) => {
    try {
      const input = createUser.parse(req.body);
      const user = await db.user.create({ data: {
        name: input.name, email: input.email.toLowerCase(),
        passwordHash: await bcrypt.hash(input.password, 12), role: 'CASHIER'
      }, select: safeUser });
      res.status(201).json({ user });
    } catch (error) { next(error); }
  });
  app.patch('/api/users/:id', authenticate, adminOnly, async (req, res, next) => {
    try {
      const id = z.string().uuid().parse(req.params.id);
      const input = editUser.parse(req.body);
      const target = await db.user.findUnique({ where: { id } });
      if (!target) return res.status(404).json({ error: 'User not found' });
      if (target.role !== 'CASHIER') return res.status(403).json({ error: 'Only cashier accounts can be edited' });
      const data = { ...(input.name !== undefined && { name: input.name }),
        ...(input.isActive !== undefined && { isActive: input.isActive }),
        ...(input.password !== undefined && { passwordHash: await bcrypt.hash(input.password, 12) }) };
      if (input.isActive === false || input.password !== undefined) data.sessionVersion = { increment: 1 };
      const user = await db.user.update({ where: { id }, data, select: safeUser });
      res.json({ user });
    } catch (error) { next(error); }
  });

  app.use('/api', purchasingRouter(db, authenticate, adminOnly));
  app.use('/api/reports', reportsRouter(db, authenticate, adminOnly));
  app.use('/api/sales', salesRouter(db, authenticate));
  app.use('/api', catalogRouter(db, authenticate, adminOnly));

  app.use((req, res) => res.status(404).json({ error: 'Not found' }));
  app.use((error, _req, res, _next) => {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Invalid input', details: error.flatten() });
    if (error.status >= 400 && error.status < 500) return res.status(error.status).json({ error: error.message });
    if (error.code === 'P2002') {
      const field = Array.isArray(error.meta?.target) ? error.meta.target.join(', ') : 'Unique value';
      return res.status(409).json({ error: `${field} already exists` });
    }
    if (error.code === 'P2003') return res.status(400).json({ error: 'Referenced record not found' });
    if (error.code === 'P2025') return res.status(404).json({ error: 'Record not found' });
    if (error.code === 'P2034') return res.status(409).json({ error: 'Concurrent change; retry request' });
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  });
  return app;
}

function pickUser(user) {
  const { id, name, email, role, isActive, createdAt, updatedAt } = user;
  return { id, name, email, role, isActive, createdAt, updatedAt };
}
