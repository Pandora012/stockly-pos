import crypto from 'node:crypto';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { saleTotals } from '../../../shared/money.js';

dotenv.config({ path: new URL('../../../.env', import.meta.url) });

describe.skipIf(!process.env.DATABASE_URL)('held carts and checkout against PostgreSQL', () => {
  const db = new PrismaClient(); const suffix = crypto.randomUUID(); const agents = []; const users = []; const products = [];
  let category; let app;
  beforeAll(async () => {
    const password = 'held-test-password-long';
    for (const role of ['CASHIER', 'CASHIER', 'ADMIN']) {
      const user = await db.user.create({ data: { name: `Held ${role}`, email: `held-${users.length}-${suffix}@example.invalid`,
        passwordHash: await bcrypt.hash(password, 4), role } }); users.push(user);
    }
    category = await db.category.create({ data: { name: 'Held fixtures', slug: `held-${suffix}` } });
    for (const index of [0, 1, 2]) products.push(await db.product.create({ data: { name: `Held product ${index}`,
      sku: `HELD-${index}-${suffix}`, categoryId: category.id, stock: 6, purchasePrice: 1000, sellingPrice: 3000 + 1000 * index } }));
    app = createApp(db, { jwtSecret: crypto.randomBytes(48).toString('hex'), webOrigin: 'http://localhost:3000', sameSite: 'lax', production: false });
    for (const user of users) {
      const agent = request.agent(app); agents.push(agent);
      expect((await mutate(agent, 'post', '/api/auth/login', { email: user.email, password })).status).toBe(200);
    }
  });
  afterAll(async () => {
    await db.stockMovement.deleteMany({ where: { userId: { in: users.map((user) => user.id) } } });
    await db.payment.deleteMany({ where: { sale: { cashierId: { in: users.map((user) => user.id) } } } });
    await db.saleItem.deleteMany({ where: { sale: { cashierId: { in: users.map((user) => user.id) } } } });
    await db.sale.deleteMany({ where: { cashierId: { in: users.map((user) => user.id) } } });
    await db.heldCartItem.deleteMany({ where: { heldCart: { cashierId: { in: users.map((user) => user.id) } } } });
    await db.heldCart.deleteMany({ where: { cashierId: { in: users.map((user) => user.id) } } });
    await db.product.deleteMany({ where: { id: { in: products.map((product) => product.id) } } });
    if (category) await db.category.delete({ where: { id: category.id } });
    await db.user.deleteMany({ where: { id: { in: users.map((user) => user.id) } } }); await db.$disconnect();
  });
  async function mutate(agent, method, path, body = {}) {
    const token = (await agent.get('/api/auth/csrf')).body.csrfToken;
    return agent[method](path).set('x-csrf-token', token).send(body);
  }
  const draft = (items = [{ productId: products[0].id, quantity: 2 }]) => ({ label: `Titipan ${suffix}`, discount: 0, items });
  async function hold(items) { const result = await mutate(agents[0], 'post', '/api/held-carts', draft(items)); expect(result.status).toBe(201); return result.body.cart; }
  async function resume(id, token = crypto.randomUUID(), agent = agents[0]) {
    return mutate(agent, 'post', `/api/held-carts/${id}/resume`, { resumeToken: token });
  }
  function payment(cart, token, items = cart.items.map(({ productId, quantity }) => ({ productId, quantity })), cost = 3000) {
    const total = saleTotals(items.map(({ quantity }) => ({ quantity, unitPrice: cost })), 0, 0).total;
    return { idempotencyKey: crypto.randomUUID(), items, discount: 0, expectedTotal: total, amountReceived: total,
      heldCartId: cart.id, resumeToken: token, acceptedPrices: items.map((item) => ({ productId: item.productId, unitPrice: cost })) };
  }

  it('persists holds with snapshots without reserving stock or creating sales', async () => {
    const before = (await db.product.findUniqueOrThrow({ where: { id: products[0].id } })).stock;
    const cart = await hold();
    expect(cart.status).toBe('HELD'); expect(cart.items[0].unitPriceSnapshot).toBe(3000);
    expect((await agents[0].get(`/api/held-carts/${cart.id}`)).body.cart.items).toHaveLength(1);
    expect((await agents[0].get('/api/held-carts')).body.total).toBeGreaterThan(0);
    expect((await db.product.findUniqueOrThrow({ where: { id: products[0].id } })).stock).toBe(before);
    expect(await db.sale.count({ where: { heldCartId: cart.id } })).toBe(0);
    expect((await mutate(agents[0], 'post', '/api/held-carts', draft([{ productId: products[0].id, quantity: 0 }]))).status).toBe(400);
  });

  it('enforces ownership, admin read-only access, and status transitions', async () => {
    const cart = await hold();
    expect((await agents[1].get(`/api/held-carts/${cart.id}`)).status).toBe(404);
    expect((await agents[1].get('/api/held-carts')).body.items.some((item) => item.id === cart.id)).toBe(false);
    expect((await resume(cart.id, crypto.randomUUID(), agents[1])).status).toBe(404);
    expect((await mutate(agents[1], 'delete', `/api/held-carts/${cart.id}`)).status).toBe(404);
    expect((await agents[2].get(`/api/held-carts/${cart.id}`)).status).toBe(200);
    expect((await mutate(agents[2], 'delete', `/api/held-carts/${cart.id}`)).status).toBe(404);
    expect((await request(app).get('/api/held-carts')).status).toBe(401);
    expect((await mutate(agents[0], 'delete', `/api/held-carts/${cart.id}`)).body.cart.status).toBe('DISCARDED');
    expect((await resume(cart.id)).status).toBe(409);
    expect((await mutate(agents[0], 'delete', `/api/held-carts/${cart.id}`)).status).toBe(200);
  });

  it('returns current prices, inactive flags and insufficient stock for explicit review', async () => {
    const cart = await hold([{ productId: products[0].id, quantity: 4 }, { productId: products[1].id, quantity: 2 }, { productId: products[2].id, quantity: 1 }]);
    await db.product.update({ where: { id: products[0].id }, data: { sellingPrice: 3500 } });
    await db.product.update({ where: { id: products[1].id }, data: { stock: 1 } });
    await db.product.update({ where: { id: products[2].id }, data: { isActive: false } });
    const token = crypto.randomUUID(); const response = await resume(cart.id, token);
    expect(response.status).toBe(200); expect(response.body.cart.status).toBe('RESUMED');
    const byId = Object.fromEntries(response.body.review.map((item) => [item.productId, item]));
    expect(byId[products[0].id]).toMatchObject({ priceChanged: true, unitPriceSnapshot: 3000, product: { sellingPrice: 3500 } });
    expect(byId[products[1].id].insufficientStock).toBe(true);
    expect(byId[products[2].id].inactive).toBe(true);
    expect((await resume(cart.id, token)).status).toBe(200);
    expect((await resume(cart.id, crypto.randomUUID())).status).toBe(409);
    expect(await db.sale.count({ where: { heldCartId: cart.id } })).toBe(0);
    await db.product.update({ where: { id: products[0].id }, data: { sellingPrice: 3000 } });
    await db.product.update({ where: { id: products[1].id }, data: { stock: 6 } });
    await db.product.update({ where: { id: products[2].id }, data: { isActive: true } });
  });

  it('completes held cart and sale in one transaction with idempotent replay', async () => {
    const cart = await hold(); const token = crypto.randomUUID(); expect((await resume(cart.id, token)).status).toBe(200);
    const before = (await db.product.findUniqueOrThrow({ where: { id: products[0].id } })).stock;
    const body = payment(cart, token);
    const paid = await mutate(agents[0], 'post', '/api/sales', body);
    expect(paid.status).toBe(201); expect((await db.heldCart.findUniqueOrThrow({ where: { id: cart.id } })).status).toBe('COMPLETED');
    expect((await db.product.findUniqueOrThrow({ where: { id: products[0].id } })).stock).toBe(before - 2);
    expect((await mutate(agents[0], 'post', '/api/sales', body)).body.replayed).toBe(true);
    expect((await mutate(agents[0], 'delete', `/api/held-carts/${cart.id}`)).status).toBe(409);
    expect((await resume(cart.id)).status).toBe(409);
    expect(await db.sale.count({ where: { heldCartId: cart.id } })).toBe(1);
  });

  it('blocks other session tokens, extra items and concurrently duplicated checkout', async () => {
    const cart = await hold(); const token = crypto.randomUUID(); await resume(cart.id, token);
    const body = payment(cart, token);
    expect((await mutate(agents[0], 'post', '/api/sales', { ...body, resumeToken: crypto.randomUUID() })).status).toBe(409);
    expect((await mutate(agents[0], 'post', '/api/sales', { ...body, items: [{ productId: products[1].id, quantity: 1 }],
      acceptedPrices: [{ productId: products[1].id, unitPrice: 4000 }] })).status).toBe(409);
    expect((await mutate(agents[1], 'post', '/api/sales', body)).status).toBe(409);
    const secondSession = request.agent(app);
    expect((await mutate(secondSession, 'post', '/api/auth/login', { email: users[0].email, password: 'held-test-password-long' })).status).toBe(200);
    const before = (await db.product.findUniqueOrThrow({ where: { id: products[0].id } })).stock;
    const [a, b] = await Promise.all([mutate(agents[0], 'post', '/api/sales', body),
      mutate(secondSession, 'post', '/api/sales', { ...body, idempotencyKey: crypto.randomUUID() })]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect((await db.product.findUniqueOrThrow({ where: { id: products[0].id } })).stock).toBe(before - 2);
    expect(await db.sale.count({ where: { heldCartId: cart.id } })).toBe(1);
  });

  it('prevents stale or expired claims from checkout and permits a new claim after expiry', async () => {
    const cart = await hold(); const token = crypto.randomUUID(); await resume(cart.id, token);
    await db.heldCart.update({ where: { id: cart.id }, data: { resumeExpiresAt: new Date(Date.now() - 1000) } });
    expect((await mutate(agents[0], 'post', '/api/sales', payment(cart, token))).status).toBe(409);
    const newToken = crypto.randomUUID(); expect((await resume(cart.id, newToken)).status).toBe(200);
    expect((await mutate(agents[0], 'post', '/api/sales', payment(cart, token))).status).toBe(409);
    expect((await db.heldCart.findUniqueOrThrow({ where: { id: cart.id } })).status).toBe('RESUMED');
  });

  it('requires reviewed item prices even when offsetting changes leave the total unchanged', async () => {
    const cart = await hold([{ productId: products[0].id, quantity: 1 }, { productId: products[1].id, quantity: 1 }]);
    const token = crypto.randomUUID(); await resume(cart.id, token);
    const body = { idempotencyKey: crypto.randomUUID(), heldCartId: cart.id, resumeToken: token,
      items: [{ productId: products[0].id, quantity: 1 }, { productId: products[1].id, quantity: 1 }],
      acceptedPrices: [{ productId: products[0].id, unitPrice: 3000 }, { productId: products[1].id, unitPrice: 4000 }],
      discount: 0, expectedTotal: 7000, amountReceived: 7000 };
    await db.product.update({ where: { id: products[0].id }, data: { sellingPrice: 3500 } });
    await db.product.update({ where: { id: products[1].id }, data: { sellingPrice: 3500 } });
    try {
      expect((await mutate(agents[0], 'post', '/api/sales', body)).status).toBe(409);
      expect((await db.heldCart.findUniqueOrThrow({ where: { id: cart.id } })).status).toBe('RESUMED');
      expect(await db.sale.count({ where: { heldCartId: cart.id } })).toBe(0);
    } finally {
      await db.product.update({ where: { id: products[0].id }, data: { sellingPrice: 3000 } });
      await db.product.update({ where: { id: products[1].id }, data: { sellingPrice: 4000 } });
    }
  });

  it('grants a held cart to only one concurrent resume session', async () => {
    const cart = await hold();
    const secondSession = request.agent(app);
    expect((await mutate(secondSession, 'post', '/api/auth/login', { email: users[0].email, password: 'held-test-password-long' })).status).toBe(200);
    const firstToken = crypto.randomUUID(); const secondToken = crypto.randomUUID();
    const results = await Promise.all([resume(cart.id, firstToken), resume(cart.id, secondToken, secondSession)]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    const winner = results.find((result) => result.status === 200).body.resumeToken;
    const saved = await db.heldCart.findUniqueOrThrow({ where: { id: cart.id } });
    expect(saved.resumeToken).toBe(winner); expect(saved.status).toBe('RESUMED');
    expect((await resume(cart.id, winner)).status).toBe(200);
  });
});
