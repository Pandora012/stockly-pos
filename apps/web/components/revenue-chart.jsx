'use client';

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatIDR } from './catalog-ui';

export default function RevenueChart({ data }) {
  if (!data.some((item) => item.transactionCount > 0)) return <p>Belum ada penjualan pada periode ini.</p>;
  return <figure className="revenue-figure"><figcaption className="sr-only">Penjualan neto tanpa pajak per periode, dalam rupiah.</figcaption>
    <div className="revenue-chart"><ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 600, height: 260 }}>
      <BarChart data={data} accessibilityLayer margin={{ left: 12, right: 12, top: 12, bottom: 12 }}>
        <CartesianGrid vertical={false} stroke="#D4DAD3" /><XAxis dataKey="period" tick={{ fontSize: 11 }} tickFormatter={(value) => value.length === 7 ? value : value.slice(5)} />
        <YAxis tick={{ fontSize: 11 }} width={75} tickFormatter={(value) => new Intl.NumberFormat('id-ID', { notation: 'compact' }).format(value)} />
        <Tooltip formatter={(value) => [formatIDR(Number(value)), 'Penjualan neto']} labelFormatter={(label) => `Periode ${label}`} cursor={{ fill: '#E8ECE6' }} />
        <Bar dataKey="netSales" fill="#2F664F" maxBarSize={42} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer></div>
    <div className="sr-only"><table><caption>Data grafik</caption><thead><tr><th>Periode</th><th>Penjualan neto</th></tr></thead><tbody>{data.map((item) => <tr key={item.period}><td>{item.period}</td><td>{formatIDR(item.netSales)}</td></tr>)}</tbody></table></div>
  </figure>;
}
