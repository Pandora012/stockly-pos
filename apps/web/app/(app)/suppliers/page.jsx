'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Access } from '../../../components/access';
import { DataState, PageHeading, Pagination } from '../../../components/catalog-ui';
import { PurchaseList } from '../../../components/purchase-list';
import { request } from '../../../lib/api';

const schema = z.object({ name: z.string().trim().min(1, 'Nama supplier wajib diisi.').max(160),
  contactPerson: z.string().trim().max(120), phone: z.string().trim().max(30),
  email: z.string().trim().refine((value) => !value || z.email().safeParse(value).success, 'Email tidak valid.'),
  address: z.string().trim().max(500), notes: z.string().trim().max(1000) });
const defaults = { name: '', contactPerson: '', phone: '', email: '', address: '', notes: '' };

function SupplierForm({ supplier, onSaved, onClose }) {
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(schema),
    defaultValues: supplier ?? defaults });
  const [error, setError] = useState('');
  async function submit(values) {
    setError('');
    try { const data = await request(supplier ? `/api/suppliers/${supplier.id}` : '/api/suppliers', { method: supplier ? 'PATCH' : 'POST', body: values }); onSaved(data.supplier); }
    catch (failure) { setError(failure.message); }
  }
  return <section className="work-panel editor-panel"><h2>{supplier ? 'Ubah supplier' : 'Tambah supplier'}</h2><form onSubmit={handleSubmit(submit)} noValidate>
    {[['Nama supplier', 'name', 160], ['Kontak person', 'contactPerson', 120], ['Telepon', 'phone', 30], ['Email', 'email', 255]].map(([label, name, maxLength]) => <label key={name}>{label}<input {...register(name)} maxLength={maxLength} type={name === 'email' ? 'email' : name === 'phone' ? 'tel' : 'text'} aria-invalid={!!errors[name]} />{errors[name] ? <small role="alert">{errors[name].message}</small> : null}</label>)}
    <label>Alamat<textarea rows="3" {...register('address')} maxLength={500} /></label><label>Catatan<textarea rows="3" {...register('notes')} maxLength={1000} /></label>
    {error ? <p role="alert" className="form-error">{error}</p> : null}
    <div className="row-actions"><button className="primary-button" type="submit" disabled={isSubmitting}>{isSubmitting ? 'Menyimpan…' : 'Simpan supplier'}</button><button type="button" className="secondary-button" onClick={onClose}>Batal</button></div>
  </form></section>;
}

