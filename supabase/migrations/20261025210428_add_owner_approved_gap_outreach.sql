-- Proposal only. No owner-scope grants, activation, consent backfill, coupon seed, or existing campaign changes.
create table public.gap_outreach_batches (
  id uuid primary key default gen_random_uuid(), actor_user_id uuid not null references auth.users(id),
  idempotency_key text not null check(length(idempotency_key) between 8 and 200),
  payload jsonb not null, payload_hash text not null, gap_date date not null,
  staff_id uuid not null references public.staff_users(id), start_time time not null, end_time time not null,
  status text not null default 'pending' check(status in('pending','approved','stopped','complete')),
  created_at timestamptz not null default now(), expires_at timestamptz not null, approved_at timestamptz, stop_reason text,
  unique(actor_user_id,idempotency_key), check(end_time>start_time)
);
create table public.gap_outreach_recipients (
  id uuid primary key, batch_id uuid not null references public.gap_outreach_batches(id),
  customer_id uuid not null references public.ops_customers(id), phone text not null, body text not null,
  status text not null default 'pending' check(status in('pending','sending','accepted','delivered','failed','unknown','suppressed','replied','booked')),
  provider_sid text unique, provider_status text, attempted_at timestamptz, sent_at timestamptz,
  stop_reason text, appointment_id uuid unique references public.ops_appointments(id),
  unique(batch_id,customer_id)
);
create unique index gap_outreach_one_pending_phone on public.gap_outreach_recipients(phone) where status in('pending','sending','unknown');
create table public.gap_outreach_contacts (
  phone text not null, source text not null, source_id text not null, contacted_at timestamptz not null,
  primary key(source,source_id,phone)
);
alter table public.gap_outreach_batches enable row level security;
alter table public.gap_outreach_recipients enable row level security;
alter table public.gap_outreach_contacts enable row level security;
revoke all on public.gap_outreach_batches,public.gap_outreach_recipients,public.gap_outreach_contacts from public,anon,authenticated;
grant select,insert,update on public.gap_outreach_batches,public.gap_outreach_recipients,public.gap_outreach_contacts to service_role;

create function public.gap_outreach_phone(p_phone text) returns text language sql immutable set search_path=public,pg_temp as $$
 select '+1'||right(regexp_replace(coalesce(p_phone,''),'[^0-9]','','g'),10)
$$;
create function public.gap_outreach_owner(p_actor uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not exists(select 1 from public.staff_users s join public.mcp_authorized_users a on a.user_id=s.user_id where s.user_id=p_actor and s.role='owner' and s.is_active and a.revoked_at is null and a.scopes @> array['business:read','outreach:write']) then raise exception 'Owner outreach grant required'; end if;
end $$;
create function public.stop_gap_outreach(p_batch uuid,p_actor uuid,p_reason text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform public.gap_outreach_owner(p_actor);
 update public.gap_outreach_batches set status='stopped',stop_reason=p_reason where id=p_batch and actor_user_id=p_actor;
 if not found then raise exception 'Batch owner mismatch'; end if;
 update public.gap_outreach_recipients set status='suppressed',stop_reason=p_reason where batch_id=p_batch and status='pending';
 return jsonb_build_object('stopped',true,'reason',p_reason);
end $$;
create function public.preview_gap_outreach(p_actor uuid,p_key text,p_payload jsonb,p_hash text,p_expires timestamptz) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare b public.gap_outreach_batches; r jsonb;
begin
 perform public.gap_outreach_owner(p_actor);
 if jsonb_array_length(p_payload->'recipients') not between 1 and 5 or p_expires<=now() or p_expires>now()+interval '11 minutes' then raise exception 'Invalid bounded approval'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_actor::text||p_key,0));
 update public.gap_outreach_recipients r set status='suppressed',stop_reason='approval_expired' from public.gap_outreach_batches old_batch where old_batch.id=r.batch_id and old_batch.expires_at<=now() and r.status='pending';
 select * into b from public.gap_outreach_batches where actor_user_id=p_actor and idempotency_key=p_key for update;
 if found then
   if b.payload_hash<>p_hash then raise exception 'Idempotency key reused with changed preview'; end if;
   return jsonb_build_object('confirmation_id',b.id,'expires_at',b.expires_at,'preview',b.payload,'status',b.status);
 end if;
 insert into public.gap_outreach_batches(actor_user_id,idempotency_key,payload,payload_hash,gap_date,staff_id,start_time,end_time,expires_at)
 values(p_actor,p_key,p_payload,p_hash,(p_payload->'gap'->>'date')::date,(p_payload->'gap'->>'staff_id')::uuid,(p_payload->'gap'->>'start_time')::time,(p_payload->'gap'->>'end_time')::time,p_expires) returning * into b;
 for r in select * from jsonb_array_elements(p_payload->'recipients') loop
   insert into public.gap_outreach_recipients(id,batch_id,customer_id,phone,body) values((r->>'id')::uuid,b.id,(r->>'customer_id')::uuid,r->>'phone',r->>'body');
 end loop;
 return jsonb_build_object('confirmation_id',b.id,'expires_at',b.expires_at,'preview',b.payload,'status',b.status);
