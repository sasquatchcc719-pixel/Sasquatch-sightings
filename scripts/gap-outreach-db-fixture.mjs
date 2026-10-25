import { readFile } from 'node:fs/promises'
export async function setupSyntheticGapDatabase(db) {
  const fixture = await readFile(
    new URL(
      '../supabase/tests/mcp_operation_controls_fixture.sql',
      import.meta.url,
    ),
    'utf8',
  )
  await db.exec(
    fixture
      .split('-- APPLY_MCP_OPERATION_CONTROLS_MIGRATION_HERE')[0]
      .replace(/^\\.*$/gm, '')
      .replace('create extension if not exists pgcrypto;', ''),
  )
  await db.exec(
    await readFile(
      new URL(
        '../supabase/migrations/20261013023000_add_mcp_operation_controls.sql',
        import.meta.url,
      ),
      'utf8',
    ),
  )
  await db.exec(
    'alter table ops_appointment_line_items add column created_at timestamptz default now()',
  )
  // Production metadata confirms this newer conversion body (line-order preservation).
  await db.exec(
    await readFile(
      new URL(
        '../supabase/migrations/20261018154345_add_line_item_sort_order.sql',
        import.meta.url,
      ),
      'utf8',
    ),
  )
  await db.exec(`alter table conversations add column phone_number text,add column messages jsonb default '[]';
alter table ops_appointments add column parked_at timestamptz;
alter table service_catalog_items add column name text default 'Carpet',add column category text default 'Carpet Cleaning',add column slug text default 'carpet';
alter table ops_invoice_line_items add column service_catalog_item_id uuid;
alter table ops_invoices add column discount_metadata jsonb,add column percentage_discount_amount numeric default 0;
create table sms_marketing_consents(customer_id uuid,phone_normalized text,status text,consented_at timestamptz,disclosure text);
create table tomorrow_fill_settings(id boolean,customer_cooldown_days integer);
insert into tomorrow_fill_settings values(true,14);
create table sms_logs(id uuid default gen_random_uuid(),recipient_phone text,status text,created_at timestamptz default now());
create table reactivation_email_log(id uuid default gen_random_uuid(),customer_id uuid,event_type text,status text,sent_at timestamptz default now());`)
  await db.exec(
    await readFile(
      new URL(
        '../supabase/migrations/20261025210428_add_owner_approved_gap_outreach.sql',
        import.meta.url,
      ),
      'utf8',
    ),
  )
  console.log(
    'PASS: proposed migration compiles with actual existing MCP atomic transactions',
  )

  const owner = '10000000-0000-4000-8000-000000000001',
    staff = '20000000-0000-4000-8000-000000000001',
    customer = '30000000-0000-4000-8000-000000000001',
    address = '40000000-0000-4000-8000-000000000001',
    catalog = '50000000-0000-4000-8000-000000000001'
  await db.exec(
    `insert into auth.users values('${owner}'); insert into staff_users(id,user_id,display_name,role) values('${staff}','${owner}','Test owner','owner'); insert into mcp_authorized_users values('${owner}',array['business:read','outreach:write','customer:contact','business:write','finance:write','estimates:write'],null); insert into ops_customers(id,full_name,email,phone) values('${customer}','Fixture Customer','fixture@example.test','+17195550100'); insert into ops_service_addresses(id,customer_id,street_1,city,state,zip_code) values('${address}','${customer}','123 Fixture St','Monument','CO','80132'); insert into service_catalog_items(id,base_price) values('${catalog}',300); insert into sms_marketing_consents values('${customer}','+17195550100','opted_in',now()-interval '1 year','Explicit test consent');`,
  )
  const date = (await db.query('select (current_date+2)::text d')).rows[0].d
  return { owner, staff, customer, address, catalog, date }
}
