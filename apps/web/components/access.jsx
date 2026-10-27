'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from './auth-provider';

export function Access({ children, admin = false }) {
  const { user, state, retry } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (state === 'guest') router.replace('/login');
    if (state === 'ready' && admin && user?.role !== 'ADMIN') router.replace('/unauthorized');
  }, [state, admin, user?.role, router]);
  if (state === 'loading' || state === 'guest') return <div className="notice" role="status">Memeriksa sesi…</div>;
  if (state === 'error') return <div className="notice" role="alert"><p>Tidak dapat memeriksa sesi. Periksa koneksi.</p><button type="button" className="secondary-button" onClick={retry}>Coba lagi</button></div>;
  if (admin && user?.role !== 'ADMIN') return <div className="notice" role="status">Memeriksa izin…</div>;
  return children;
}
