import Link from 'next/link';

export default function Unauthorized() {
  return <main className="message-page"><h1>Akses dibatasi</h1><p>Akun Anda tidak memiliki izin untuk membuka halaman ini.</p><Link href="/dashboard" className="primary-button">Kembali ke ringkasan</Link></main>;
}
