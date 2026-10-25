-- Truthful per-customer owner assertion. No customer opt-in date is invented, no data backfill and no new role grants.
alter table public.ops_sms_consent_events add column owner_attested_at timestamptz,add column evidence_ref text;
alter table public.ops_sms_consent_events drop constraint ops_sms_consent_events_action_check;
alter table public.ops_sms_consent_events drop constraint ops_sms_consent_events_source_check;
alter table public.ops_sms_consent_events add constraint ops_sms_consent_events_action_check
 check(action in('opted_in','opted_out','owner_attested_existing_permission'));
alter table public.ops_sms_consent_events add constraint ops_sms_consent_events_source_check
 check(source in('commercial_portal','customer_reply','owner_attestation'));
alter table public.ops_sms_consent_events add constraint gap_owner_attestation_shape check(
 (action='owner_attested_existing_permission' and source='owner_attestation' and owner_attested_at is not null and user_id is not null and nullif(btrim(consent_text),'') is not null and evidence_ref is not null and evidence_ref like '%#customer='||customer_id::text)
 or (action in('opted_in','opted_out') and source in('commercial_portal','customer_reply') and owner_attested_at is null and evidence_ref is null));
create unique index gap_owner_attestation_approval_once on public.ops_sms_consent_events(customer_id,evidence_ref) where action='owner_attested_existing_permission';
create function public.guard_gap_owner_attestation() returns trigger language plpgsql
security invoker set search_path=public,pg_temp as $$
declare actual_phone text;
begin
 if tg_op in('UPDATE','DELETE') and old.action='owner_attested_existing_permission' then raise exception 'Owner attestation audit records are immutable'; end if;
 if tg_op='DELETE' then return old; end if;
 if new.action<>'owner_attested_existing_permission' then return new; end if;
 if current_user not in('postgres','service_role','supabase_admin') then raise exception 'Server-recorded owner attestation required'; end if;
 if not exists(select 1 from public.staff_users where user_id=new.user_id and role='owner' and is_active) then raise exception 'Verified active owner required'; end if;
 select public.gap_outreach_phone(phone) into actual_phone from public.ops_customers where id=new.customer_id;
 if actual_phone is null or length(actual_phone)<>12 or public.gap_outreach_phone(new.phone)<>actual_phone then raise exception 'Attestation customer/phone mismatch'; end if;
 if new.owner_attested_at>now()+interval '5 seconds' then raise exception 'Future owner attestation is invalid'; end if;
 if exists(select 1 from public.sms_marketing_consents where (customer_id=new.customer_id or public.gap_outreach_phone(phone_normalized)=actual_phone) and status='opted_out')
 or exists(select 1 from public.ops_sms_consent_events where action='opted_out' and (customer_id=new.customer_id or public.gap_outreach_phone(phone)=actual_phone)) then raise exception 'Customer opt-out takes precedence over owner attestation'; end if;
 if exists(select 1 from public.blacklist where public.gap_outreach_phone(phone)=actual_phone) then raise exception 'Blacklisted customer cannot receive owner attestation'; end if;
 new.phone:=actual_phone;
 return new;
end $$;
create trigger gap_owner_attestation_guard before insert or update or delete on public.ops_sms_consent_events for each row execute function public.guard_gap_owner_attestation();
-- A trigger invocation requires no new callable API privilege. Preserve the table's existing server-only grants.
revoke all on function public.guard_gap_owner_attestation() from public,anon,authenticated,service_role;

create or replace function public.check_gap_outreach_send(p_recipient uuid,p_actor uuid) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
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
 elsif not (
   exists(select 1 from public.sms_marketing_consents s where s.customer_id=r.customer_id and s.status='opted_in' and s.consented_at is not null and nullif(s.disclosure,'') is not null)
   or exists(select 1 from public.ops_sms_consent_events e join public.staff_users owner on owner.user_id=e.user_id
     where e.customer_id=r.customer_id and public.gap_outreach_phone(e.phone)=r.phone
       and e.action='owner_attested_existing_permission' and e.source='owner_attestation'
       and e.owner_attested_at is not null and e.owner_attested_at<=now()
       and nullif(e.consent_text,'') is not null and e.evidence_ref like '%#customer='||r.customer_id::text
       and owner.role='owner' and owner.is_active)
 ) then reason:='consent_unverified';
 elsif exists(select 1 from public.ops_sms_consent_events e where e.action='opted_out' and (e.customer_id=r.customer_id or public.gap_outreach_phone(e.phone)=r.phone)) then reason:='opted_out';
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
