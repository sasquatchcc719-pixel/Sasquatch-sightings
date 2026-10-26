// Actual public-route invoice fixture round trip in isolated PostgreSQL. No network or .env.
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
const { PGlite } = await import(pathToFileURL(process.argv[2]).href)
const f = JSON.parse(await readFile(process.argv[3], 'utf8'))
assert.equal(f.invoice.discount_metadata.promo.code, 'NEXTDOOR35')
const db = new PGlite()
try {
  await db.exec(
    `create table ops_appointments(id uuid primary key,quoted_total numeric(12,2));create table ops_invoices(id uuid primary key,appointment_id uuid references ops_appointments(id),subtotal numeric(12,2),discount_amount numeric(12,2),percentage_discount_label text,percentage_discount_percent numeric,percentage_discount_scope text,percentage_discount_amount numeric(12,2),discount_metadata jsonb,total numeric(12,2),status text,sync_status text,check(total=subtotal-discount_amount-percentage_discount_amount));`,
  )
  await db.query('insert into ops_appointments values($1,$2)', [
    f.appointment.id,
    f.appointment.quoted_total,
  ])
  await db.query(
    'insert into ops_invoices select (json_populate_record(null::ops_invoices,$1::json)).*',
    [JSON.stringify(f.invoice)],
  )
  const row = (
    await db.query(
      'select i.total::numeric::text total,i.discount_amount::numeric::text discount,a.quoted_total::numeric::text quote,i.discount_metadata from ops_invoices i join ops_appointments a on a.id=i.appointment_id',
    )
  ).rows[0]
  assert.equal(Number(row.total), 265)
  assert.equal(Number(row.quote), 265)
  assert.equal(Number(row.discount), 35)
  assert.equal(row.discount_metadata.public_offer.minimum_service_cents, 30000)
  assert.equal(row.discount_metadata.public_offer.stacking, false)
  console.log(
    'PASS actual public booking route fixture persists matching $265 appointment/invoice, one $35 discount and NEXTDOOR35 provenance in isolated PostgreSQL',
  )
} finally {
  await db.close()
}
