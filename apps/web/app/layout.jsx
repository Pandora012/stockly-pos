import './globals.css';

export const metadata = { title: 'Stockly POS', description: 'Operasional toko dan kasir' };

export default function RootLayout({ children }) {
  return <html lang="id"><body>{children}</body></html>;
}
