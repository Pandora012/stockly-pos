'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LayoutDashboard, Users, LogOut, Boxes, FolderTree, Warehouse, ShoppingCart, ReceiptText, ChartNoAxesCombined, Truck, ClipboardList } from 'lucide-react';
import { useEffect, useState } from 'react';
import { AuthProvider, useAuth } from '../../components/auth-provider';
import { Access } from '../../components/access';

function Shell({ children }) {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  useEffect(() => {
    function onShortcut(event) {
      if (event.key !== 'F8' || event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
          pathname.startsWith('/transactions') || document.querySelector('dialog[open]')) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select, [contenteditable="true"]'))) return;
      event.preventDefault(); router.push('/transactions');
    }
    window.addEventListener('keydown', onShortcut);
    return () => window.removeEventListener('keydown', onShortcut);
  }, [pathname, router]);
  async function handleLogout() {
    setLogoutError('');
    try { await logout(); } catch { setLogoutError('Gagal keluar. Coba lagi.'); }
  }
  return <Access><div className="shell">
    <aside className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`}>
      <div className="brand">Stockly <span>POS</span></div>
      <nav aria-label="Navigasi utama">
        <Link href="/dashboard" onClick={() => setMenuOpen(false)} aria-current={pathname === '/dashboard' ? 'page' : undefined}><LayoutDashboard size={18} /> Ringkasan</Link>
        <Link href="/pos" onClick={() => setMenuOpen(false)} aria-current={pathname === '/pos' ? 'page' : undefined}><ShoppingCart size={18} /> Kasir</Link>
        <Link href="/transactions" onClick={() => setMenuOpen(false)} aria-current={pathname.startsWith('/transactions') ? 'page' : undefined}><ReceiptText size={18} /> Transaksi</Link>
        <Link href="/products" onClick={() => setMenuOpen(false)} aria-current={pathname === '/products' ? 'page' : undefined}><Boxes size={18} /> Produk</Link>
        {user?.role === 'ADMIN' ? <Link href="/reports" onClick={() => setMenuOpen(false)} aria-current={pathname === '/reports' ? 'page' : undefined}><ChartNoAxesCombined size={18} /> Laporan</Link> : null}
        {user?.role === 'ADMIN' ? <Link href="/categories" onClick={() => setMenuOpen(false)} aria-current={pathname === '/categories' ? 'page' : undefined}><FolderTree size={18} /> Kategori</Link> : null}
        {user?.role === 'ADMIN' ? <Link href="/inventory" onClick={() => setMenuOpen(false)} aria-current={pathname === '/inventory' ? 'page' : undefined}><Warehouse size={18} /> Inventaris</Link> : null}
        {user?.role === 'ADMIN' ? <Link href="/suppliers" onClick={() => setMenuOpen(false)} aria-current={pathname === '/suppliers' ? 'page' : undefined}><Truck size={18} /> Supplier</Link> : null}
        {user?.role === 'ADMIN' ? <Link href="/purchases" onClick={() => setMenuOpen(false)} aria-current={pathname.startsWith('/purchases') ? 'page' : undefined}><ClipboardList size={18} /> Pembelian</Link> : null}
        {user?.role === 'ADMIN' ? <Link href="/users" onClick={() => setMenuOpen(false)} aria-current={pathname === '/users' ? 'page' : undefined}><Users size={18} /> Pengguna</Link> : null}
      </nav>
      <div className="sidebar-bottom"><span>{user?.name}</span><small>{user?.role === 'ADMIN' ? 'Admin' : 'Kasir'}</small></div>
    </aside>
    <div className="shell-main"><header className="topbar">
      <button className="mobile-menu" type="button" onClick={() => setMenuOpen(!menuOpen)} aria-expanded={menuOpen} aria-label="Buka atau tutup navigasi">Menu</button>
      <span>Operasional toko</span>
      <button type="button" className="text-button" onClick={handleLogout}><LogOut size={17} /> Keluar</button>
    </header>{logoutError ? <p className="banner-error" role="alert">{logoutError}</p> : null}<main className="content">{children}</main></div>
  </div></Access>;
}

export default function ProtectedLayout({ children }) {
  return <AuthProvider><Shell>{children}</Shell></AuthProvider>;
}
