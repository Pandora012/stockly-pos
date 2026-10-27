import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { HttpError } from './catalog.js';
import { reportingDay, REPORT_TIMEZONE, shiftDay } from '../../../shared/reporting-time.js';

export function reportRange(query, maxDays = 366, now = new Date()) {
  const date = z.string().date().refine((value) => value >= '2000-01-01' && value <= '2100-12-31');
  const input = z.object({ from: date.optional(), to: date.optional(), groupBy: z.enum(['daily', 'monthly']).default('daily'),
    page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20)
  }).strict().parse(query);
  const today = reportingDay(now);
  const from = input.from ?? `${today.slice(0, 7)}-01`;
  const to = input.to ?? today;
  const start = new Date(`${from}T00:00:00+07:00`);
  const end = new Date(`${shiftDay(to, 1)}T00:00:00+07:00`);
  const days = (end - start) / 86400000;
  if (days < 1 || days > maxDays) throw new HttpError(400, `Rentang laporan harus 1 sampai ${maxDays} hari (Asia/Jakarta).`);
  return { ...input, from, to, start, end, days, timezone: REPORT_TIMEZONE };
}

export function rangeMetadata(range) {
  return { from: range.from, to: range.to, timezone: range.timezone, groupBy: range.groupBy };
}

function numericRows(rows) {
  return rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => {
    if (typeof value !== 'bigint' && !(value instanceof Prisma.Decimal)) return [key, value];
    const number = Number(value);
    if (!Number.isSafeInteger(number)) throw new HttpError(413, 'Nilai laporan terlalu besar. Persempit rentang tanggal.');
    return [key, number];
  })));
}

function salesCTE(range) {
  return Prisma.sql`WITH sales AS (
    SELECT * FROM "Sale" WHERE "status" = 'COMPLETED'
      AND "createdAt" >= (${range.start}::timestamptz AT TIME ZONE 'UTC')
      AND "createdAt" < (${range.end}::timestamptz AT TIME ZONE 'UTC')
  )`;
}

function linesCTE(range) {
  return Prisma.sql`${salesCTE(range)}, ordered AS (
    SELECT i.*, s."subtotal", s."discount", s."createdAt",
      SUM(i."lineTotal") OVER (PARTITION BY i."saleId" ORDER BY i."id" ROWS UNBOUNDED PRECEDING) AS running
    FROM "SaleItem" i JOIN sales s ON s."id" = i."saleId"
  ), lines AS (
    SELECT *, "lineTotal"::bigint - (
      ("discount"::bigint * running / NULLIF("subtotal", 0)) -
      ("discount"::bigint * (running - "lineTotal") / NULLIF("subtotal", 0))
    ) AS net, "quantity"::bigint * "unitCostSnapshot" AS cost FROM ordered
  )`;
}

export async function salesSummary(db, range) {
  const result = await db.$queryRaw(Prisma.sql`${salesCTE(range)} SELECT
    COUNT(*) AS "transactionCount", COALESCE(SUM("subtotal"), 0) AS "grossSales",
    COALESCE(SUM("discount"), 0) AS discount, COALESCE(SUM("tax"), 0) AS tax,
    COALESCE(SUM("subtotal"::bigint - "discount"), 0) AS "netSales",
    COALESCE(SUM("total"), 0) AS "amountCollected",
    (SELECT COALESCE(SUM(i."quantity"), 0) FROM "SaleItem" i JOIN sales s ON s."id" = i."saleId") AS "unitsSold",
    (SELECT COALESCE(SUM(i."quantity"::bigint * i."unitCostSnapshot"), 0) FROM "SaleItem" i JOIN sales s ON s."id" = i."saleId") AS "costOfGoods",
    COALESCE(SUM("subtotal"::bigint - "discount"), 0) -
      (SELECT COALESCE(SUM(i."quantity"::bigint * i."unitCostSnapshot"), 0) FROM "SaleItem" i JOIN sales s ON s."id" = i."saleId") AS "grossProfit"
    FROM sales`);
  return numericRows(result)[0];
}