end $$;
create function public.approve_gap_outreach(p_batch uuid,p_actor uuid,p_hash text) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform public.gap_outreach_owner(p_actor);
 if not exists(select 1 from public.mcp_authorized_users where user_id=p_actor and revoked_at is null and 'customer:contact'=any(scopes)) then raise exception 'Customer contact grant required'; end if;
 update public.gap_outreach_batches set status='approved',approved_at=now() where id=p_batch and actor_user_id=p_actor and status='pending' and expires_at>now() and payload_hash=p_hash;
 return found;
end $$;
create function public.check_gap_outreach_send(p_recipient uuid,p_actor uuid) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.gap_outreach_recipients; b public.gap_outreach_batches; reason text; cooldown integer;
begin
 perform public.gap_outreach_owner(p_actor);
 select * into r from public.gap_outreach_recipients where id=p_recipient;
 if not found then return false; end if;
 select * into b from public.gap_outreach_batches where id=r.batch_id;
 if b.actor_user_id<>p_actor then raise exception 'Batch owner mismatch'; end if;
 select customer_cooldown_days into cooldown from public.tomorrow_fill_settings where id=true;
 if not exists(select 1 from public.mcp_authorized_users where user_id=p_actor and revoked_at is null and 'customer:contact'=any(scopes)) then reason:='contact_grant_revoked';
 elsif b.status<>'approved' or b.expires_at<=now() or b.gap_date<=(now() at time zone 'America/Denver')::date then reason:='stopped_or_expired';
 elsif r.status not in('pending','sending') then return false;
 elsif not exists(select 1 from public.sms_marketing_consents s where s.customer_id=r.customer_id and s.status='opted_in' and s.consented_at is not null and nullif(s.disclosure,'') is not null) then reason:='consent_unverified';
 elsif exists(select 1 from public.sms_marketing_consents s where public.gap_outreach_phone(s.phone_normalized)=r.phone and s.status='opted_out') then reason:='opted_out';
 elsif exists(select 1 from public.blacklist bl where public.gap_outreach_phone(bl.phone)=r.phone) then reason:='blacklisted';
 elsif exists(select 1 from public.ops_appointments a where (a.customer_id=r.customer_id or exists(select 1 from public.ops_customers c where c.id=a.customer_id and public.gap_outreach_phone(c.phone)=r.phone)) and (a.parked_at is not null or (a.status in('booked','confirmed','on_my_way','in_progress','pending_approval') and a.kind='service'))) then reason:='existing_job';
 elsif exists(select 1 from public.gap_outreach_contacts c where c.phone=r.phone and c.contacted_at>now()-make_interval(days=>coalesce(cooldown,365))) then reason:='recent_contact_or_takeover';
 elsif exists(select 1 from public.ops_appointments a where a.appointment_date=b.gap_date and not coalesce(a.is_subcontracted,false) and a.status in('booked','confirmed','on_my_way','in_progress','completed','pending_approval') and (a.assigned_staff_user_id is null or a.assigned_staff_user_id=b.staff_id) and a.start_time<b.end_time and a.end_time>b.start_time) then reason:='gap_filled';
 elsif exists(select 1 from public.ops_calendar_events e where coalesce(e.event_kind,'block')='block' and e.start_date<=b.gap_date and e.end_date>=b.gap_date and (e.assigned_staff_user_id is null or e.assigned_staff_user_id=b.staff_id or e.assigned_staff_user_id=(select user_id from public.staff_users where id=b.staff_id)) and (e.is_all_day or ((case when e.start_date<b.gap_date then time '00:00' else e.start_time end)<b.end_time and (case when e.end_date>b.gap_date then time '23:59:59' else e.end_time end)>b.start_time))) then reason:='calendar_block';
 end if;
 if reason is not null then
   update public.gap_outreach_recipients set status='suppressed',stop_reason=reason where id=r.id and status in('pending','sending');
   perform public.stop_gap_outreach(b.id,p_actor,reason);
   return false;
 end if;
 return true;
