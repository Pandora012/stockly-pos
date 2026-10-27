import { describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';

const secret = 'a-development-test-secret-at-least-32-characters';
const adminId = '7fb86ee3-4cec-4f38-a88b-e5ccc9679dcb';
const cashierId = '69b4e79b-4685-4245-a3c7-bf5e322fd779';

function fixture(config = {}) {
  const users = [
    { id: adminId, name: 'Admin', email: 'admin@local.test', passwordHash: bcrypt.hashSync('correct-password', 4), role: 'ADMIN', isActive: true, sessionVersion: 0 },
    { id: cashierId, name: 'Cashier', email: 'cashier@local.test', passwordHash: bcrypt.hashSync('correct-password', 4), role: 'CASHIER', isActive: true, sessionVersion: 0 }
  ];
  const db = { user: {
    findUnique: async ({ where }) => users.find((user) => Object.entries(where).every(([key, value]) => user[key] === value)) ?? null,
    findMany: async () => users.map(({ passwordHash, sessionVersion, ...safe }) => safe),
    create: async ({ data }) => {
      const user = { ...data, id: crypto.randomUUID(), isActive: true, sessionVersion: 0 };
      users.push(user);
      const { passwordHash, sessionVersion, ...safe } = user;
      return safe;
    },
    update: async ({ where, data }) => {
      const user = users.find((item) => item.id === where.id);
      for (const [key, value] of Object.entries(data)) user[key] = typeof value === 'object' && value.increment ? user[key] + value.increment : value;
      const { passwordHash, sessionVersion, ...safe } = user;
      return safe;
    }
  } };
  const app = createApp(db, { jwtSecret: secret, webOrigin: 'http://localhost:3000', production: false, sameSite: 'lax', ...config });
  const agent = request.agent(app);
  async function csrf() { return (await agent.get('/api/auth/csrf')).body.csrfToken; }
  async function login(email = 'admin@local.test', password = 'correct-password') {
    const token = await csrf();
    return agent.post('/api/auth/login').set('x-csrf-token', token).send({ email, password });
  }
  return { users, app, agent, csrf, login };
}

describe('authentication and user authorization', () => {
  it('logs in and returns only safe user data', async () => {
    const { agent, login } = fixture();
    const response = await login();
    expect(response.status).toBe(200);
    expect(response.body.user).not.toHaveProperty('passwordHash');
    expect(response.headers['set-cookie'].some((cookie) => cookie.includes('HttpOnly'))).toBe(true);
    expect((await agent.get('/api/auth/me')).body.user.role).toBe('ADMIN');
  });

  it('marks production session and CSRF cookies Secure with configured SameSite', async () => {
    const { app } = fixture({ production: true, sameSite: 'none', webOrigin: 'https://store.example' });
    const csrfResponse = await request(app).get('/api/auth/csrf');
    const csrfCookie = csrfResponse.headers['set-cookie'][0];
    expect(csrfCookie).toMatch(/Secure/i);
    expect(csrfCookie).toMatch(/SameSite=None/i);
    expect(csrfCookie).not.toMatch(/HttpOnly/i);
    const signedIn = await request(app).post('/api/auth/login').set('Cookie', csrfCookie.split(';')[0])
      .set('x-csrf-token', csrfResponse.body.csrfToken).send({ email: 'admin@local.test', password: 'correct-password' });
    expect(signedIn.status).toBe(200);
    const sessionCookie = signedIn.headers['set-cookie'].find((cookie) => cookie.startsWith('stockly_session='));
    expect(sessionCookie).toMatch(/Secure/i);
    expect(sessionCookie).toMatch(/HttpOnly/i);
    expect(sessionCookie).toMatch(/SameSite=None/i);
  });

  it('rejects invalid credentials and disabled users', async () => {
    const { users, login } = fixture();
    expect((await login('admin@local.test', 'wrong-password')).status).toBe(401);
    users[0].isActive = false;
    expect((await login()).status).toBe(401);
  });

  it('does not spend the failed-login allowance on successful sign-ins', async () => {
    const { login } = fixture();
    for (let index = 0; index < 11; index += 1) expect((await login()).status).toBe(200);
    for (let index = 0; index < 10; index += 1) expect((await login('admin@local.test', 'wrong-password')).status).toBe(401);
    expect((await login('admin@local.test', 'wrong-password')).status).toBe(429);
  });

  it('rejects unauthenticated requests and mutations without CSRF', async () => {
    const { app, agent } = fixture();
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
    expect((await request(app).get('/api/users')).status).toBe(401);
    expect((await agent.post('/api/auth/login').send({ email: 'admin@local.test', password: 'correct-password' })).status).toBe(403);
  });

  it('rejects cross-origin mutations even with a valid CSRF token', async () => {
    const { agent, csrf } = fixture();
    const token = await csrf();
    const response = await agent.post('/api/auth/login').set('origin', 'https://evil.example').set('x-csrf-token', token)
      .send({ email: 'admin@local.test', password: 'correct-password' });
    expect(response.status).toBe(403);
  });

  it('prevents cashier user management', async () => {
    const { agent, login, csrf } = fixture();
    expect((await login('cashier@local.test')).status).toBe(200);
    expect((await agent.get('/api/users')).status).toBe(403);
    const token = await csrf();
    expect((await agent.post('/api/users').set('x-csrf-token', token).send({ name: 'X' })).status).toBe(403);
  });

  it('creates cashiers without leaking hashes and can deactivate them', async () => {
    const { agent, login, csrf } = fixture();
    await login();
    const token = await csrf();
    const created = await agent.post('/api/users').set('x-csrf-token', token).send({ name: 'New', email: 'new@local.test', password: 'twelve-character-password' });
    expect(created.status).toBe(201);
    expect(created.body.user.role).toBe('CASHIER');
    expect(created.body.user).not.toHaveProperty('passwordHash');
    const nextToken = await csrf();
    const edited = await agent.patch(`/api/users/${created.body.user.id}`).set('x-csrf-token', nextToken).send({ isActive: false });
    expect(edited.body.user.isActive).toBe(false);
  });

  it('logs out and revokes an already-issued JWT', async () => {
    const { app, agent, login, csrf } = fixture();
    const loginResponse = await login();
    const cookie = loginResponse.headers['set-cookie'].find((value) => value.startsWith('stockly_session=' )).split(';')[0];
    const token = await csrf();
    expect((await agent.post('/api/auth/logout').set('x-csrf-token', token)).status).toBe(204);
    expect((await agent.get('/api/auth/me')).status).toBe(401);
    expect((await request(app).get('/api/auth/me').set('Cookie', cookie)).status).toBe(401);
  });

  it('rejects JWT with wrong audience and inactive sessions', async () => {
    const { app, users } = fixture();
    const token = jwt.sign({ version: 0 }, secret, { subject: adminId, issuer: 'stockly-api', audience: 'other', expiresIn: '1h' });
    expect((await request(app).get('/api/auth/me').set('Cookie', `stockly_session=${token}`)).status).toBe(401);
    users[0].isActive = false;
    const valid = jwt.sign({ version: 0 }, secret, { subject: adminId, issuer: 'stockly-api', audience: 'stockly-web', expiresIn: '1h' });
    expect((await request(app).get('/api/auth/me').set('Cookie', `stockly_session=${valid}`)).status).toBe(401);
  });
});
