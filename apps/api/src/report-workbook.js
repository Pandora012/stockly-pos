import ExcelJS from 'exceljs';
import { HttpError } from './catalog.js';
import { productSales, salesSeries, salesSummary } from './report-data.js';

export const EXPORT_LIMIT = 10000;
export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const rupiah = '"Rp" #,##0;[Red]("Rp" #,##0)';
const moneyKeys = ['grossSales', 'discount', 'tax', 'netSales', 'amountCollected', 'costOfGoods', 'grossProfit',
  'total', 'amountReceived', 'changeAmount', 'purchasePrice', 'sellingPrice'];

function sheet(workbook, name, columns, data, totals, range) {
  const result = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 3 }] });
  result.columns = columns.map(([key, header, width = 20]) => ({ key, width }));
  result.addRow([`${range.from} to ${range.to} | Asia/Jakarta | Revenue excludes tax. Gross profit is not net profit.`]);
  result.mergeCells(1, 1, 1, columns.length);
  result.addRow(['Stock Report shows current stock at export, not historical closing stock.']);
  result.mergeCells(2, 1, 2, columns.length);
  result.getRow(1).height = 32; result.getRow(2).height = 28;
  const header = result.addRow(columns.map(([, title]) => title));
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F664F' } };
  for (const row of data) result.addRow(row);
  result.autoFilter = { from: { row: 3, column: 1 }, to: { row: Math.max(3, result.rowCount), column: columns.length } };
  if (totals) {
    const total = result.addRow(totals); total.font = { bold: true };
    total.getCell(1).value = 'TOTAL';
  }
  for (const [index, [key]] of columns.entries()) {
    if (moneyKeys.includes(key)) result.getColumn(index + 1).numFmt = rupiah;
    if (key === 'date') result.getColumn(index + 1).numFmt = 'dd/mm/yyyy hh:mm';
    if (key === 'period' && range.groupBy === 'daily') result.getColumn(index + 1).numFmt = 'dd/mm/yyyy';
  }
  // ExcelJS string cells are shared strings, never formulas or hyperlinks.
  result.eachRow((row) => row.eachCell((cell) => {
    if (typeof cell.value === 'string') cell.value = String(cell.value);
    cell.alignment = { vertical: 'top', wrapText: true };
  }));
  return result;
}

export async function exportWorkbook(db, range) {
  const data = await db.$transaction(async (tx) => {
    const where = { status: 'COMPLETED', createdAt: { gte: range.start, lt: range.end } };
    const [saleCount, stockCount] = await Promise.all([tx.sale.count({ where }), tx.product.count()]);
    if (saleCount > EXPORT_LIMIT || stockCount > EXPORT_LIMIT) {
      throw new HttpError(413, 'Ekspor dibatasi 10.000 transaksi dan 10.000 produk stok. Persempit rentang tanggal.');
    }
    const [summary, series, products, transactions, stock, stockTotals, payments] = await Promise.all([
      salesSummary(tx, range), salesSeries(tx, range), productSales(tx, range, { limit: EXPORT_LIMIT + 1, offset: 0 }),
      tx.sale.findMany({ where, select: { invoiceNumber: true, createdAt: true, cashierNameSnapshot: true,
        subtotal: true, discount: true, tax: true, total: true, payment: { select: { amountReceived: true, changeAmount: true } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: EXPORT_LIMIT }),
      tx.product.findMany({ include: { category: { select: { name: true } } }, orderBy: [{ sku: 'asc' }, { id: 'asc' }], take: EXPORT_LIMIT }),
      tx.product.aggregate({ _sum: { stock: true, minimumStock: true } }), paymentTotals(tx, range)
    ]);
    if (products.length > EXPORT_LIMIT) throw new HttpError(413, 'Terlalu banyak produk terjual untuk satu ekspor. Persempit tanggal.');
    return { summary, series, products, transactions, stock, stockTotals, payments };
  }, { isolationLevel: 'RepeatableRead', timeout: 30000 });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Stockly POS'; workbook.created = new Date();
  workbook.description = 'Asia/Jakarta reports; gross profit estimate excludes operating costs and is not net profit.';
  const moneyColumns = [['grossSales', 'Gross sales'], ['discount', 'Discount'], ['netSales', 'Net sales (excl tax)'],
    ['tax', 'Tax'], ['amountCollected', 'Amount collected'], ['unitsSold', 'Units sold'], ['costOfGoods', 'Historical COGS'], ['grossProfit', 'Gross profit estimate']];
  sheet(workbook, 'Sales Summary', [['period', 'Period (Jakarta)', 24], ['transactionCount', 'Transactions'], ...moneyColumns],
    data.series.map((row) => ({ ...row, period: range.groupBy === 'monthly' ? row.period : new Date(`${row.period}T00:00:00Z`) })), data.summary, range);
  sheet(workbook, 'Transaction Details', [['invoice', 'Invoice', 54], ['date', 'Date (Jakarta)', 24], ['cashier', 'Cashier', 28],
    ['grossSales', 'Gross sales'], ['discount', 'Discount'], ['netSales', 'Net sales (excl tax)'], ['tax', 'Tax'], ['total', 'Amount collected'],
    ['amountReceived', 'Cash received'], ['changeAmount', 'Change']], data.transactions.map((sale) => ({
    invoice: sale.invoiceNumber, date: new Date(sale.createdAt.getTime() + 7 * 3600000), cashier: sale.cashierNameSnapshot,
    grossSales: sale.subtotal, discount: sale.discount, netSales: sale.subtotal - sale.discount, tax: sale.tax, total: sale.total,
    amountReceived: sale.payment?.amountReceived ?? 0, changeAmount: sale.payment?.changeAmount ?? 0
  })), { grossSales: data.summary.grossSales, discount: data.summary.discount, netSales: data.summary.netSales,
    tax: data.summary.tax, total: data.summary.amountCollected,
    ...data.payments }, range);
  sheet(workbook, 'Top Products', [['name', 'Product (latest sold name)', 38], ['sku', 'SKU', 28], ['unitsSold', 'Units sold'],
    ['grossSales', 'Gross sales'], ['netSales', 'Net sales (allocated discount)'], ['costOfGoods', 'Historical COGS'], ['grossProfit', 'Gross profit estimate']],
  data.products, data.summary, range);
  sheet(workbook, 'Stock Report', [['name', 'Current product', 38], ['sku', 'SKU', 28], ['barcode', 'Barcode (text)', 24], ['category', 'Current category', 28],
    ['isActive', 'Active'], ['stock', 'Current stock'], ['minimumStock', 'Minimum stock'], ['lowStock', 'Low stock'],
    ['purchasePrice', 'Current purchase price'], ['sellingPrice', 'Current selling price']],
  data.stock.map((product) => ({ ...product, barcode: product.barcode ?? '', category: product.category.name,
    isActive: product.isActive ? 'Yes' : 'No', lowStock: product.stock <= product.minimumStock ? 'Yes' : 'No' })),
  { stock: data.stockTotals._sum.stock ?? 0, minimumStock: data.stockTotals._sum.minimumStock ?? 0 }, range);
  return workbook.xlsx.writeBuffer();
}

async function paymentTotals(db, range) {
  const totals = await db.payment.aggregate({ where: { sale: { status: 'COMPLETED', createdAt: { gte: range.start, lt: range.end } } },
    _sum: { amountReceived: true, changeAmount: true } });
  return { amountReceived: totals._sum.amountReceived ?? 0, changeAmount: totals._sum.changeAmount ?? 0 };
}
