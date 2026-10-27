const base = process.env.NEXT_PUBLIC_API_URL;

export async function request(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (!['GET', 'HEAD'].includes(method)) {
    const response = await fetch(`${base}/api/auth/csrf`, { credentials: 'include', cache: 'no-store' });
    if (!response.ok) throw new Error('Tidak dapat memulai permintaan. Coba lagi.');
    headers['X-CSRF-Token'] = (await response.json()).csrfToken;
  }
  let response;
  try {
    response = await fetch(`${base}${path}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'include', cache: 'no-store'
    });
  } catch {
    throw new Error('Tidak dapat terhubung ke server. Periksa koneksi dan coba lagi.');
  }
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(response.status === 401 && path === '/api/auth/login'
      ? 'Email atau kata sandi tidak sesuai.' : payload.error ?? 'Permintaan gagal.');
    error.status = response.status;
    throw error;
  }
  return payload;
}

export async function downloadReport(params) {
  let response;
  try { response = await fetch(`${base}/api/reports/export?${params}`, { credentials: 'include', cache: 'no-store' }); }
  catch { throw new Error('Tidak dapat mengunduh laporan. Periksa koneksi dan coba lagi.'); }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error ?? 'Laporan tidak dapat diekspor. Coba rentang tanggal yang lebih pendek.');
  }
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a'); anchor.href = url;
  anchor.download = `stockly-report-${params.get('from')}-${params.get('to')}.xlsx`;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
