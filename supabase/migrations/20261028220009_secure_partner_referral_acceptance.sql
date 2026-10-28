-- Partner decisions and the server-saved referral fee commit together. Browser
-- clients cannot call this function or supply a partner, fee, or balance.
grant select, update on public.partners, public.outbound_referrals to service_role;

create function public.review_partner_outbound_referral(
  p_user_id uuid,
  p_referral_id uuid,
  p_action text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  saved_partner public.partners%rowtype;
  saved_referral public.outbound_referrals%rowtype;
  decision_time timestamptz := now();
  replayed boolean := false;
begin
  if p_user_id is null or p_referral_id is null
     or p_action is null or p_action not in ('accept', 'decline') then
    return jsonb_build_object('success', false, 'code', 'INVALID_DECISION');
  end if;

  -- Serialize all fee changes for one partner before locking the referral.
  select * into saved_partner from public.partners
  where user_id = p_user_id for update;
  if not found then
    return jsonb_build_object('success', false, 'code', 'PARTNER_NOT_FOUND');
  end if;
  select * into saved_referral from public.outbound_referrals
  where id = p_referral_id and partner_id = saved_partner.id for update;
  if not found then
    return jsonb_build_object('success', false, 'code', 'REFERRAL_NOT_FOUND');
  end if;

  if saved_referral.status = 'pending' then
    if p_action = 'accept' then
      if coalesce(saved_referral.referral_fee, 0) < 0
         or saved_referral.referral_fee::text in ('NaN', 'Infinity', '-Infinity') then
        raise exception 'Invalid saved referral fee' using errcode = '22023';
      end if;
      update public.outbound_referrals
      set status = 'accepted', accepted_at = decision_time,
          viewed_at = coalesce(viewed_at, decision_time)
      where id = saved_referral.id
      returning * into saved_referral;
      if coalesce(saved_referral.referral_fee, 0) > 0 then
        update public.partners
        set referral_balance_owed = coalesce(referral_balance_owed, 0) + saved_referral.referral_fee
        where id = saved_partner.id;
      end if;
    else
      update public.outbound_referrals
      set status = 'declined', viewed_at = coalesce(viewed_at, decision_time)
      where id = saved_referral.id
      returning * into saved_referral;
    end if;
  elsif (p_action = 'accept' and saved_referral.status in ('accepted', 'completed'))
     or (p_action = 'decline' and saved_referral.status = 'declined') then
    replayed := true;
  else
    return jsonb_build_object('success', false, 'code', 'DECISION_CONFLICT');
  end if;

  if p_action = 'accept' then
    return jsonb_build_object(
      'success', true, 'referral_id', saved_referral.id,
      'status', saved_referral.status, 'replayed', replayed,
      'client_name', saved_referral.client_name,
      'client_phone', saved_referral.client_phone,
      'client_email', saved_referral.client_email,
      'notes', saved_referral.notes
    );
  end if;
  return jsonb_build_object(
    'success', true, 'referral_id', saved_referral.id,
    'status', saved_referral.status, 'replayed', replayed
  );
end;
$$;

revoke all on function public.review_partner_outbound_referral(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.review_partner_outbound_referral(uuid, uuid, text)
  to service_role;
comment on function public.review_partner_outbound_referral(uuid, uuid, text) is
  'Server-only verified partner decision; locks membership and referral, charges saved fee once, and replays completed decisions safely.';
