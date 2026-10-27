'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { request } from '../lib/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [state, setState] = useState('loading');
  const router = useRouter();

  useEffect(() => {
    let active = true;
    request('/api/auth/me').then(({ user: current }) => {
      if (active) { setUser(current); setState('ready'); }
    }).catch((error) => {
      if (active) setState(error.status === 401 ? 'guest' : 'error');
    });
    return () => { active = false; };
  }, []);

  async function login(input) {
    const data = await request('/api/auth/login', { method: 'POST', body: input });
    setUser(data.user);
    setState('ready');
  }
  async function logout() {
    await request('/api/auth/logout', { method: 'POST' });
    setUser(null);
    setState('guest');
    router.replace('/login');
  }
  async function retry() {
    setState('loading');
    try { const data = await request('/api/auth/me'); setUser(data.user); setState('ready'); }
    catch (error) { setState(error.status === 401 ? 'guest' : 'error'); }
  }
  return <AuthContext.Provider value={{ user, state, login, logout, retry }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('AuthProvider is missing');
  return context;
}
