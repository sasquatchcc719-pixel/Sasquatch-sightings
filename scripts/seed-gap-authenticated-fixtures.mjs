import { readFile } from 'node:fs/promises'
/** Synthetic-only records and supporting tables. No production schema or records. */
export async function seedAuthenticatedFixtures(db, ids) {
  await db.query(`create table public.revenue_entries(id uuid default gen_random_uuid(),ops_invoice_id uuid,invoice_amount numeric);
 create table public.jobs(id uuid default gen_random_uuid(),ops_invoice_id uuid,invoice_amount numeric);
 create table public.ops_timesheet_entries(id uuid default gen_random_uuid(),staff_user_id uuid,work_date date,started_at timestamptz,ended_at timestamptz,break_minutes integer,payable_minutes integer,hourly_rate numeric,gross_pay numeric,work_type text,status text,source text,clock_state text,break_started_at timestamptz,notes text);
 create table public.ops_quickbooks_sync_jobs(id uuid default gen_random_uuid(),entity_type text,entity_id uuid,status text,payload jsonb,error_message text,sync_attempts integer,next_retry_at timestamptz,alerted_at timestamptz,created_at timestamptz default now(),updated_at timestamptz default now());
 create table public.api_v1_rate_limits(key_label text primary key,tokens double precision not null default 100,updated_at timestamptz not null default clock_timestamp());
 grant all on public.revenue_entries,public.jobs,public.ops_timesheet_entries,public.ops_quickbooks_sync_jobs,public.api_v1_rate_limits to service_role;
 insert into public.promo_codes(id,code,discount_type,discount_amount,active,use_count) values('b0000000-0000-4000-8000-000000000001','TF35','fixed',35,true,0);
 update public.staff_users set add_on_bonus_rate=0,invoice_growth_bonus_starts_on='2099-01-01';`)
  const security = await readFile(
    new URL(
      '../supabase/migrations/20261005163746_add_merlin_read_api_security.sql',
      import.meta.url,
    ),
    'utf8',
  )
  await db.query(
    security.slice(
      security.indexOf(
        'create or replace function public.consume_api_v1_token',
      ),
      security.indexOf('revoke all on function public.consume_api_v1_token'),
    ),
  )
  await db.query(
    'grant execute on function public.consume_api_v1_token(text) to service_role',
  )
  const rug = '50000000-0000-4000-8000-000000000002'
  await db.query(
    "update public.service_catalog_items set name='Carpet cleaning',category='Carpet Cleaning',pricing_unit='fixed',slug='carpet',sort_order=0 where id=$1",
    [ids.catalog],
  )
  await db.query(
    "insert into public.service_catalog_items(id,base_price,is_active,name,category,pricing_unit,slug,sort_order) values($1,300,true,'Fixture rugs','Rug Cleaning','fixed','rug',1)",
    [rug],
  )
  const jobs = []
  for (let i = 1; i <= 3; i++) {
    const job = `60000000-0000-4000-8000-00000000000${i}`,
      invoice = `70000000-0000-4000-8000-00000000000${i}`,
      line = `80000000-0000-4000-8000-00000000000${i}`,
      invline = `90000000-0000-4000-8000-00000000000${i}`
    const quantity = i === 2 ? 2 : 1,
      unit = i === 3 ? 175 : 300,
      total = quantity * unit,
      discount = i === 3 ? 0 : 35,
      catalog = i === 2 ? rug : ids.catalog,
      name = i === 2 ? 'Fixture rugs' : 'Carpet cleaning'
    await db.query(
      "insert into public.ops_appointments(id,customer_id,service_address_id,assigned_staff_user_id,appointment_date,start_time,end_time,status,payment_status,kind,quoted_total) values($1,$2,$3,'20000000-0000-4000-8000-000000000002',$4,'10:00','12:00','booked','unpaid','service',$5)",
      [job, ids.customer, ids.address, ids.date, total - discount],
    )
    await db.query(
      'insert into public.ops_appointment_line_items(id,appointment_id,service_catalog_item_id,name_snapshot,quantity,unit_price,line_total,duration_minutes,buffer_minutes,sort_order) values($1,$2,$3,$4,$5,$6,$7,120,0,0)',
      [line, job, catalog, name, quantity, unit, total],
    )
    await db.query(
      "insert into public.ops_invoices(id,appointment_id,status,payment_status,subtotal,discount_amount,total,sync_status,discount_metadata,percentage_discount_amount,minimum_charge_adjustment,tax_amount,invoice_number) values($1,$2,'draft','unpaid',$3,$4,$5,'held',$6,0,0,0,$7)",
      [
        invoice,
        job,
        total,
        discount,
        total - discount,
        discount
          ? {
              promo: { code: 'TF35', amount: 35 },
              gap_offer: {
                id: 'a0000000-0000-4000-8000-000000000001',
                minimum_service_cents: 30000,
              },
            }
          : {},
        i,
      ],
    )
    await db.query(
      'insert into public.ops_invoice_line_items(id,invoice_id,appointment_line_item_id,service_catalog_item_id,description,quantity,unit_price,line_total,sort_order) values($1,$2,$3,$4,$5,$6,$7,$8,0)',
      [invline, invoice, line, catalog, name, quantity, unit, total],
    )
    if (i === 2)
      for (let u = 1; u <= 2; u++)
        await db.query(
          "insert into public.fiber_checks(appointment_id,appointment_line_item_id,unit_index,item_label,verdict,determined_by,fiber,confidence,warnings,photo_urls,checked_by_label,created_at) values($1,$2,$3,'Synthetic rug','do_not_wet_clean','stop_list','Viscose','high',array['Synthetic fixture verdict'],array[]::text[],'Synthetic tech',now())",
          [job, line, u],
        )
    jobs.push({ job, invoice, line, invline })
  }
  await db.query("notify pgrst,'reload schema'")
  return jobs
}
