'use client';

import { useEffect, useState } from 'react';
import { Access } from '../../../components/access';
import { DataState, PageHeading } from '../../../components/catalog-ui';
import { request } from '../../../lib/api';

function Categories() {
  const [categories, setCategories] = useState([]);
  const [status, setStatus] = useState('loading');
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let active = true;
    request('/api/categories').then((data) => { if (active) { setCategories(data.categories); setStatus('ready'); } })
      .catch(() => { if (active) setStatus('error'); });
    return () => { active = false; };
  }, [reload]);

  function edit(category) { setEditing(category); setName(category.name); setSlug(category.slug); setMessage(''); }
  function resetForm() { setEditing(null); setName(''); setSlug(''); }
  async function submit(event) {
    event.preventDefault(); setMessage('');
    const data = { name: name.trim(), ...(slug.trim() && { slug: slug.trim().toLowerCase() }) };
    if (!data.name || data.name.length > 120 || (data.slug && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(data.slug))) {
      setMessage('Nama wajib diisi. Slug hanya boleh huruf kecil, angka, dan tanda hubung.'); return;
    }
    setSaving(true);
    try {
      await request(editing ? `/api/categories/${editing.id}` : '/api/categories', { method: editing ? 'PATCH' : 'POST', body: data });
      setMessage(editing ? 'Kategori diperbarui.' : 'Kategori ditambahkan.'); resetForm(); setReload((n) => n + 1);
    } catch (error) { setMessage(error.message); }
    finally { setSaving(false); }
  }
  async function toggle(category) {
    setMessage(''); setSaving(true);
    try {
      await request(`/api/categories/${category.id}`, { method: 'PATCH', body: { isActive: !category.isActive } });
      setReload((n) => n + 1); setMessage(`Kategori ${category.isActive ? 'dinonaktifkan' : 'diaktifkan'}.`);
    } catch (error) { setMessage(error.message); }
    finally { setSaving(false); }
  }
  return <><PageHeading title="Kategori" description="Pengelompokan produk yang tersedia di toko." />
    <div className="users-grid"><section className="work-panel"><h2>Daftar kategori</h2>
      <DataState status={status} retry={() => { setStatus('loading'); setReload((n) => n + 1); }} empty={status === 'ready' && categories.length === 0} />
      {status === 'ready' && categories.length > 0 ? <div className="table-scroll"><table><thead><tr><th>Nama</th><th>Slug</th><th>Status</th><th>Tindakan</th></tr></thead><tbody>{categories.map((category) => <tr key={category.id}><td>{category.name}</td><td>{category.slug}</td><td>{category.isActive ? 'Aktif' : 'Nonaktif'}</td><td><div className="row-actions"><button className="inline-button" type="button" onClick={() => edit(category)}>Ubah</button><button className="inline-button" type="button" disabled={saving} onClick={() => toggle(category)}>{category.isActive ? 'Nonaktifkan' : 'Aktifkan'}</button></div></td></tr>)}</tbody></table></div> : null}
    </section><section className="work-panel"><h2>{editing ? 'Ubah kategori' : 'Tambah kategori'}</h2><form onSubmit={submit}>
      <label>Nama<input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required /></label>
      <label>Slug {editing ? '' : '(opsional)'}<input value={slug} onChange={(event) => setSlug(event.target.value)} maxLength={120} placeholder="contoh: makanan-ringan" /></label>
      <p className="field-hint">{editing ? 'Biarkan kosong untuk mempertahankan slug.' : 'Slug akan dibuat dari nama jika dibiarkan kosong.'}</p>
      <button className="primary-button" type="submit" disabled={saving}>{saving ? 'Menyimpan…' : editing ? 'Simpan perubahan' : 'Tambah kategori'}</button>
      {editing ? <button className="secondary-button" type="button" onClick={resetForm}>Batal</button> : null}
    </form></section></div>{message ? <p className="feedback" role="status">{message}</p> : null}</>;
}

export default function CategoriesPage() { return <Access admin><Categories /></Access>; }
