-- Extend the owner-approved first-contact ledger to verified leads that have
-- no saved customer or conversation. Provider acceptance remains the only
-- point where a conversation/history row is created.

-- The existing lead source check predates authenticated owner handoffs.
alter table public.leads drop constraint if exists leads_source_check;
alter table public.leads
  add constraint leads_source_check
  check (source in ('contest','partner','missed_call','website','owner_handoff'));

alter table public.mcp_first_message_attempts
  alter column customer_id drop not null,
  add column if not exists lead_id uuid references public.leads(id);

alter table public.mcp_first_message_attempts
  drop constraint if exists mcp_first_message_attempt_identity_check;
alter table public.mcp_first_message_attempts
  add constraint mcp_first_message_attempt_identity_check
  check (num_nonnulls(customer_id, lead_id) = 1);

create or replace function public.claim_mcp_first_message(
  p_preview uuid,
  p_actor uuid
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  a public.mcp_action_previews;
  c public.ops_customers;
  l public.leads;
  prior public.mcp_first_message_attempts;
  target_phone text;
  target_customer uuid;
  target_lead uuid;
  intake_name text;
  new_intake boolean := false;
  create_intake_lead boolean := false;
begin
  if not exists(
    select 1
    from public.staff_users s
    join public.mcp_authorized_users g on g.user_id=s.user_id
    where s.user_id=p_actor
      and s.role='owner'
      and s.is_active
      and g.revoked_at is null
      and g.scopes @> array['business:read','customer:contact']
  ) then
    raise exception 'Active owner contact grant required';
  end if;

  select * into a
  from public.mcp_action_previews
  where id=p_preview and actor_user_id=p_actor
  for update;
  if not found
    or a.action_type<>'conversation.send'
    or a.status<>'executing'
    or a.expires_at<=now()
    or a.action_payload->'first_contact' is null
  then
    raise exception 'Executing unexpired first-contact preview required';
  end if;

  if a.action_payload->'first_contact'->>'customer_id' is not null then
    target_customer := (a.action_payload->'first_contact'->>'customer_id')::uuid;
    select * into c from public.ops_customers where id=target_customer for update;
    if not found then raise exception 'Customer not found'; end if;
    target_phone := public.gap_outreach_phone(c.phone);
    if target_phone is null
      or length(target_phone)<>12
      or target_phone<>a.action_payload->'first_contact'->>'phone'
      or c.updated_at is null
      or c.updated_at is distinct from
        (a.action_payload->'first_contact'->>'customer_updated_at')::timestamptz
      or coalesce(c.is_internal,false)
    then
      raise exception 'Customer identity changed or not contactable';
    end if;
  elsif a.action_payload->'first_contact'->>'lead_id' is not null then
    target_lead := (a.action_payload->'first_contact'->>'lead_id')::uuid;
    select * into l from public.leads where id=target_lead for update;
    if not found then raise exception 'Lead not found'; end if;
    target_phone := public.gap_outreach_phone(l.phone);
    if target_phone is null
      or length(target_phone)<>12
      or target_phone<>a.action_payload->'first_contact'->>'phone'
      or l.created_at is null
      or l.created_at is distinct from
        (a.action_payload->'first_contact'->>'lead_created_at')::timestamptz
      or coalesce(l.source,'') is distinct from
        coalesce(a.action_payload->'first_contact'->>'lead_source','')
      or coalesce(l.status::text,'') is distinct from
        coalesce(a.action_payload->'first_contact'->>'lead_status','')
      or l.status::text not in ('new','contacted','quoted')
    then
      raise exception 'Lead identity changed or not contactable';
    end if;
    if exists(
      select 1 from public.ops_customers x
      where public.gap_outreach_phone(x.phone)=target_phone
    ) then
      raise exception 'Lead phone now belongs to a saved customer';
    end if;
  elsif a.action_payload->'first_contact'->'new_lead' is not null then
    new_intake := true;
    target_phone := public.gap_outreach_phone(
      a.action_payload->'first_contact'->'new_lead'->>'phone'
    );
    intake_name := nullif(btrim(
      coalesce(a.action_payload->'first_contact'->'new_lead'->>'name','')
    ),'');
    if target_phone is null
      or length(target_phone)<>12
      or target_phone<>a.action_payload->'first_contact'->>'phone'
      or a.action_payload->'first_contact'->'new_lead'->>'source'<>'owner_handoff'
      or length(coalesce(intake_name,''))>200
    then
      raise exception 'Owner lead intake changed or not contactable';
    end if;
  else
    raise exception 'First-contact identity required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_phone,0));
  select * into prior
  from public.mcp_first_message_attempts
  where phone=target_phone and (status<>'rejected' or preview_id=p_preview)
  order by created_at desc
  limit 1;
  if found then
    return jsonb_build_object(
      'claimed',false,
      'status',prior.status,
      'preview_id',prior.preview_id,
      'provider_sid',prior.provider_sid,
      'conversation_id',prior.conversation_id
    );
  end if;

  if new_intake then
    if exists(
      select 1 from public.ops_customers x
      where public.gap_outreach_phone(x.phone)=target_phone
    ) then
      raise exception 'Lead phone belongs to a saved customer';
    end if;
    if exists(
      select 1 from public.conversations t
      where public.gap_outreach_phone(t.phone_number)=target_phone
    ) then
      raise exception 'Conversation appeared after preview; inspect it before contacting';
    end if;
    perform 1 from public.leads x
    where public.gap_outreach_phone(x.phone)=target_phone
    for update;
    select * into l
    from public.leads x
    where public.gap_outreach_phone(x.phone)=target_phone
    order by x.created_at desc,x.id
    limit 1;
    if found then
      if exists(
        select 1 from public.leads x
        where x.id<>l.id and public.gap_outreach_phone(x.phone)=target_phone
      ) then
        raise exception 'Ambiguous lead phone';
      end if;
      if l.status::text not in ('new','contacted','quoted') then
        raise exception 'Matching lead is not eligible for first contact';
      end if;
      target_lead := l.id;
    else
      create_intake_lead := true;
    end if;
  end if;

  if target_customer is not null and exists(
    select 1 from public.ops_customers x
    where x.id<>target_customer
      and public.gap_outreach_phone(x.phone)=target_phone
  ) then
    raise exception 'Ambiguous customer phone';
  end if;

  if exists(
    select 1 from public.blacklist b
    where public.gap_outreach_phone(b.phone)=target_phone
  ) or exists(
    select 1 from public.sms_marketing_consents s
    where (
      (target_customer is not null and s.customer_id=target_customer)
      or public.gap_outreach_phone(s.phone_normalized)=target_phone
    ) and s.status='opted_out'
  ) or exists(
    select 1 from public.ops_sms_consent_events e
    where (
      (target_customer is not null and e.customer_id=target_customer)
      or public.gap_outreach_phone(e.phone)=target_phone
    ) and e.action='opted_out'
  ) then
    raise exception 'Customer contact suppressed';
  end if;

  if exists(
    select 1 from public.conversations t
    where (target_customer is not null and t.ops_customer_id=target_customer)
      or (target_lead is not null and t.lead_id=target_lead)
      or public.gap_outreach_phone(t.phone_number)=target_phone
  ) then
    raise exception 'Conversation appeared after preview; inspect it before contacting';
  end if;

  if coalesce(length(a.action_payload->>'body'),0) not between 1 and 1600
    or jsonb_array_length(coalesce(a.action_payload->'media_ids','[]'))<>0
  then
    raise exception 'First contact requires exact text only';
  end if;

  if create_intake_lead then
    insert into public.leads(source,name,phone,status,notes)
    values(
      'owner_handoff',intake_name,target_phone,'new',
      'Owner-authorized Sightings first-contact intake'
    )
    returning * into l;
    target_lead := l.id;
  end if;

  insert into public.mcp_first_message_attempts(
    preview_id,actor_user_id,customer_id,lead_id,phone,body,status
  ) values(
    a.id,p_actor,target_customer,target_lead,target_phone,
    a.action_payload->>'body','sending'
  );
  return jsonb_build_object(
    'claimed',true,
    'phone',target_phone,
    'customer_id',target_customer,
    'lead_id',target_lead,
    'body',a.action_payload->>'body'
  );
end
$$;

create or replace function public.finish_mcp_first_message(
  p_preview uuid,
  p_actor uuid,
  p_status text,
  p_sid text default null,
  p_error text default null
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  r public.mcp_first_message_attempts;
  convo public.conversations;
  message jsonb;
begin
  select * into r
  from public.mcp_first_message_attempts
  where preview_id=p_preview and actor_user_id=p_actor
  for update;
  if not found then raise exception 'Claimed owner message required'; end if;

  if r.status='accepted' then
    if p_sid is distinct from r.provider_sid then
      raise exception 'Provider SID mismatch';
    end if;
    return jsonb_build_object(
      'status',r.status,
      'twilio_sid',r.provider_sid,
      'conversation_id',r.conversation_id,
      'history_recorded',true
    );
  end if;
  if p_status not in('accepted','rejected','unknown') then
    raise exception 'Invalid provider outcome';
  end if;

  if p_status='accepted' then
    if p_sid is null or p_sid !~ '^SM[0-9a-fA-F]{32}$' then
      raise exception 'Provider SID required';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(r.phone,0));
    select * into convo
    from public.conversations
    where (r.customer_id is not null and ops_customer_id=r.customer_id)
      or (r.lead_id is not null and lead_id=r.lead_id)
      or public.gap_outreach_phone(phone_number)=r.phone
    order by updated_at desc
    limit 1
    for update;

    if found and (
      public.gap_outreach_phone(convo.phone_number)<>r.phone
      or (r.customer_id is not null and convo.ops_customer_id is not null
          and convo.ops_customer_id<>r.customer_id)
      or (r.lead_id is not null and convo.lead_id is not null
          and convo.lead_id<>r.lead_id)
      or (r.lead_id is not null and convo.ops_customer_id is not null)
    ) then
      raise exception 'Conversation identity mismatch; reconcile accepted send';
    end if;

    if not found then
      insert into public.conversations(
        phone_number,ops_customer_id,lead_id,source,messages,ai_enabled,status
      ) values(
        r.phone,r.customer_id,r.lead_id,'admin_outbound','[]',false,'active'
      ) returning * into convo;
    end if;

    message := jsonb_build_object(
      'role','assistant',
      'content',r.body,
      -- The claim predates the provider call. Preserve that ordering if an
      -- inbound callback wins the race and creates the conversation first.
      'timestamp',r.created_at,
      'twilio_sid',p_sid,
      'sent_by','Owner-approved Sightings first contact'
    );
    if not exists(
      select 1 from jsonb_array_elements(coalesce(convo.messages,'[]')) m
      where m->>'twilio_sid'=p_sid
    ) then
      update public.conversations
      -- A customer reply can win the webhook/finalization race. This is the
      -- first outbound by definition, so retain chronological array order.
      set messages=jsonb_build_array(message)||coalesce(messages,'[]'),
          ops_customer_id=coalesce(ops_customer_id,r.customer_id),
          lead_id=coalesce(lead_id,r.lead_id),
          updated_at=now()
      where id=convo.id;
    end if;

    if not exists(select 1 from public.sms_logs where twilio_sid=p_sid) then
      insert into public.sms_logs(
        customer_id,lead_id,recipient_phone,message_type,message_content,
        twilio_sid,status,sent_by
      ) values(
        r.customer_id,r.lead_id,r.phone,'admin_outbound',r.body,
        p_sid,'sent','Owner-approved Sightings first contact'
      );
    end if;
  end if;

  update public.mcp_first_message_attempts
  set status=p_status,
      provider_sid=p_sid,
      conversation_id=case when p_status='accepted' then convo.id else conversation_id end,
      error_code=left(p_error,200),
      updated_at=now()
  where preview_id=r.preview_id;
  return jsonb_build_object(
    'status',p_status,
    'twilio_sid',p_sid,
    'conversation_id',case when p_status='accepted' then convo.id else null end,
    'history_recorded',p_status='accepted'
  );
end
$$;

revoke all on function public.claim_mcp_first_message(uuid,uuid),
  public.finish_mcp_first_message(uuid,uuid,text,text,text)
from public,anon,authenticated;
grant execute on function public.claim_mcp_first_message(uuid,uuid),
  public.finish_mcp_first_message(uuid,uuid,text,text,text)
to service_role;
