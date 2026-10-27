import { Router } from 'express';
import { z } from 'zod';
import { rateLimit } from 'express-rate-limit';
import { overview, reportRange, rangeMetadata, salesSummary, salesSeries, categorySales, productSales, productCount } from './report-data.js';
import { exportWorkbook, XLSX_TYPE } from './report-workbook.js';

const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);

export function reportsRouter(db, authenticate, adminOnly) {
  const router = Router(); router.use(authenticate, adminOnly);
  router.get('/overview', asyncRoute(async (req, res) => {
    z.object({}).strict().parse(req.query);
    res.json(await overview(db));
  }));
  router.get('/sales', asyncRoute(async (req, res) => {
    const range = reportRange(req.query);
    const data = await db.$transaction(async (tx) => {
      const [summary, series, categories] = await Promise.all([salesSummary(tx, range), salesSeries(tx, range), categorySales(tx, range)]);
      return { summary, series, categories };
    }, { isolationLevel: 'RepeatableRead', timeout: 15000 });
    res.json({ ...rangeMetadata(range), ...data });
  }));
  router.get('/products', asyncRoute(async (req, res) => {
    const range = reportRange(req.query);
    const data = await db.$transaction(async (tx) => {
      const [items, total] = await Promise.all([productSales(tx, range), productCount(tx, range)]);
      return { items, total };
    }, { isolationLevel: 'RepeatableRead', timeout: 15000 });
    res.json({ ...rangeMetadata(range), ...data, page: range.page, pageSize: range.pageSize, pages: Math.ceil(data.total / range.pageSize) });
  }));
  const exportLimiter = rateLimit({ windowMs: 60000, limit: 5, keyGenerator: (req) => req.user.id,
    standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Terlalu banyak ekspor. Tunggu satu menit dan coba lagi.' } });
  router.get('/export', exportLimiter, asyncRoute(async (req, res) => {
    const range = reportRange(req.query, 93);
    const buffer = await exportWorkbook(db, range);
    res.set('Content-Type', XLSX_TYPE);
    res.set('Content-Disposition', `attachment; filename="stockly-report-${range.from}-${range.to}.xlsx"`);
    res.send(buffer);
  }));
  return router;
}
