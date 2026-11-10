-- Additive only: do not infer delivery or replay historical review requests.
alter table public.review_requests
  add column send_claimed_at timestamptz,
  add column twilio_sid text,
  add column delivery_status text not null default 'unknown'
    check (delivery_status in ('unknown', 'accepted', 'queued', 'sending', 'sent', 'delivered', 'undelivered', 'failed', 'canceled')),
  add column delivery_updated_at timestamptz,
  add column last_callback_at timestamptz,
  add column delivery_error_code text;

create unique index review_requests_twilio_sid_idx
  on public.review_requests (twilio_sid) where twilio_sid is not null;

comment on column public.review_requests.status is
  'Workflow state. sent means provider accepted, NOT delivered; consult delivery_status.';
comment on column public.review_requests.send_claimed_at is
  'Atomic submission claim. Never automatically clear/retry: the provider outcome may be unknown.';
comment on column public.review_requests.delivery_status is
  'unknown for historical/uncertain sends. delivered requires a verified Twilio callback.';

-- Serialize callback vs. initial response, reject SID mismatches, and ignore
-- repeated/out-of-order regressions. Terminal evidence is never overwritten.
create function public.record_review_request_delivery(
  p_request uuid,
  p_sid text,
  p_status text,
  p_error_code text default null,
  p_is_callback boolean default true
) returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  current_request public.review_requests%rowtype;
  next_status text;
begin
  if p_sid is null or p_status is null or p_is_callback is null
    or p_sid !~ '^SM[0-9a-fA-F]{32}$'
    or p_status not in ('accepted', 'queued', 'sending', 'sent', 'delivered', 'undelivered', 'failed', 'canceled')
    or (not p_is_callback and p_status <> 'accepted') then
    raise exception 'Invalid review SMS evidence';
  end if;

  select * into current_request from public.review_requests
    where id = p_request for update;
  if not found or current_request.send_claimed_at is null
    or (current_request.twilio_sid is not null and current_request.twilio_sid <> p_sid) then
    return false;
  end if;

  next_status := current_request.delivery_status;
  if next_status not in ('delivered', 'undelivered', 'failed', 'canceled')
    and array_position(array['unknown', 'accepted', 'queued', 'sending', 'sent', 'undelivered', 'failed', 'canceled', 'delivered'], p_status)
      >= array_position(array['unknown', 'accepted', 'queued', 'sending', 'sent', 'undelivered', 'failed', 'canceled', 'delivered'], next_status) then
    next_status := p_status;
  end if;

  update public.review_requests set
    twilio_sid = p_sid,
    status = case when status = 'skipped' then status else 'sent' end,
    sent_at = coalesce(sent_at, now()),
    delivery_status = next_status,
    delivery_updated_at = case when delivery_status <> next_status then now() else delivery_updated_at end,
    last_callback_at = case when p_is_callback then now() else last_callback_at end,
    delivery_error_code = case when delivery_status <> next_status then p_error_code else delivery_error_code end,
    updated_at = now()
  where id = p_request;

  -- The log may be inserted after an early callback. Initial acceptance calls
  -- this again after logSMS finishes, preserving any stronger delivery evidence.
  update public.sms_logs set status = next_status
    where twilio_sid = p_sid and message_type = 'review_request';
  return true;
end;
$$;

revoke all on function public.record_review_request_delivery(uuid, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.record_review_request_delivery(uuid, text, text, text, boolean) to service_role;
