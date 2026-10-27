'use client';

import dynamic from 'next/dynamic';
import { formatIDR } from './catalog-ui';

export const RevenueChart = dynamic(() => import('./revenue-chart'), { ssr: false,
  loading: () => <p role="status">Memuat grafik…</p> });

export function MetricStrip({ metrics }) {
  return <dl className="metric-strip">{metrics.map(([label, value, money = false]) => <div key={label}><dt>{label}</dt><dd>{money ? formatIDR(value) : new Intl.NumberFormat('id-ID').format(value)}</dd></div>)}</dl>;
}

export function ProductRanking({ items, detailed = false }) {
  if (!items.length) return <p>Belum ada produk terjual pada periode ini.</p>;
  return <div className="table-scroll"><table><thead><tr><th>Produk / SKU</th><th className="numeric">Unit terjual</th><th className="numeric">Penjualan neto</th>{detailed ? <><th className="numeric">Biaya barang historis</th><th className="numeric">Est. laba kotor</th></> : null}</tr></thead><tbody>{items.map((item) => <tr key={item.id}><td className="report-product-name"><strong>{item.name}</strong><span className="subline">{item.sku}</span></td><td className="numeric">{item.unitsSold}</td><td className="numeric">{formatIDR(item.netSales)}</td>{detailed ? <><td className="numeric">{formatIDR(item.costOfGoods)}</td><td className="numeric">{formatIDR(item.grossProfit)}</td></> : null}</tr>)}</tbody></table></div>;
}
