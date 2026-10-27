'use client';

import { useEffect, useState } from 'react';
import { Access } from '../../../components/access';
import { DataState, formatIDR, PageHeading, Pagination } from '../../../components/catalog-ui';
import { MetricStrip, ProductRanking, RevenueChart } from '../../../components/report-ui';
import { downloadReport, request } from '../../../lib/api';
import { reportingDay } from '../../../../../shared/reporting-time';

function Reports() {
  const [filters, setFilters] = useState(() => { const today = reportingDay(); return { from: `${today.slice(0, 7)}-01`, to: today, groupBy: 'daily' }; });
  const [applied, setApplied] = useState(filters);
  const [sales, setSales] = useState(null); const [products, setProducts] = useState(null);
  const [page, setPage] = useState(1); const [status, setStatus] = useState('loading');
  const [reload, setReload] = useState(0); const [exporting, setExporting] = useState(false); const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    const params = new URLSearchParams(applied);
    Promise.all([request(`/api/reports/sales?${params}`), request(`/api/reports/products?${params}&page=${page}&pageSize=20`)]).then(([summary, ranking]) => {
      if (active) { setSales(summary); setProducts(ranking); setStatus('ready'); setMessage(''); }
    }).catch((error) => { if (active) { setStatus('error'); setMessage(error.message); } });
    return () => { active = false; };
  }, [applied, page, reload]);

  function submit(event) {
    event.preventDefault(); setMessage('');
    const days = (Date.parse(`${filters.to}T00:00:00Z`) - Date.parse(`${filters.from}T00:00:00Z`)) / 86400000 + 1;
    if (!Number.isFinite(days) || days < 1 || days > 366) { setMessage('Rentang laporan harus 1 sampai 366 hari.'); return; }
    setApplied({ ...filters }); setPage(1); setStatus('loading');
  }
  async function exportExcel() {
    setExporting(true); setMessage('');
    try { await downloadReport(new URLSearchParams(applied)); setMessage('Workbook Excel berhasil diunduh.'); }
    catch (error) { setMessage(error.message); }
    finally { setExporting(false); }
  }
  return <><PageHeading title="Laporan penjualan" description="Penjualan, kategori, dan estimasi laba kotor. Semua periode memakai Asia/Jakarta." />
    <section className="work-panel report-section"><form className="report-filters" onSubmit={submit}>
      <label>Dari tanggal<input type="date" min="2000-01-01" max="2100-12-31" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} required /></label>
      <label>Sampai tanggal<input type="date" min="2000-01-01" max="2100-12-31" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} required /></label>
      <label>Ringkasan<select value={filters.groupBy} onChange={(event) => setFilters({ ...filters, groupBy: event.target.value })}><option value="daily">Harian</option><option value="monthly">Bulanan</option></select></label>
      <button className="primary-button" type="submit">Terapkan filter</button>
      <button className="secondary-button" type="button" disabled={exporting || status !== 'ready'} onClick={exportExcel}>{exporting ? 'Menyiapkan Excel…' : 'Unduh Excel'}</button>
    </form><p className="field-hint">Laporan: maksimum 366 hari. Excel: maksimum 93 hari dan 10.000 transaksi/produk. Stok pada workbook adalah posisi saat ekspor.</p></section>
    {message ? <p className="feedback" role="status">{message}</p> : null}
    <DataState status={status} retry={() => { setStatus('loading'); setReload((n) => n + 1); }} />
    {status === 'ready' && sales && products ? <><p className="report-period">Periode diterapkan: <strong>{sales.from} sampai {sales.to}</strong> (Asia/Jakarta)</p>
      <MetricStrip metrics={[
        ['Penjualan bruto', sales.summary.grossSales, true], ['Penjualan neto (tanpa pajak)', sales.summary.netSales, true],
        ['Transaksi', sales.summary.transactionCount], ['Unit terjual', sales.summary.unitsSold], ['Estimasi laba kotor', sales.summary.grossProfit, true]
      ]} />
      <p className="profit-note">Laba kotor = penjualan neto setelah diskon dikurangi biaya barang dari snapshot saat penjualan. Ini bukan laba bersih: biaya operasional tidak diperhitungkan. Pajak tidak dihitung sebagai pendapatan.</p>
      <p className="field-hint">Pajak dipungut: {formatIDR(sales.summary.tax)}. Penerimaan termasuk pajak: {formatIDR(sales.summary.amountCollected)}. Kategori transaksi sebelum Phase 4 mengikuti katalog pada saat migrasi, bukan data historis yang sebelumnya tidak tercatat.</p>
      <section className="work-panel report-section"><h2>Penjualan neto {sales.groupBy === 'monthly' ? 'bulanan' : 'harian'}</h2><RevenueChart data={sales.series} />
        <div className="table-scroll"><table><thead><tr><th>Periode</th><th className="numeric">Transaksi</th><th className="numeric">Unit</th><th className="numeric">Bruto</th><th className="numeric">Diskon</th><th className="numeric">Neto</th><th className="numeric">Est. laba kotor</th></tr></thead><tbody>{sales.series.map((row) => <tr key={row.period}><td>{row.period}</td><td className="numeric">{row.transactionCount}</td><td className="numeric">{row.unitsSold}</td><td className="numeric">{formatIDR(row.grossSales)}</td><td className="numeric">{formatIDR(row.discount)}</td><td className="numeric">{formatIDR(row.netSales)}</td><td className="numeric">{formatIDR(row.grossProfit)}</td></tr>)}</tbody></table></div>
      </section>
      <section className="work-panel report-section"><h2>Penjualan per kategori</h2>{sales.categories.length ? <div className="table-scroll"><table><thead><tr><th>Kategori saat penjualan</th><th className="numeric">Unit terjual</th><th className="numeric">Neto (alokasi diskon)</th><th className="numeric">Est. laba kotor</th></tr></thead><tbody>{sales.categories.map((category) => <tr key={category.id}><td>{category.name}</td><td className="numeric">{category.unitsSold}</td><td className="numeric">{formatIDR(category.netSales)}</td><td className="numeric">{formatIDR(category.grossProfit)}</td></tr>)}</tbody></table></div> : <p>Belum ada penjualan per kategori pada periode ini.</p>}</section>
      <section className="work-panel report-section"><h2>Produk terlaris berdasarkan unit</h2><ProductRanking items={products.items} detailed /><Pagination page={page} pages={products.pages} total={products.total} onChange={(value) => { setPage(value); setStatus('loading'); }} /></section>
    </> : null}</>;
}

export default function ReportsPage() { return <Access admin><Reports /></Access>; }
