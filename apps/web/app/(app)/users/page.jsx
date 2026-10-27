'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Access } from '../../../components/access';
import { request } from '../../../lib/api';

const schema = z.object({
  name: z.string().trim().min(1, 'Nama wajib diisi.').max(120),
  email: z.email('Email tidak valid.'),
  password: z.string().min(12, 'Minimal 12 karakter.').max(128)
});

function UserManagement() {
  const [users, setUsers] = useState([]);
  const [status, setStatus] = useState('loading');
  const [message, setMessage] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [editing, setEditing] = useState(null);
  const [editName, setEditName] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(schema) });

  async function load() {
    setStatus('loading');
    try { const data = await request('/api/users'); setUsers(data.users); setStatus('ready'); }
    catch { setStatus('error'); }
  }
  useEffect(() => { load(); }, []);

  async function addUser(values) {
    setMessage('');
    try {
      const data = await request('/api/users', { method: 'POST', body: values });
      setUsers((previous) => [data.user, ...previous]);
      reset();
      setMessage('Akun kasir dibuat.');
    } catch (error) { setMessage(error.message); }
  }
  async function toggle(user) {
    setBusyId(user.id); setMessage('');
    try {
      const data = await request(`/api/users/${user.id}`, { method: 'PATCH', body: { isActive: !user.isActive } });
      setUsers((previous) => previous.map((item) => item.id === user.id ? data.user : item));
      setMessage(`Akun ${user.name} ${data.user.isActive ? 'diaktifkan' : 'dinonaktifkan'}.`);
    } catch (error) { setMessage(error.message); }
    finally { setBusyId(null); }
  }
  async function saveEdit(event) {
    event.preventDefault();
    if (!editName.trim() || editName.length > 120 || (editPassword && (editPassword.length < 12 || editPassword.length > 128))) {
      setMessage('Nama wajib diisi. Kata sandi baru harus 12 sampai 128 karakter.');
      return;
    }
    setBusyId(editing.id); setMessage('');
    try {
      const body = { name: editName.trim(), ...(editPassword && { password: editPassword }) };
      const data = await request(`/api/users/${editing.id}`, { method: 'PATCH', body });
      setUsers((previous) => previous.map((item) => item.id === editing.id ? data.user : item));
      setEditing(null); setEditPassword(''); setMessage(`Akun ${data.user.name} diperbarui.`);
    } catch (error) { setMessage(error.message); }
    finally { setBusyId(null); }
  }
  return <><div className="page-heading"><div><h1>Pengguna</h1><p>Kelola akses kasir di toko ini.</p></div></div>
    <div className="users-grid"><section className="work-panel" aria-labelledby="list-title"><h2 id="list-title">Daftar pengguna</h2>
      {status === 'loading' ? <p role="status">Memuat pengguna…</p> : status === 'error' ? <div role="alert"><p>Pengguna tidak dapat dimuat.</p><button type="button" className="secondary-button" onClick={load}>Coba lagi</button></div> : users.length === 0 ? <p>Belum ada pengguna. Tambahkan akun kasir melalui formulir.</p> : <div className="table-scroll"><table><thead><tr><th>Nama</th><th>Email</th><th>Peran</th><th>Status</th><th>Tindakan</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}><td>{user.name}</td><td>{user.email}</td><td>{user.role === 'ADMIN' ? 'Admin' : 'Kasir'}</td><td>{user.isActive ? 'Aktif' : 'Nonaktif'}</td><td>{user.role === 'CASHIER' ? <div className="row-actions"><button type="button" className="inline-button" onClick={() => { setEditing(user); setEditName(user.name); setEditPassword(''); }} disabled={busyId === user.id}>Ubah</button><button type="button" className="inline-button" disabled={busyId === user.id} onClick={() => toggle(user)}>{busyId === user.id ? 'Menyimpan…' : user.isActive ? 'Nonaktifkan' : 'Aktifkan'}</button></div> : '—'}</td></tr>)}</tbody></table></div>}
      {editing ? <form className="edit-form" onSubmit={saveEdit} aria-label={`Ubah akun ${editing.name}`}><h3>Ubah akun kasir</h3><label>Nama<input value={editName} onChange={(event) => setEditName(event.target.value)} maxLength={120} required /></label><label>Kata sandi baru (opsional)<input type="password" value={editPassword} onChange={(event) => setEditPassword(event.target.value)} autoComplete="new-password" /></label><div className="row-actions"><button className="primary-button" type="submit" disabled={busyId === editing.id}>Simpan perubahan</button><button type="button" className="secondary-button" onClick={() => setEditing(null)}>Batal</button></div></form> : null}
    </section><section className="work-panel" aria-labelledby="form-title"><h2 id="form-title">Tambah kasir</h2><p>Akun baru hanya mendapat akses kasir.</p>
      <form onSubmit={handleSubmit(addUser)} noValidate><label>Nama<input autoComplete="name" {...register('name')} aria-invalid={!!errors.name} /></label>{errors.name ? <small role="alert">{errors.name.message}</small> : null}
      <label>Email<input type="email" autoComplete="off" {...register('email')} aria-invalid={!!errors.email} /></label>{errors.email ? <small role="alert">{errors.email.message}</small> : null}
      <label>Kata sandi awal<input type="password" autoComplete="new-password" {...register('password')} aria-invalid={!!errors.password} /></label>{errors.password ? <small role="alert">{errors.password.message}</small> : null}
      <button className="primary-button" type="submit" disabled={isSubmitting}>{isSubmitting ? 'Menyimpan…' : 'Buat akun kasir'}</button></form>
    </section></div>{message ? <p className="feedback" role="status">{message}</p> : null}</>;
}

export default function UsersPage() { return <Access admin><UserManagement /></Access>; }
