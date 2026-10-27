'use client';

import { useAuth } from '../../../components/auth-provider';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { request } from '../../../lib/api';
import { DataState, formatIDR, PageHeading } from '../../../components/catalog-ui';
import { MetricStrip, ProductRanking, RevenueChart } from '../../../components/report-ui';

function AdminOverview() {
  const [data, setData] = useState(null); const [status, setStatus] = useState('loading'); const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    request('/api/reports/overview').then((result) => { if (active) { setData(result); setStatus('ready'); } })
      .catch(() => { if (active) setStatus('error'); });
    return () => { active = false; };
  }, [reload]);
  return <><PageHeading title="Ringkasan toko" description={data ? `Hari ini: ${data.from} · Asia/Jakarta` : 'Ringkasan operasional toko berdasarkan data penjualan.'} action={<Link href="/reports" className="secondary-button">Buka laporan</Link>} />
    <DataState status={status} retry={() => { setStatus('loading'); setReload((n) => n + 1); }} />
    {status === 'ready' && data ? <><MetricStrip metrics={[
      ['Penjualan bruto hari ini', data.today.grossSales, true], ['Penjualan neto hari ini', data.today.netSales, true],
      ['Transaksi hari ini', data.today.transactionCount], ['Produk aktif', data.activeProducts], ['Produk aktif stok rendah', data.lowStockProducts]
    ]} /><p className="field-hint">Bruto sebelum diskon. Neto setelah diskon, tanpa pajak. Stok rendah: stok ≤ minimum.</p>
      <section className="work-panel report-section"><h2>Penjualan neto 7 hari terakhir</h2><RevenueChart data={data.series} /></section>
      <section className="work-panel report-section"><h2>Lima produk terlaris (7 hari)</h2><ProductRanking items={data.topProducts} /></section>
      <section className="work-panel report-section"><h2>Transaksi terbaru</h2>{data.recentTransactions.length ? <div className="table-scroll"><table><thead><tr><th>Invoice / waktu Jakarta</th><th>Kasir</th><th className="numeric">Total termasuk pajak</th><th>Detail</th></tr></thead><tbody>{data.recentTransactions.map((sale) => <tr key={sale.id}><td><span className="invoice-number">{sale.invoiceNumber}</span><span className="subline">{new Date(sale.createdAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}</span></td><td>{sale.cashierNameSnapshot}</td><td className="numeric">{formatIDR(sale.total)}</td><td><Link className="inline-button" href={`/transactions/${sale.id}/receipt`}>Lihat struk</Link></td></tr>)}</tbody></table></div> : <p>Belum ada transaksi toko.</p>}</section>
    </> : null}</>;
}

export default function Dashboard() {
  const { user } = useAuth();
  if (user?.role === 'ADMIN') return <AdminOverview />;
  return <><PageHeading title="Ringkasan toko" description={`Selamat datang, ${user?.name}. Akses Anda: Kasir.`} /><section className="work-panel"><h2>Operasional kasir</h2><p>Buka POS untuk melayani pembeli atau lihat transaksi yang Anda layani. Laporan toko hanya tersedia untuk admin.</p><div className="row-actions"><Link className="primary-button" href="/pos">Buka kasir</Link><Link className="secondary-button" href="/transactions">Transaksi saya</Link></div></section></>;
}
