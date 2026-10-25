-- Approved correction: include drip email in the new gap ledger; no backfill, consent or campaign changes.
create function public.record_gap_drip_email_contact() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare recipient_phone text;
begin
 if new.status <> 'sent' or new.sent_at is null then return new; end if;
 for recipient_phone in
   select distinct public.gap_outreach_phone(c.phone)
   from public.ops_customers c
   where c.id=(select e.customer_id from public.drip_campaign_enrollments e where e.id=new.enrollment_id)
      or (nullif(btrim(new.to_email),'') is not null and lower(btrim(c.email))=lower(btrim(new.to_email)))
 loop
   if length(recipient_phone)=12 then
     insert into public.gap_outreach_contacts(phone,source,source_id,contacted_at)
       values(recipient_phone,'drip_email_log',new.id::text,new.sent_at)
       on conflict(source,source_id,phone) do update set contacted_at=greatest(gap_outreach_contacts.contacted_at,excluded.contacted_at);
     update public.gap_outreach_recipients set status='suppressed',stop_reason='new_drip_email_contact'
       where phone=recipient_phone and status='pending';
   end if;
 end loop;
 return new;
end $$;
create trigger gap_outreach_drip_contact after insert or update on public.drip_email_log
 for each row execute function public.record_gap_drip_email_contact();
revoke all on function public.record_gap_drip_email_contact() from public,anon,authenticated;
grant execute on function public.record_gap_drip_email_contact() to service_role;
