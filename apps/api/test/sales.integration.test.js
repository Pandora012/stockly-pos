import crypto from 'node:crypto';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { checkout } from '../src/sales.js';
import { saleTotals } from '../../../shared/money.js';

dotenv.config({ path: new URL('../../../.env', import.meta.url) });

describe.skipIf(!process.env.DATABASE_URL)('cash sales with PostgreSQL', () => {
  const db = new PrismaClient();
  const suffix = crypto.randomUUID();
  const users = [];
  const productIds = [];
  let category;
  let app;
  let cookies;
  let taxRate;
  let agent;
  beforeAll(async () => {
    for (const role of ['ADMIN', 'CASHIER', 'CASHIER']) {
      users.push(await db.user.create({ data: { name: `Sales test ${role}`,
        email: `${users.length}-${suffix}@example.invalid`, passwordHash: await bcrypt.hash('test-password-46', 4), role } }));
    }
    category = await db.category.create({ data: { name: 'Sales test', slug: `sales-${suffix}` } });
    taxRate = (await db.storeSetting.findUniqueOrThrow({ where: { id: 1 } })).defaultTaxRate;
    app = createApp(db, { jwtSecret: crypto.randomBytes(48).toString('hex'), webOrigin: 'http://localhost:3000', sameSite: 'lax', production: false });
    agent = request.agent(app);
    const csrf = (await agent.get('/api/auth/csrf')).body.csrfToken;
    const login = await agent.post('/api/auth/login').set('x-csrf-token', csrf).send({ email: users[1].email, password: 'test-password-46' });
    const csrfResponse = await agent.get('/api/auth/csrf');
    cookies = { csrf: csrfResponse.body.csrfToken, value: [login.headers['set-cookie'][0].split(';')[0], csrfResponse.headers['set-cookie'][0].split(';')[0]].join('; ') };
  });
  afterAll(async () => {
    const where = { cashierId: { in: users.map((user) => user.id) } };
    await db.stockMovement.deleteMany({ where: { userId: { in: users.map((user) => user.id) } } });
    await db.payment.deleteMany({ where: { sale: where } });
    await db.saleItem.deleteMany({ where: { sale: where } });
    await db.sale.deleteMany({ where });
    await db.product.deleteMany({ where: { id: { in: productIds } } });
    if (category) await db.category.delete({ where: { id: category.id } });
    await db.user.deleteMany({ where: { id: { in: users.map((user) => user.id) } } });
    await db.$disconnect();
  });
  async function product(stock = 10, price = 3500) {
    const row = await db.product.create({ data: { categoryId: category.id, name: 'Sales fixture', sku: `SALE-${crypto.randomUUID()}`,
      purchasePrice: 1700, sellingPrice: price, stock } });
    productIds.push(row.id); return row;
  }
  function input(products, overrides = {}) {
    const items = products.map((p) => ({ productId: p.id, quantity: p.quantity ?? 1 }));
    const totals = saleTotals(products.map((p) => ({ unitPrice: p.sellingPrice, quantity: p.quantity ?? 1 })), overrides.discount ?? 0, taxRate);
    return { idempotencyKey: crypto.randomUUID(), items, discount: 0, expectedTotal: totals.total, amountReceived: totals.total + 10000, ...overrides };
  }
  const submit = (body) => request(app).post('/api/sales').set('Cookie', cookies.value).set('x-csrf-token', cookies.csrf).send(body);

  it('checks out multiple products, records movements, and returns receipt snapshots', async () => {
    const p = await product(); const other = await product(5, 5000);
    const body = input([{ ...p, quantity: 2 }, other], { discount: 1000 });
    const response = await submit(body);
    expect(response.status).toBe(201);
    const sale = response.body.sale;
    expect(sale.subtotal).toBe(12000); expect(sale.discount).toBe(1000);
    expect(sale.total).toBe(body.expectedTotal); expect(sale.items).toHaveLength(2);
    expect(sale.items[0]).not.toHaveProperty('unitCostSnapshot');
    expect(sale.payment.changeAmount).toBe(10000);
    const stored = await db.saleItem.findFirst({ where: { saleId: sale.id, productId: p.id } });
    expect(stored.unitCostSnapshot).toBe(1700);
    const movements = await db.stockMovement.findMany({ where: { referenceId: sale.id } });
    expect(movements).toHaveLength(2);
    expect(movements.find((row) => row.productId === p.id)).toMatchObject({ type: 'SALE', quantityChange: -2, stockBefore: 10, stockAfter: 8 });
    await db.product.update({ where: { id: p.id }, data: { name: 'Changed', sellingPrice: 9999 } });
    const receipt = await agent.get(`/api/sales/${sale.id}/receipt`);
    expect(receipt.status).toBe(200);
    expect(receipt.body.sale.total).toBe(sale.total);
    expect(receipt.body.sale.items.find((item) => item.productId === p.id)).toMatchObject({ unitPrice: 3500, productNameSnapshot: 'Sales fixture' });
    expect(receipt.body.sale.storeSnapshot.currency).toBe('IDR');
  });

  it('rejects insufficient stock and cash, tampered prices, and invalid quantities', async () => {
    const p = await product(1);
    expect((await submit(input([{ ...p, quantity: 2 }]))).status).toBe(409);
    expect((await submit(input([p], { amountReceived: 0 }))).status).toBe(400);
    const tampered = input([p]); tampered.items[0].unitPrice = 1;
    expect((await submit(tampered)).status).toBe(400);
    expect((await submit(input([p], { expectedTotal: 1 }))).status).toBe(409);
    for (const quantity of [-1, 0, 1.5, '1']) {
      const body = input([p]); body.items[0].quantity = quantity;
      expect((await submit(body)).status).toBe(400);
    }
    const repeated = input([p]); repeated.items.push(repeated.items[0]);
    expect((await submit(repeated)).status).toBe(400);
    expect((await db.product.findUnique({ where: { id: p.id } })).stock).toBe(1);
  });

  it('rolls back sale, payment and stock if a ledger write fails after stock update', async () => {
    const p = await product(); const body = input([p]);
    const failingDb = { $transaction: (callback, options) => db.$transaction((tx) => callback(new Proxy(tx, {
      get(target, key) { return key === 'stockMovement' ? { create: () => { throw new Error('Injected ledger failure'); } } : target[key]; }
    })), options) };
    await expect(checkout(failingDb, users[1], body)).rejects.toThrow('Injected ledger failure');
    expect(await db.sale.count({ where: { idempotencyKey: body.idempotencyKey } })).toBe(0);
    expect((await db.product.findUnique({ where: { id: p.id } })).stock).toBe(10);
    expect(await db.saleItem.count({ where: { productId: p.id } })).toBe(0);
    expect(await db.stockMovement.count({ where: { productId: p.id } })).toBe(0);
  });

  it('allows only one concurrent checkout of the last unit', async () => {
    const p = await product(1); const results = await Promise.all([submit(input([p])), submit(input([p]))]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect((await db.product.findUnique({ where: { id: p.id } })).stock).toBe(0);
    expect(await db.saleItem.count({ where: { productId: p.id } })).toBe(1);
    expect(await db.stockMovement.count({ where: { productId: p.id } })).toBe(1);
  });

  it('replays identical sequential and concurrent requests without a second sale', async () => {
    const p = await product(); const body = input([p]);
    const results = await Promise.all([submit(body), submit(body)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(results[0].body.sale.id).toBe(results[1].body.sale.id);
    const replay = await submit(body); expect(replay.status).toBe(200); expect(replay.body.replayed).toBe(true);
    expect((await submit({ ...body, amountReceived: body.amountReceived + 1 })).status).toBe(409);
    expect((await db.product.findUnique({ where: { id: p.id } })).stock).toBe(9);
    expect(await db.sale.count({ where: { idempotencyKey: body.idempotencyKey } })).toBe(1);
  });

  it('limits cashiers to own history and receipts; admin can read all', async () => {
    const p = await product(); const body = input([p]); const response = await submit(body); const sale = response.body.sale;
    for (const [user, allowed] of [[users[0], true], [users[2], false]]) {
      const client = request.agent(app); const token = (await client.get('/api/auth/csrf')).body.csrfToken;
      await client.post('/api/auth/login').set('x-csrf-token', token).send({ email: user.email, password: 'test-password-46' });
      expect((await client.get(`/api/sales/${sale.id}`)).status).toBe(allowed ? 200 : 404);
      expect((await client.get(`/api/sales/${sale.id}/receipt`)).status).toBe(allowed ? 200 : 404);
      expect((await client.get('/api/sales').query({ q: sale.invoiceNumber })).body.total).toBe(allowed ? 1 : 0);
      const replayToken = (await client.get('/api/auth/csrf')).body.csrfToken;
      expect((await client.post('/api/sales').set('x-csrf-token', replayToken).send(body)).status).toBe(409);
    }
    expect((await request(app).get('/api/sales')).status).toBe(401);
  });
});
