import crypto from 'node:crypto';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { expect, it } from 'vitest';
import { createApp } from '../src/app.js';

dotenv.config({ path: new URL('../../../.env', import.meta.url) });

const integration = process.env.DATABASE_URL ? it : it.skip;

integration('authentication and authorization against PostgreSQL', async () => {
  const db = new PrismaClient();
  const ids = [];
  const suffix = crypto.randomUUID();
  const password = `test-password-${suffix}`;
  const email = (role) => `phase1-${role.toLowerCase()}-${suffix}@example.invalid`;

  try {
    await db.$connect();
    for (const [role, isActive] of [['ADMIN', true], ['CASHIER', true], ['CASHIER', false]]) {
      const user = await db.user.create({ data: {
        name: `Test ${role}`, email: email(`${role}-${isActive}`),
        passwordHash: await bcrypt.hash(password, 10), role, isActive
      } });
      ids.push(user.id);
    }

    const jwtSecret = crypto.randomBytes(48).toString('hex');
    const app = createApp(db, {
      jwtSecret,
      webOrigin: 'http://localhost:3000', sameSite: 'lax', production: false
    });
    const admin = request.agent(app);
    const cashier = request.agent(app);
    const csrf = async (agent) => (await agent.get('/api/auth/csrf')).body.csrfToken;
    const login = async (agent, address, secret) => {
      const token = await csrf(agent);
      return agent.post('/api/auth/login').set('x-csrf-token', token).send({ email: address, password: secret });
    };

    expect((await request(app).get('/api/auth/me')).status).toBe(401);
    expect((await request(app).get('/api/users')).status).toBe(401);
    expect((await login(admin, email('ADMIN-true'), 'incorrect')).status).toBe(401);
    expect((await login(admin, email('CASHIER-false'), password)).status).toBe(401);

    const signedIn = await login(admin, email('ADMIN-true'), password);
    expect(signedIn.status).toBe(200);
    const sessionHeader = signedIn.headers['set-cookie'].find((value) => value.startsWith('stockly_session='));
    expect(sessionHeader).toMatch(/HttpOnly/i);
    expect(sessionHeader).toMatch(/SameSite=Lax/i);
    expect(sessionHeader).toMatch(/Max-Age=28800/i);
    const csrfHeader = (await admin.get('/api/auth/csrf')).headers['set-cookie'][0];
    expect(csrfHeader).not.toMatch(/HttpOnly/i);
    expect(csrfHeader).toMatch(/SameSite=Lax/i);
    const expired = jwt.sign({ version: 0 }, jwtSecret, { algorithm: 'HS256', subject: ids[0],
      issuer: 'stockly-api', audience: 'stockly-web', expiresIn: -1 });
    expect((await request(app).get('/api/auth/me').set('Cookie', `stockly_session=${expired}`)).status).toBe(401);
    expect((await admin.get('/api/users').set('Origin', 'https://untrusted.example')).headers['access-control-allow-origin']).not.toBe('https://untrusted.example');
    expect(signedIn.body.user).not.toHaveProperty('passwordHash');
    expect((await admin.get('/api/auth/me')).body.user.role).toBe('ADMIN');
    expect((await admin.get('/api/users')).status).toBe(200);

    expect((await login(cashier, email('CASHIER-true'), password)).status).toBe(200);
    expect((await cashier.get('/api/users')).status).toBe(403);
    const protectedMutations = [
      ['post', '/api/users'], ['patch', `/api/users/${ids[1]}`],
      ['post', '/api/categories'], ['patch', `/api/categories/${crypto.randomUUID()}`],
      ['post', '/api/products'], ['patch', `/api/products/${crypto.randomUUID()}`],
      ['post', '/api/inventory/adjustments'],
      ['post', '/api/suppliers'], ['patch', `/api/suppliers/${crypto.randomUUID()}`],
      ['post', '/api/purchases'], ['patch', `/api/purchases/${crypto.randomUUID()}`],
      ['post', `/api/purchases/${crypto.randomUUID()}/order`], ['post', `/api/purchases/${crypto.randomUUID()}/receive`]
    ];
    for (const [method, path] of protectedMutations) {
      const cashierCsrf = await csrf(cashier);
      expect((await cashier[method](path).set('x-csrf-token', cashierCsrf).send({})).status).toBe(403);
      const guest = request.agent(app);
      const guestCsrf = await csrf(guest);
      expect((await guest[method](path).set('x-csrf-token', guestCsrf).send({})).status).toBe(401);
    }
    expect((await admin.post('/api/categories').send({ name: 'Blocked' })).status).toBe(403);
    const freshAdminCsrf = await csrf(admin);
    expect((await admin.post('/api/categories').set('x-csrf-token', freshAdminCsrf)
      .set('Origin', 'https://untrusted.example').send({ name: 'Blocked' })).status).toBe(403);
    const cashierToken = await csrf(cashier);
    expect((await cashier.post('/api/users').set('x-csrf-token', cashierToken)
      .send({ name: 'Denied', email: email('denied'), password })).status).toBe(403);

    const adminToken = await csrf(admin);
    const created = await admin.post('/api/users').set('x-csrf-token', adminToken)
      .send({ name: 'Created by admin', email: email('created'), password });
    expect(created.status).toBe(201);
    expect(created.body.user.role).toBe('CASHIER');
    expect(created.body.user).not.toHaveProperty('passwordHash');
    ids.push(created.body.user.id);

    const stored = await db.user.findUnique({ where: { id: created.body.user.id } });
    expect(await bcrypt.compare(password, stored.passwordHash)).toBe(true);

    const oldCookie = signedIn.headers['set-cookie'].find((value) => value.startsWith('stockly_session=')).split(';')[0];
    const logoutToken = await csrf(admin);
    expect((await admin.post('/api/auth/logout').set('x-csrf-token', logoutToken)).status).toBe(204);
    expect((await admin.get('/api/auth/me')).status).toBe(401);
    expect((await request(app).get('/api/auth/me').set('Cookie', oldCookie)).status).toBe(401);
    await db.user.update({ where: { id: ids[1] }, data: { isActive: false } });
    expect((await cashier.get('/api/auth/me')).status).toBe(401);
  } finally {
    if (ids.length) await db.user.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
  }
}, 30_000);
