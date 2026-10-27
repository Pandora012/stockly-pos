import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { HttpError } from './catalog.js';
import { MAX_MONEY, saleTotals } from '../../../shared/money.js';

const checkoutInput = z.object({
  idempotencyKey: z.string().uuid(),
  items: z.array(z.object({ productId: z.string().uuid(), quantity: z.number().int().min(1).max(10000) }).strict()).min(1).max(100),
  discount: z.number().int().min(0).max(MAX_MONEY).default(0),
  amountReceived: z.number().int().min(0).max(MAX_MONEY),
  expectedTotal: z.number().int().min(0).max(MAX_MONEY),
  heldCartId: z.string().uuid().optional(), resumeToken: z.string().uuid().optional(),
  acceptedPrices: z.array(z.object({ productId: z.string().uuid(), unitPrice: z.number().int().min(1).max(MAX_MONEY) }).strict()).min(1).max(100).optional()
}).strict().refine((value) => !!value.heldCartId === !!value.resumeToken,
  { message: 'Identitas keranjang ditahan tidak lengkap.' }).refine((value) => !!value.heldCartId === !!value.acceptedPrices,
  { message: 'Harga yang ditinjau wajib disertakan untuk keranjang ditahan.' }).refine((value) => new Set(value.items.map((item) => item.productId)).size === value.items.length,
  { message: 'Produk tidak boleh berulang; gabungkan jumlahnya.' });
const historyQuery = z.object({
  q: z.string().trim().max(64).optional(), from: z.string().date().optional(), to: z.string().date().optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20)
}).strict().refine((value) => !value.from || !value.to || value.from <= value.to);
const saleSelect = {
  id: true, invoiceNumber: true, cashierId: true, cashierNameSnapshot: true, subtotal: true,
  discount: true, tax: true, taxRate: true, total: true, status: true, createdAt: true, storeSnapshot: true,
  items: { select: { id: true, productId: true, productNameSnapshot: true, skuSnapshot: true, quantity: true, unitPrice: true, lineTotal: true }, orderBy: { skuSnapshot: 'asc' } },
  payment: { select: { method: true, amountReceived: true, changeAmount: true } }
};
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);

function checkReplay(existing, cashierId, hash) {
  if (existing.cashierId !== cashierId || existing.requestHash !== hash) {
    throw new HttpError(409, 'Kunci pembayaran sudah digunakan untuk permintaan lain. Periksa riwayat transaksi.');
  }
}

