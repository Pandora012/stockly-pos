'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { request } from '../lib/api';
import { DataState, formatIDR, Pagination } from './catalog-ui';
import { PURCHASE_STATUSES } from '../../../shared/purchases';

export function PurchaseList({ supplierId = '' }) {
  const [q, setQ] = useState(''); const [filter, setFilter] = useState(''); const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], total: 0, pages: 0 }); const [status, setStatus] = useState('loading'); const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    const params = new URLSearchParams({ page: String(page), pageSize: '20' });
    if (supplierId) params.set('supplierId', supplierId); if (q) params.set('q', q); if (filter) params.set('status', filter);
    request(`/api/purchases?${params}`).then((result) => { if (active) { setData(result); setStatus('ready'); } })
      .catch(() => { if (active) setStatus('error'); });
    return () => { active = false; };
  }, [supplierId, q, filter, page, reload]);
  return <><div className="catalog-toolbar"><label>Cari nomor PO atau supplier<input type="search" value={q} onChange={(event) => { setQ(event.target.value); setPage(1); setStatus('loading'); }} /></label><label>Status PO<select value={filter} onChange={(event) => { setFilter(event.target.value); setPage(1); setStatus('loading'); }}><option value="">Semua status</option>{Object.entries(PURCHASE_STATUSES).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label></div>
    <DataState status={status} empty={status === 'ready' && !data.total} retry={() => { setStatus('loading'); setReload((n) => n + 1); }} />
    {status === 'ready' && data.items.length ? <><div className="table-scroll"><table><thead><tr><th>Nomor PO / tanggal Jakarta</th>{!supplierId ? <th>Supplier</th> : null}<th>Status</th><th className="numeric">Total</th><th>Detail</th></tr></thead><tbody>{data.items.map((po) => <tr key={po.id}><td><span className="invoice-number">{po.poNumber}</span><span className="subline">{new Date(po.createdAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}</span></td>{!supplierId ? <td>{po.supplierNameSnapshot}</td> : null}<td>{PURCHASE_STATUSES[po.status]}</td><td className="numeric">{formatIDR(po.totalAmount)}</td><td><Link href={`/purchases/${po.id}`} className="inline-button">Buka PO</Link></td></tr>)}</tbody></table></div><Pagination page={page} total={data.total} pages={data.pages} onChange={(value) => { setPage(value); setStatus('loading'); }} /></> : null}</>;
}