export async function salesSeries(db, range) {
  const unit = range.groupBy === 'monthly' ? 'month' : 'day';
  return numericRows(await db.$queryRaw(Prisma.sql`${salesCTE(range)}, periods AS (
    SELECT generate_series(date_trunc(${unit}, ${range.from}::date::timestamp), date_trunc(${unit}, ${range.to}::date::timestamp),
      CASE WHEN ${unit} = 'month' THEN interval '1 month' ELSE interval '1 day' END) AS period
  ), grouped AS (
    SELECT date_trunc(${unit}, "createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jakarta') AS period,
      COUNT(*) AS transactions, SUM("subtotal") AS gross, SUM("discount") AS discount, SUM("tax") AS tax,
      SUM("subtotal"::bigint - "discount") AS net, SUM("total") AS collected FROM sales GROUP BY 1
  ), item_groups AS (
    SELECT date_trunc(${unit}, s."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jakarta') AS period,
      SUM(i."quantity") AS units, SUM(i."quantity"::bigint * i."unitCostSnapshot") AS cost
    FROM "SaleItem" i JOIN sales s ON s."id" = i."saleId" GROUP BY 1
  ) SELECT to_char(p.period, CASE WHEN ${unit} = 'month' THEN 'YYYY-MM' ELSE 'YYYY-MM-DD' END) AS period,
    COALESCE(g.transactions, 0) AS "transactionCount", COALESCE(g.gross, 0) AS "grossSales",
    COALESCE(g.discount, 0) AS discount, COALESCE(g.tax, 0) AS tax,
    COALESCE(g.net, 0) AS "netSales", COALESCE(g.collected, 0) AS "amountCollected",
    COALESCE(i.units, 0) AS "unitsSold", COALESCE(i.cost, 0) AS "costOfGoods",
    COALESCE(g.net, 0) - COALESCE(i.cost, 0) AS "grossProfit"
    FROM periods p LEFT JOIN grouped g USING (period) LEFT JOIN item_groups i USING (period) ORDER BY p.period`));
}

export async function categorySales(db, range) {
  const rows = numericRows(await db.$queryRaw(Prisma.sql`${linesCTE(range)}
    SELECT "categoryIdSnapshot" AS id, (array_agg("categoryNameSnapshot" ORDER BY "createdAt" DESC, "id" DESC))[1] AS name, SUM("quantity") AS "unitsSold",
      SUM("lineTotal") AS "grossSales", SUM(net) AS "netSales", SUM(cost) AS "costOfGoods", SUM(net - cost) AS "grossProfit"
    FROM lines GROUP BY "categoryIdSnapshot" ORDER BY SUM(net) DESC, "categoryIdSnapshot" LIMIT 1001`));
  if (rows.length > 1000) throw new HttpError(413, 'Terlalu banyak kategori. Persempit rentang tanggal.');
  return rows;
}

export async function productSales(db, range, { limit = range.pageSize, offset = (range.page - 1) * range.pageSize } = {}) {
  return numericRows(await db.$queryRaw(Prisma.sql`${linesCTE(range)}
    SELECT "productId" AS id, (array_agg("productNameSnapshot" ORDER BY "createdAt" DESC, "id" DESC))[1] AS name,
      (array_agg("skuSnapshot" ORDER BY "createdAt" DESC, "id" DESC))[1] AS sku,
      SUM("quantity") AS "unitsSold", SUM("lineTotal") AS "grossSales", SUM(net) AS "netSales",
      SUM(cost) AS "costOfGoods", SUM(net - cost) AS "grossProfit"
    FROM lines GROUP BY "productId" ORDER BY SUM("quantity") DESC, SUM(net) DESC, "productId"
    LIMIT ${limit} OFFSET ${offset}`));
}

export async function productCount(db, range) {
  return numericRows(await db.$queryRaw(Prisma.sql`${salesCTE(range)}
    SELECT COUNT(DISTINCT i."productId") AS count FROM "SaleItem" i JOIN sales s ON s."id" = i."saleId"`))[0].count;
}

export async function overview(db, now = new Date()) {
  const today = reportingDay(now);
  const day = reportRange({ from: today, to: today }, 366, now);
  const week = reportRange({ from: shiftDay(today, -6), to: today }, 366, now);
  return db.$transaction(async (tx) => {
    const [totals, series, topProducts, counts, recentTransactions] = await Promise.all([
      salesSummary(tx, day), salesSeries(tx, week), productSales(tx, week, { limit: 5, offset: 0 }),
      tx.$queryRaw`SELECT COUNT(*) FILTER (WHERE "isActive") AS "activeProducts",
        COUNT(*) FILTER (WHERE "isActive" AND "stock" <= "minimumStock") AS "lowStockProducts" FROM "Product"`,
      tx.sale.findMany({ where: { status: 'COMPLETED' }, select: { id: true, invoiceNumber: true,
        cashierNameSnapshot: true, total: true, createdAt: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 5 })
    ]);
    return { ...rangeMetadata(day), today: totals, ...numericRows(counts)[0], series, topProducts, recentTransactions,
      topProductsRange: rangeMetadata(week) };
  }, { isolationLevel: 'RepeatableRead', timeout: 15000 });
}