export async function checkout(db, cashier, rawInput) {
  const parsed = checkoutInput.safeParse(rawInput);
  if (!parsed.success) throw new HttpError(400, 'Periksa barang, jumlah bulat positif, diskon dan uang tunai. Kirim hanya ID produk dan jumlahnya.');
  const input = parsed.data;
  input.items.sort((a, b) => a.productId.localeCompare(b.productId));
  input.acceptedPrices?.sort((a, b) => a.productId.localeCompare(b.productId));
  if (input.acceptedPrices && (input.acceptedPrices.length !== input.items.length ||
      input.acceptedPrices.some((item, index) => item.productId !== input.items[index].productId))) {
    throw new HttpError(400, 'Harga yang ditinjau harus sesuai dengan semua item keranjang.');
  }
  const { idempotencyKey, ...payload } = input;
  const hash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await db.$transaction(async (tx) => {
        const existing = await tx.sale.findUnique({ where: { idempotencyKey } });
        if (existing) {
          checkReplay(existing, cashier.id, hash);
          return { sale: await tx.sale.findUnique({ where: { id: existing.id }, select: saleSelect }), replayed: true };
        }
        if (input.heldCartId) {
          const held = await tx.heldCart.findUnique({ where: { id: input.heldCartId }, include: { items: true } });
          if (!held || held.cashierId !== cashier.id || held.status !== 'RESUMED' ||
              held.resumeToken !== input.resumeToken || held.resumeExpiresAt <= new Date()) {
            throw new HttpError(409, 'Sesi keranjang ditahan sudah berakhir atau digunakan. Periksa daftar keranjang.');
          }
          if (input.items.some((item) => !held.items.some((saved) => saved.productId === item.productId && item.quantity <= saved.quantity))) {
            throw new HttpError(409, 'Barang atau jumlah tidak sesuai keranjang ditahan. Periksa ulang.');
          }
        }
        const store = await tx.storeSetting.findUnique({ where: { id: 1 } });
        if (!store) throw new HttpError(409, 'Pengaturan toko belum tersedia. Hubungi admin.');
        const products = await tx.product.findMany({ where: { id: { in: input.items.map((item) => item.productId) },
          isActive: true, category: { isActive: true } }, include: { category: { select: { name: true } } } });
        const rows = input.items.map((item) => {
          const product = products.find((entry) => entry.id === item.productId);
          if (!product) throw new HttpError(409, 'Produk tidak tersedia. Perbarui keranjang.');
          if (product.stock < item.quantity) throw new HttpError(409, `Stok ${product.name} tidak cukup (tersisa ${product.stock}).`);
          if (input.acceptedPrices && input.acceptedPrices.find((entry) => entry.productId === item.productId).unitPrice !== product.sellingPrice) {
            throw new HttpError(409, `Harga ${product.name} berubah lagi. Periksa ulang keranjang ditahan.`);
          }
          return { ...item, product, unitPrice: product.sellingPrice };
        });
        let totals;
        try { totals = saleTotals(rows, input.discount, store.defaultTaxRate); }
        catch (error) { throw new HttpError(400, error.message); }
        if (input.expectedTotal !== totals.total) throw new HttpError(409, 'Harga atau pajak berubah. Perbarui keranjang dan periksa total sebelum membayar.');
        if (input.amountReceived < totals.total) throw new HttpError(400, 'Uang tunai yang diterima belum mencukupi.');
        const invoiceNumber = `INV-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${crypto.randomUUID()}`;
        const sale = await tx.sale.create({ data: {
          invoiceNumber, cashierId: cashier.id, cashierNameSnapshot: cashier.name, ...totals, taxRate: store.defaultTaxRate,
          ...(input.heldCartId && { heldCartId: input.heldCartId }),
          idempotencyKey, requestHash: hash,
          storeSnapshot: { storeName: store.storeName, address: store.address, phone: store.phone,
            receiptFooter: store.receiptFooter, currency: store.currency },
          items: { create: rows.map(({ product, quantity }) => ({ productId: product.id,
            productNameSnapshot: product.name, skuSnapshot: product.sku, quantity,
            categoryIdSnapshot: product.categoryId, categoryNameSnapshot: product.category.name,
            unitPrice: product.sellingPrice, unitCostSnapshot: product.purchasePrice, lineTotal: product.sellingPrice * quantity })) },
          payment: { create: { amountReceived: input.amountReceived, changeAmount: input.amountReceived - totals.total } }
        }, select: saleSelect });
        for (const { product, quantity } of rows) {
          const result = await tx.product.updateMany({ where: { id: product.id, isActive: true, stock: { gte: quantity } },
            data: { stock: { decrement: quantity } } });
          if (result.count !== 1) throw new HttpError(409, `Stok ${product.name} berubah. Perbarui keranjang.`);
          await tx.stockMovement.create({ data: { productId: product.id, userId: cashier.id, type: 'SALE',
            quantityChange: -quantity, stockBefore: product.stock, stockAfter: product.stock - quantity,
            referenceType: 'SALE', referenceId: sale.id, note: invoiceNumber } });
        }
        if (input.heldCartId) {
          const completed = await tx.heldCart.updateMany({ where: { id: input.heldCartId, cashierId: cashier.id,
            status: 'RESUMED', resumeToken: input.resumeToken, resumeExpiresAt: { gt: new Date() } },
          data: { status: 'COMPLETED', resumeToken: null, resumeExpiresAt: null } });
          if (completed.count !== 1) throw new HttpError(409, 'Keranjang sudah digunakan atau sesi telah berakhir.');
        }
        return { sale, replayed: false };
      }, { isolationLevel: 'Serializable' });
    } catch (error) {
      if (error.code === 'P2002') {
        const existing = await db.sale.findUnique({ where: { idempotencyKey } });
        if (existing) {
          checkReplay(existing, cashier.id, hash);
          return { sale: await db.sale.findUnique({ where: { id: existing.id }, select: saleSelect }), replayed: true };
        }
      }
      if (error.code !== 'P2034' || attempt === 3) throw error;
    }
  }
}

export function salesRouter(db, authenticate) {
  const router = Router();
  router.use(authenticate);
  router.get('/settings', asyncRoute(async (_req, res) => {
    const store = await db.storeSetting.findUnique({ where: { id: 1 }, select: { defaultTaxRate: true } });
    if (!store) throw new HttpError(409, 'Pengaturan toko belum tersedia.');
    res.json(store);
  }));
  router.post('/', asyncRoute(async (req, res) => {
    const result = await checkout(db, req.user, req.body);
    res.status(result.replayed ? 200 : 201).json(result);
  }));
  router.get('/', asyncRoute(async (req, res) => {
    const query = historyQuery.parse(req.query);
    const where = {
      ...(req.user.role !== 'ADMIN' && { cashierId: req.user.id }),
      ...(query.q && { invoiceNumber: { contains: query.q, mode: 'insensitive' } }),
      ...((query.from || query.to) && { createdAt: {
        ...(query.from && { gte: new Date(`${query.from}T00:00:00.000Z`) }),
        ...(query.to && { lt: new Date(new Date(`${query.to}T00:00:00.000Z`).getTime() + 86400000) })
      } })
    };
    const [items, total] = await Promise.all([
      db.sale.findMany({ where, select: { id: true, invoiceNumber: true, cashierNameSnapshot: true, total: true, createdAt: true, status: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      db.sale.count({ where })
    ]);
    res.json({ items, total, page: query.page, pageSize: query.pageSize, pages: Math.ceil(total / query.pageSize) });
  }));
  const details = asyncRoute(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const sale = await db.sale.findFirst({ where: { id, ...(req.user.role !== 'ADMIN' && { cashierId: req.user.id }) }, select: saleSelect });
    if (!sale) throw new HttpError(404, 'Transaksi tidak ditemukan atau tidak dapat diakses.');
    res.json({ sale });
  });
  router.get('/:id/receipt', details);
  router.get('/:id', details);
  return router;
}