end $$;
create function public.claim_gap_outreach_recipient(p_recipient uuid,p_actor uuid) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.gap_outreach_recipients;
begin
 select * into r from public.gap_outreach_recipients where id=p_recipient for update;
 if not found or r.status<>'pending' then return false; end if;
 perform pg_advisory_xact_lock(hashtextextended(r.phone,0));
 if not public.check_gap_outreach_send(p_recipient,p_actor) then return false; end if;
 update public.gap_outreach_recipients set status='sending',attempted_at=now() where id=p_recipient and status='pending';
 return found;
end $$;
create function public.finish_gap_outreach_recipient(p_recipient uuid,p_actor uuid,p_sid text,p_status text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform public.gap_outreach_owner(p_actor);
 if nullif(p_sid,'') is null or p_status<>'accepted' then raise exception 'Provider acceptance evidence required'; end if;
 update public.gap_outreach_recipients r set status='accepted',provider_sid=p_sid,provider_status=p_status,sent_at=now() from public.gap_outreach_batches b where r.id=p_recipient and b.id=r.batch_id and b.actor_user_id=p_actor and r.status='sending';
 if not found and not exists(select 1 from public.gap_outreach_recipients r join public.gap_outreach_batches b on b.id=r.batch_id where r.id=p_recipient and b.actor_user_id=p_actor and r.provider_sid=p_sid and r.status in('accepted','delivered','replied','booked')) then raise exception 'Send state uncertain; reconcile provider SID before retry'; end if;
 insert into public.gap_outreach_contacts(phone,source,source_id,contacted_at) select r.phone,'gap_outreach',p_sid,coalesce(r.attempted_at,now()) from public.gap_outreach_recipients r join public.gap_outreach_batches b on b.id=r.batch_id where r.id=p_recipient and b.actor_user_id=p_actor on conflict(source,source_id,phone) do nothing;
 update public.gap_outreach_batches b set status='complete' where b.id=(select batch_id from public.gap_outreach_recipients where id=p_recipient) and b.status='approved' and not exists(select 1 from public.gap_outreach_recipients r where r.batch_id=b.id and r.status in('pending','sending','unknown'));
end $$;
create function public.mark_gap_outreach_uncertain(p_batch uuid,p_actor uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform public.gap_outreach_owner(p_actor);
 update public.gap_outreach_recipients r set status='unknown',stop_reason='provider_or_persistence_uncertain' from public.gap_outreach_batches b where b.id=r.batch_id and b.id=p_batch and b.actor_user_id=p_actor and r.status='sending';
 perform public.stop_gap_outreach(p_batch,p_actor,'verification_required');
end $$;

-- Any new contact is a takeover/suppression signal for pending invitations. Existing channels
-- keep their behavior; these triggers only invalidate this new workflow's pending work.
create function public.record_gap_outreach_contact() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare j jsonb:=to_jsonb(new); p text; t timestamptz; sid text;
begin
 if tg_table_name='sms_logs' then
   if j->>'status'='failed' then return new; end if;
   p:=public.gap_outreach_phone(j->>'recipient_phone');t:=coalesce((j->>'sent_at')::timestamptz,(j->>'created_at')::timestamptz,now());
 elsif tg_table_name='reactivation_email_log' then
   if j->>'event_type'<>'email' or j->>'status'<>'sent' then return new; end if;
   select public.gap_outreach_phone(phone) into p from public.ops_customers where id=(j->>'customer_id')::uuid;t:=(j->>'sent_at')::timestamptz;
 else
   if tg_op='UPDATE' and new.messages is not distinct from old.messages then return new; end if;
   p:=public.gap_outreach_phone(j->>'phone_number');t:=now();
 end if;
 if length(p)<>12 then return new; end if;
 sid:=coalesce(j->>'id',j->>'twilio_sid',md5(j::text));
 insert into public.gap_outreach_contacts values(p,tg_table_name,sid,coalesce(t,now())) on conflict(source,source_id,phone) do update set contacted_at=excluded.contacted_at;
 update public.gap_outreach_recipients set status='suppressed',stop_reason='new_contact_reply_or_owner_takeover' where phone=p and status='pending';
 if tg_table_name='conversations' and j->'messages'->-1->>'role'='user' then update public.gap_outreach_recipients set status='replied' where phone=p and status in('accepted','delivered'); end if;
 return new;
end $$;
create trigger gap_outreach_sms_contact after insert or update on public.sms_logs for each row execute function public.record_gap_outreach_contact();
create trigger gap_outreach_email_contact after insert or update on public.reactivation_email_log for each row execute function public.record_gap_outreach_contact();
create trigger gap_outreach_conversation_contact after insert or update on public.conversations for each row execute function public.record_gap_outreach_contact();

create function public.stop_gap_outreach_on_booking() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.status in('booked','confirmed','on_my_way','in_progress','completed','pending_approval') and not coalesce(new.is_subcontracted,false) then
   update public.gap_outreach_recipients r set status='suppressed',stop_reason='gap_filled_or_customer_booked' from public.gap_outreach_batches b
   where r.batch_id=b.id and r.status='pending' and (r.customer_id=new.customer_id or exists(select 1 from public.ops_customers c where c.id=new.customer_id and public.gap_outreach_phone(c.phone)=r.phone) or (b.gap_date=new.appointment_date and (new.assigned_staff_user_id is null or b.staff_id=new.assigned_staff_user_id) and new.start_time<b.end_time and new.end_time>b.start_time));
 end if;
 return new;
end $$;
create trigger gap_outreach_booking_stop after insert or update on public.ops_appointments for each row execute function public.stop_gap_outreach_on_booking();

-- Keep these new RPCs server-only. No user scope is granted by this migration.
do $$ declare f record; begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('gap_outreach_phone','gap_outreach_owner','stop_gap_outreach','preview_gap_outreach','approve_gap_outreach','check_gap_outreach_send','claim_gap_outreach_recipient','finish_gap_outreach_recipient','mark_gap_outreach_uncertain','record_gap_outreach_contact','stop_gap_outreach_on_booking') loop
   execute format('revoke all on function %s from public,anon,authenticated',f.signature);
   execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;

-- Redeem one approved invitation inside the SAME transaction as the existing atomic booking.
-- New offers are at least $300 service only. Legacy TF35 token snapshots are untouched.
create function public.mcp_create_gap_appointment(p_plan jsonb,p_actor_user_id uuid,p_offer uuid,p_allow_alternate boolean default false) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.gap_outreach_recipients; b public.gap_outreach_batches; service_total numeric; gross numeric; result jsonb; metadata jsonb;
begin
 select * into r from public.gap_outreach_recipients where id=p_offer for update;
 if not found or r.appointment_id is not null or r.status not in('accepted','delivered','replied') then raise exception 'Approved unredeemed gap offer required'; end if;
 select * into b from public.gap_outreach_batches where id=r.batch_id;
 if (p_plan->>'appointment_date')::date < (now() at time zone 'America/Denver')::date then raise exception 'Choose a current or future date'; end if;
 if b.actor_user_id<>p_actor_user_id or public.gap_outreach_phone(p_plan->'customer'->>'phone')<>r.phone then raise exception 'Offer recipient/owner mismatch'; end if;
 if not p_allow_alternate and ((p_plan->>'appointment_date')::date<>b.gap_date or (p_plan->>'start_time')::time<b.start_time or (p_plan->>'end_time')::time>b.end_time) then raise exception 'Owner decision needed on discount for alternate time'; end if;
 if exists(select 1 from jsonb_array_elements(p_plan->'line_items') l where (l->>'line_total')::numeric<0 or (l->>'quantity')::numeric<=0) then raise exception 'TF35 cannot stack with negative lines or credits'; end if;
 select sum((l->>'line_total')::numeric) filter(where nullif(l->>'service_catalog_item_id','') is not null and coalesce(l->>'name_snapshot','') !~* '^(mileage[ /-]*travel|travel fee|tax|fees?|google lsa.*)$'),sum((l->>'line_total')::numeric) into service_total,gross from jsonb_array_elements(p_plan->'line_items') l;
 if round(service_total*100)<(b.payload->'offer'->>'minimum_service_cents')::integer then raise exception 'Service subtotal does not qualify for TF35'; end if;
 if extract(epoch from((p_plan->>'end_time')::time-(p_plan->>'start_time')::time))/60 < (case when service_total<=300 then 120 when service_total<=600 then 180 else 240 end) then raise exception 'Complete job duration does not fit'; end if;
 if (p_plan->>'discount_applied')::numeric<>35 or (p_plan->>'subtotal')::numeric<>gross or (p_plan->>'total')::numeric<>gross-35 then raise exception 'Offer quote changed or another discount stacked'; end if;
 result:=public.mcp_create_appointment(p_plan,p_actor_user_id);
 if (result->>'customer_id')::uuid<>r.customer_id then raise exception 'Resolved customer differs from approved offer'; end if;
 metadata:=jsonb_build_object('promo',jsonb_build_object('code','TF35','amount',35),'gap_offer',jsonb_build_object('id',r.id,'minimum_service_cents',(b.payload->'offer'->>'minimum_service_cents')::integer,'service_subtotal',service_total,'stacking',false,'alternate_approved',p_allow_alternate));
 update public.ops_invoices set discount_metadata=metadata where id=(result->>'invoice_id')::uuid;
 update public.gap_outreach_recipients set appointment_id=(result->>'appointment_id')::uuid,status='booked' where id=r.id;
 return result||jsonb_build_object('discount_metadata',metadata);
end $$;
revoke all on function public.mcp_create_gap_appointment(jsonb,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.mcp_create_gap_appointment(jsonb,uuid,uuid,boolean) to service_role;

create function public.mcp_convert_gap_estimate(
 p_estimate_id uuid,p_expected_updated_at timestamptz,p_expected_status text,p_appointment_date date,
 p_start_time time,p_end_time time,p_assigned_staff_user_id uuid,p_discount_amount numeric,
 p_actor_user_id uuid,p_sync_status text,p_allow_conflict boolean,p_offer uuid,p_allow_alternate boolean
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.gap_outreach_recipients; b public.gap_outreach_batches; estimate_customer uuid; service_total numeric; result jsonb; metadata jsonb;
begin
 select * into r from public.gap_outreach_recipients where id=p_offer for update;
 if not found or r.appointment_id is not null or r.status not in('accepted','delivered','replied') then raise exception 'Approved unredeemed gap offer required'; end if;
 select * into b from public.gap_outreach_batches where id=r.batch_id;
 select customer_id into estimate_customer from public.ops_appointments where id=p_estimate_id and kind='estimate';
 if p_appointment_date < (now() at time zone 'America/Denver')::date then raise exception 'Choose a current or future date'; end if;
 if estimate_customer<>r.customer_id or b.actor_user_id<>p_actor_user_id then raise exception 'Offer recipient/owner mismatch'; end if;
 if p_allow_conflict or p_discount_amount<>35 then raise exception 'No conflict override or stacked discount allowed'; end if;
 if not p_allow_alternate and (p_appointment_date<>b.gap_date or p_start_time<b.start_time or p_end_time>b.end_time) then raise exception 'Owner decision needed on discount for alternate time'; end if;
 if exists(select 1 from public.ops_appointment_line_items where appointment_id=p_estimate_id and line_total<0) then raise exception 'TF35 cannot stack with a negative line'; end if;
 select sum(line_total) into service_total from public.ops_appointment_line_items where appointment_id=p_estimate_id and service_catalog_item_id is not null and name_snapshot !~* '^(mileage[ /-]*travel|travel fee|tax|fees?|google lsa.*)$';
 if service_total is null or round(service_total*100)<(b.payload->'offer'->>'minimum_service_cents')::integer then raise exception 'Service subtotal does not qualify for TF35'; end if;
 if extract(epoch from(p_end_time-p_start_time))/60 < (case when service_total<=300 then 120 when service_total<=600 then 180 else 240 end) then raise exception 'Complete job duration does not fit'; end if;
 result:=public.mcp_convert_estimate(p_estimate_id,p_expected_updated_at,p_expected_status,p_appointment_date,p_start_time,p_end_time,p_assigned_staff_user_id,35,p_actor_user_id,p_sync_status,false);
 metadata:=jsonb_build_object('promo',jsonb_build_object('code','TF35','amount',35),'gap_offer',jsonb_build_object('id',r.id,'minimum_service_cents',(b.payload->'offer'->>'minimum_service_cents')::integer,'service_subtotal',service_total,'stacking',false,'alternate_approved',p_allow_alternate));
 update public.ops_invoices set discount_metadata=metadata where id=(result->>'invoice_id')::uuid;
 update public.gap_outreach_recipients set appointment_id=(result->>'appointment_id')::uuid,status='booked' where id=r.id;
 return result||jsonb_build_object('discount_metadata',metadata);
end $$;
revoke all on function public.mcp_convert_gap_estimate(uuid,timestamptz,text,date,time,time,uuid,numeric,uuid,text,boolean,uuid,boolean) from public,anon,authenticated;
grant execute on function public.mcp_convert_gap_estimate(uuid,timestamptz,text,date,time,time,uuid,numeric,uuid,text,boolean,uuid,boolean) to service_role;

-- Enforce the saved terms after staff edit an invoice, without changing other promotions.
create function public.guard_gap_invoice_offer() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare service_total numeric;
begin
 if new.discount_metadata->'gap_offer' is null and new.discount_metadata->'returning_offer' is null then return new; end if;
 select sum(l.line_total) filter(where c.id is not null and coalesce(c.category,'') !~* '^(travel|fees?|tax)$' and coalesce(c.slug,'') !~* '^(mileage-travel|travel-fee|tax|fee)$' and coalesce(c.name,'') !~* '^(mileage[ /-]*travel|travel fee|tax|fees?|google lsa.*)$') into service_total
 from public.ops_invoice_line_items l left join public.ops_appointment_line_items a on a.id=l.appointment_line_item_id left join public.service_catalog_items c on c.id=coalesce(l.service_catalog_item_id,a.service_catalog_item_id) where l.invoice_id=new.id;
 if service_total is null or round(service_total*100)<(coalesce(new.discount_metadata->'gap_offer',new.discount_metadata->'returning_offer')->>'minimum_service_cents')::integer or new.discount_amount<>35 or coalesce(new.percentage_discount_amount,0)<>0 then raise exception 'Invoice no longer qualifies for the approved non-stacking TF35 offer'; end if;
 if exists(select 1 from public.ops_invoice_line_items where invoice_id=new.id and line_total<0) then raise exception 'TF35 cannot combine with a credit/discount line'; end if;
 return new;
end $$;
create trigger gap_invoice_offer_guard before update on public.ops_invoices for each row execute function public.guard_gap_invoice_offer();
revoke all on function public.guard_gap_invoice_offer() from public,anon,authenticated;
grant execute on function public.guard_gap_invoice_offer() to service_role;

create function public.record_gap_outreach_delivery(p_recipient uuid,p_sid text,p_status text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.gap_outreach_recipients;
begin
 select * into r from public.gap_outreach_recipients where id=p_recipient for update;
 if not found or r.status not in('sending','accepted','delivered','unknown','failed','replied','booked') then raise exception 'No send attempt to reconcile'; end if;
 if r.provider_sid is not null and r.provider_sid<>p_sid then raise exception 'Provider SID mismatch'; end if;
 if p_status not in('queued','sent','delivered','undelivered','failed') then raise exception 'Invalid provider state'; end if;
 -- Do not regress terminal delivery or customer/business outcomes when callbacks arrive late.
 if r.provider_status in('delivered','undelivered','failed') and p_status in('queued','sent') then return; end if;
 insert into public.gap_outreach_contacts values(r.phone,'gap_outreach',p_sid,coalesce(r.attempted_at,now())) on conflict(source,source_id,phone) do nothing;
 update public.gap_outreach_recipients set provider_sid=p_sid,provider_status=p_status,
   status=case when status in('booked','replied') then status when p_status='delivered' then 'delivered' when p_status in('failed','undelivered') then 'failed' else 'accepted' end,
   sent_at=coalesce(sent_at,now()) where id=r.id;
end $$;
revoke all on function public.record_gap_outreach_delivery(uuid,text,text) from public,anon,authenticated;
grant execute on function public.record_gap_outreach_delivery(uuid,text,text) to service_role;
