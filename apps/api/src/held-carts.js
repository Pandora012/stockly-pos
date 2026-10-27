import { Router } from 'express';
import { z } from 'zod';
import { HttpError } from './catalog.js';
import { MAX_MONEY, saleTotals } from '../../../shared/money.js';

const uuid = z.string().uuid();
const holdInput = z.object({ label: z.string().trim().min(1).max(120), discount: z.number().int().min(0).max(MAX_MONEY).default(0),
  items: z.array(z.object({ productId: uuid, quantity: z.number().int().min(1).max(10000) }).strict()).min(1).max(100)
}).strict().refine((value) => new Set(value.items.map((item) => item.productId)).size === value.items.length);
const resumeInput = z.object({ resumeToken: uuid }).strict();
const listQuery = z.object({ mine: z.enum(['true']).optional(), status: z.enum(['HELD', 'RESUMED', 'COMPLETED', 'DISCARDED']).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20) }).strict();
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);
const detailInclude = { cashier: { select: { id: true, name: true } },
  items: { select: { id: true, productId: true, quantity: true, unitPriceSnapshot: true, createdAt: true,
    product: { select: { id: true, name: true, sku: true, sellingPrice: true, stock: true, isActive: true,
      category: { select: { isActive: true } } } } } } };
const visible = ({ resumeToken: _token, ...cart }) => cart;

async function owned(tx, id, user, allowAdminRead = false) {
  const cart = await tx.heldCart.findUnique({ where: { id }, include: detailInclude });
  if (!cart || (cart.cashierId !== user.id && !(allowAdminRead && user.role === 'ADMIN'))) {
    throw new HttpError(404, 'Keranjang tidak ditemukan atau tidak dapat diakses.');
  }
  return cart;
}

async function serializable(db, work) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try { return await db.$transaction(work, { isolationLevel: 'Serializable', timeout: 15000 }); }
    catch (error) {
      if (error.code !== 'P2034') throw error;
      if (attempt === 3) throw new HttpError(409, 'Keranjang sedang berubah. Muat ulang dan coba lagi.');
    }
  }
}

export function heldCartsRouter(db, authenticate) {
  const router = Router(); router.use(authenticate);
  router.post('/', asyncRoute(async (req, res) => {
    const parsed = holdInput.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, 'Isi label dan 1–100 produk unik dengan jumlah bulat positif.');
    const input = parsed.data;
    const cart = await serializable(db, async (tx) => {
      const products = await tx.product.findMany({ where: { id: { in: input.items.map((item) => item.productId) },
        isActive: true, category: { isActive: true } } });
      if (products.length !== input.items.length) throw new HttpError(409, 'Produk tidak aktif atau tidak ditemukan. Perbarui keranjang.');
      const items = input.items.map((item) => {
        const product = products.find((entry) => entry.id === item.productId);
        if (item.quantity > product.stock) throw new HttpError(409, `Stok ${product.name} tidak cukup untuk ditahan.`);
        return { ...item, unitPriceSnapshot: product.sellingPrice };
      });
      try { saleTotals(items.map((item) => ({ unitPrice: item.unitPriceSnapshot, quantity: item.quantity })), input.discount, 0); }
      catch (error) { throw new HttpError(400, error.message); }
      return tx.heldCart.create({ data: { cashierId: req.user.id, label: input.label, discount: input.discount,
        items: { create: items } }, include: detailInclude });
    });
    res.status(201).json({ cart: visible(cart) });
  }));
  router.get('/', asyncRoute(async (req, res) => {
    const query = listQuery.parse(req.query);
    const where = { ...(req.user.role !== 'ADMIN' || query.mine ? { cashierId: req.user.id } : {}),
      status: query.status ?? { in: ['HELD', 'RESUMED'] } };
    const [items, total] = await Promise.all([db.heldCart.findMany({ where,
      select: { id: true, label: true, cashierId: true, cashier: { select: { name: true } }, status: true,
        createdAt: true, updatedAt: true, _count: { select: { items: true } } },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
    db.heldCart.count({ where })]);
    res.json({ items, total, page: query.page, pageSize: query.pageSize, pages: Math.ceil(total / query.pageSize) });
  }));
  router.get('/:id', asyncRoute(async (req, res) => {
    res.json({ cart: visible(await owned(db, uuid.parse(req.params.id), req.user, true)) });
  }));
  router.post('/:id/resume', asyncRoute(async (req, res) => {
    const id = uuid.parse(req.params.id);
    const { resumeToken } = resumeInput.parse(req.body);
    const cart = await serializable(db, async (tx) => {
      const existing = await owned(tx, id, req.user);
      const now = new Date();
      if (existing.status !== 'HELD' && !(existing.status === 'RESUMED' &&
          (existing.resumeToken === resumeToken || existing.resumeExpiresAt <= now))) {
        throw new HttpError(409, 'Keranjang sedang dibuka di sesi lain atau sudah selesai.');
      }
      const claimed = await tx.heldCart.updateMany({ where: { id, cashierId: req.user.id, OR: [
        { status: 'HELD' }, { status: 'RESUMED', resumeToken }, { status: 'RESUMED', resumeExpiresAt: { lte: now } }
      ] }, data: { status: 'RESUMED', resumeToken, resumeExpiresAt: new Date(now.getTime() + 30 * 60_000) } });
      if (claimed.count !== 1) throw new HttpError(409, 'Keranjang sedang dibuka di sesi lain.');
      return owned(tx, id, req.user);
    });
    const review = cart.items.map((item) => ({ ...item,
      inactive: !item.product.isActive || !item.product.category.isActive,
      insufficientStock: item.product.stock < item.quantity,
      priceChanged: item.product.sellingPrice !== item.unitPriceSnapshot }));
    res.json({ cart: visible(cart), review, resumeToken, expiresAt: cart.resumeExpiresAt });
  }));
  router.delete('/:id', asyncRoute(async (req, res) => {
    const id = uuid.parse(req.params.id);
    const cart = await serializable(db, async (tx) => {
      const existing = await owned(tx, id, req.user);
      if (existing.status === 'COMPLETED') throw new HttpError(409, 'Keranjang sudah dibayar dan tidak dapat dibuang.');
      if (existing.status === 'DISCARDED') return existing;
      const changed = await tx.heldCart.updateMany({ where: { id, cashierId: req.user.id, status: { in: ['HELD', 'RESUMED'] } },
        data: { status: 'DISCARDED', resumeToken: null, resumeExpiresAt: null } });
      if (changed.count !== 1) throw new HttpError(409, 'Status keranjang berubah. Muat ulang.');
      return owned(tx, id, req.user);
    });
    res.json({ cart: visible(cart) });
  }));
  return router;
}