function Suppliers() {
  const [data, setData] = useState({ items: [], total: 0, pages: 0 }); const [q, setQ] = useState(''); const [activeFilter, setActiveFilter] = useState('');
  const [page, setPage] = useState(1); const [status, setStatus] = useState('loading'); const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState(undefined); const [selected, setSelected] = useState(null); const [detail, setDetail] = useState(null);
  const [detailStatus, setDetailStatus] = useState('loading'); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(null);
  useEffect(() => {
    let mounted = true;
    const params = new URLSearchParams({ page: String(page), pageSize: '20' });
    if (q) params.set('q', q); if (activeFilter) params.set('isActive', activeFilter);
    request(`/api/suppliers?${params}`).then((result) => { if (mounted) { setData(result); setStatus('ready'); } }).catch(() => { if (mounted) setStatus('error'); });
    return () => { mounted = false; };
  }, [q, activeFilter, page, reload]);
  useEffect(() => {
    if (!selected) return;
    let mounted = true;
    request(`/api/suppliers/${selected}`).then((result) => { if (mounted) { setDetail(result.supplier); setDetailStatus('ready'); } })
      .catch(() => { if (mounted) setDetailStatus('error'); });
    return () => { mounted = false; };
  }, [selected, reload]);
  function select(id) { setSelected(id); setDetailStatus('loading'); if (id === selected) setReload((n) => n + 1); }
  async function toggle(supplier) {
    setBusy(supplier.id); setMessage('');
    try { await request(`/api/suppliers/${supplier.id}`, { method: 'PATCH', body: { isActive: !supplier.isActive } });
      setReload((n) => n + 1); setMessage(`Supplier ${supplier.isActive ? 'dinonaktifkan' : 'diaktifkan'}. Riwayat tetap tersimpan.`); }
    catch (error) { setMessage(error.message); } finally { setBusy(null); }
  }
  return <><PageHeading title="Supplier" description="Kelola kontak pemasok dan riwayat pembelian toko." action={<button className="primary-button" type="button" onClick={() => setEditing(null)}>Tambah supplier</button>} />
    {message ? <p className="feedback" role="status">{message}</p> : null}
    <div className="catalog-layout"><section className="work-panel"><div className="catalog-toolbar"><label>Cari supplier atau kontak<input type="search" value={q} onChange={(event) => { setQ(event.target.value); setPage(1); setStatus('loading'); }} /></label><label>Status supplier<select value={activeFilter} onChange={(event) => { setActiveFilter(event.target.value); setPage(1); setStatus('loading'); }}><option value="">Semua status</option><option value="true">Aktif</option><option value="false">Nonaktif</option></select></label></div>
      <DataState status={status} empty={status === 'ready' && !data.total} retry={() => { setStatus('loading'); setReload((n) => n + 1); }} />
      {status === 'ready' && data.items.length ? <><div className="table-scroll"><table><thead><tr><th>Supplier / kontak</th><th>Telepon / email</th><th>Status</th><th>Tindakan</th></tr></thead><tbody>{data.items.map((supplier) => <tr key={supplier.id}><td><strong>{supplier.name}</strong><span className="subline">{supplier.contactPerson}</span></td><td>{supplier.phone || 'Belum diisi'}<span className="subline">{supplier.email}</span></td><td>{supplier.isActive ? 'Aktif' : 'Nonaktif'}</td><td><div className="row-actions"><button className="inline-button" type="button" onClick={() => select(supplier.id)}>Detail / riwayat</button><button className="inline-button" type="button" onClick={() => setEditing(supplier)}>Ubah</button><button className="inline-button" type="button" disabled={busy === supplier.id} onClick={() => toggle(supplier)}>{supplier.isActive ? 'Nonaktifkan' : 'Aktifkan'}</button></div></td></tr>)}</tbody></table></div><Pagination page={page} total={data.total} pages={data.pages} onChange={(value) => { setPage(value); setStatus('loading'); }} /></> : null}
    </section>{editing !== undefined ? <SupplierForm key={editing?.id ?? 'new'} supplier={editing} onClose={() => setEditing(undefined)} onSaved={(supplier) => { setEditing(undefined); setReload((n) => n + 1); select(supplier.id); setMessage('Supplier disimpan.'); }} /> : null}</div>
    {selected ? <section className="work-panel supplier-history"><h2>Detail dan riwayat supplier</h2><DataState status={detailStatus} retry={() => { setDetailStatus('loading'); setReload((n) => n + 1); }} />{detailStatus === 'ready' && detail ? <><h3>{detail.name}</h3><dl className="detail-grid"><div><dt>Kontak</dt><dd>{detail.contactPerson || 'Belum diisi'}</dd></div><div><dt>Telepon</dt><dd>{detail.phone || 'Belum diisi'}</dd></div><div><dt>Email</dt><dd>{detail.email || 'Belum diisi'}</dd></div><div><dt>Alamat</dt><dd>{detail.address || 'Belum diisi'}</dd></div><div><dt>Catatan</dt><dd>{detail.notes || 'Tidak ada catatan'}</dd></div></dl><h3>Riwayat purchase order</h3><PurchaseList key={detail.id} supplierId={detail.id} /></> : null}</section> : null}</>;
}

export default function SuppliersPage() { return <Access admin><Suppliers /></Access>; }
