import {
  type CommercialAgreement,
  lineAmount,
  commercialUnit,
} from './commercial'
const escape = (value: unknown) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        char
      ]!,
  )
const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
export function commercialDocument(agreement: CommercialAgreement): string {
  const c = agreement.content
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(c.title)} — ${escape(c.business_name)}</title><style>body{font:15px/1.6 system-ui,sans-serif;color:#17212b;max-width:900px;margin:40px auto;padding:24px}h1{font-size:28px}h2{font-size:18px;margin-top:28px}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:10px;border-bottom:1px solid #ccc;vertical-align:top}small{color:#475569}p{white-space:pre-wrap;overflow-wrap:anywhere}.signature{border:1px solid #bbb;padding:20px;margin-top:30px}footer{font-size:11px;overflow-wrap:anywhere}@media print{body{margin:0;padding:0}tr,.signature{break-inside:avoid}}</style></head><body>
  <small>SASQUATCH CARPET CLEANING · (719) 249-8791</small><h1>${escape(c.title)}</h1><p>${escape(c.business_name)}<br>${escape(c.service_address)}</p>
  <p>Version ${agreement.version} · ${escape(agreement.status.toUpperCase())}<br>Effective: ${escape(c.effective_from || 'Not set')} through ${escape(c.effective_until || 'No fixed end date')}<br>Sasquatch representative: ${escape(c.provider_name || 'Not yet approved')}</p>
  <h2>Services and measurements</h2><p>Initial services, recurring services, and optional services are priced separately. Frequency and timing are specified per service; optional items are not automatically included.</p>
  ${c.lines.map((l) => `<h3>${escape(l.name)} · ${escape(l.phase)}</h3><p>${escape(l.area)}<br>${escape(l.quantity)} ${escape(commercialUnit(l.unit))} × ${money(l.unit_price)} = <strong>${money(lineAmount(l))}</strong><br>Method: ${escape(l.method)}<br>Frequency: ${escape(l.frequency)}<br>Service window: ${escape(l.service_window || 'By confirmed appointment')}</p>${l.area_segments?.length ? `<p>Measurements: ${l.area_segments.map((s) => `${escape(s.length)} × ${escape(s.width)}`).join('; ')}</p>` : ''}<p>${escape(l.notes)}</p>`).join('')}
  ${[
    ['Payment terms', c.payment_terms],
    ['Cancellation and rescheduling', c.cancellation_terms],
    ['Access and preparation', c.access_terms],
    ['Quality and inspection', c.quality_standards],
    ['Exclusions and scope changes', c.exclusions],
    ['Additional terms', c.additional_terms],
  ]
    .map(
      ([label, value]) =>
        `<h2>${label}</h2><p>${escape(value || 'Not specified — draft requires review')}</p>`,
    )
    .join('')}
  <div class="signature"><h2>Acceptance</h2>${agreement.signed_at ? `<p>Signed electronically by <strong>${escape(agreement.signed_name)}</strong><br>Title: ${escape(agreement.signed_title)}<br>Account: ${escape(agreement.signed_email)}<br>Signed at: ${escape(agreement.signed_at)}</p><p>${escape(agreement.signature_consent)}</p>` : '<p>Not signed. This copy does not record customer acceptance.</p>'}</div>
  <footer><p>Agreement ID: ${escape(agreement.id)}<br>Published at: ${escape(agreement.published_at || 'Draft')}<br>Content SHA-256: ${escape(agreement.content_hash || 'Not yet published')}</p></footer></body></html>`
}
