'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { DataState, formatIDR, PageHeading, Pagination } from '../../../components/catalog-ui';
import { useAuth } from '../../../components/auth-provider';
import { request } from '../../../lib/api';

export default function TransactionsPage() {
  const { user } = useAuth();
  const [q, setQ] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [page, setPage] = useState(1); const [reload, setReload] = useState(0);
  const [status, setStatus] = useState('loading'); const [data, setData] = useState({ items: [], total: 0, pages: 0 });
  useEffect(() => {
    let active = true;
    const params = new URLSearchParams({ page: String(page), pageSize: '20' });
    if (q) params.set('q', q); if (from) params.set('from', from); if (to) params.set('to', to);
    request(`/api/sales?${params}`).then((result) => { if (active) { setData(result); setStatus('ready'); } })
      .catch(() => { if (active) setStatus('error'); });
    return () => { active = false; };
  }, [q, from, to, page, reload]);
  function filter(setter, value) { setter(value); setPage(1); setStatus('loading'); }
  return <><PageHeading title="Transaksi" description={user?.role === 'ADMIN' ? 'Riwayat seluruh transaksi toko.' : 'Riwayat transaksi yang Anda layani.'} /><section className="work-panel"><div className="catalog-toolbar"><label>Cari nomor invoice<input type="search" value={q} onChange={(event) => filter(setQ, event.target.value)} /></label><label>Dari tanggal (UTC)<input type="date" value={from} onChange={(event) => filter(setFrom, event.target.value)} /></label><label>Sampai tanggal (UTC)<input type="date" value={to} onChange={(event) => filter(setTo, event.target.value)} /></label></div>
    {from && to && from > to ? <p role="alert" className="form-error">Tanggal awal tidak boleh melewati tanggal akhir.</p> : null}
    <DataState status={status} empty={status === 'ready' && !data.total} retry={() => { setStatus('loading'); setReload((n) => n + 1); }} />
    {status === 'ready' && data.items.length ? <><div className="table-scroll"><table><thead><tr><th>Invoice / tanggal</th><th>Kasir</th><th>Status</th><th className="numeric">Total</th><th>Struk</th></tr></thead><tbody>{data.items.map((sale) => <tr key={sale.id}><td><span className="invoice-number">{sale.invoiceNumber}</span><span className="subline">{new Date(sale.createdAt).toLocaleString('id-ID')}</span></td><td>{sale.cashierNameSnapshot}</td><td>Selesai</td><td className="numeric">{formatIDR(sale.total)}</td><td><Link className="inline-button" href={`/transactions/${sale.id}/receipt`}>Detail / cetak ulang</Link></td></tr>)}</tbody></table></div><Pagination total={data.total} pages={data.pages} page={page} onChange={(value) => { setPage(value); setStatus('loading'); }} /></> : null}
    </section></>;
}
