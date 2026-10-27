'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AuthProvider, useAuth } from '../../components/auth-provider';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

const schema = z.object({ email: z.email('Masukkan email yang valid.'), password: z.string().min(1, 'Kata sandi wajib diisi.') });

function LoginForm() {
  const { state, login, retry } = useAuth();
  const router = useRouter();
  const [error, setError] = useState('');
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(schema) });
  useEffect(() => { if (state === 'ready') router.replace('/dashboard'); }, [state, router]);

  async function submit(values) {
    setError('');
    try { await login(values); } catch (failure) { setError(failure.message); }
  }
  return <main className="login-screen"><div className="login-layout"><div className="login-intro"><div className="brand">Stockly <span>POS</span></div><h1>Mulai kerja di toko.</h1><p>Masuk untuk mengelola akses dan operasional harian.</p></div><div className="login-panel"><h2>Masuk ke Stockly</h2><p>Gunakan akun yang diberikan admin toko.</p>
    {state === 'loading' ? <p role="status">Memeriksa sesi…</p> : state === 'error' ? <div role="alert"><p>Server tidak dapat dihubungi. Periksa koneksi lalu coba lagi.</p><button type="button" className="secondary-button" onClick={retry}>Coba lagi</button></div> : state !== 'ready' ? <form onSubmit={handleSubmit(submit)} noValidate>
      <label>Email<input type="email" autoComplete="username" {...register('email')} aria-invalid={!!errors.email} /></label>{errors.email ? <small role="alert">{errors.email.message}</small> : null}
      <label>Kata sandi<input type="password" autoComplete="current-password" {...register('password')} aria-invalid={!!errors.password} /></label>{errors.password ? <small role="alert">{errors.password.message}</small> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}<button type="submit" className="primary-button" disabled={isSubmitting}>{isSubmitting ? 'Memeriksa…' : 'Masuk'}</button>
    </form> : <p role="status">Membuka dashboard…</p>}
  </div></div></main>;
}

export default function LoginPage() { return <AuthProvider><LoginForm /></AuthProvider>; }
