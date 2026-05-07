-- Ranger hiring agent foundation.
-- Stores applicant state, candidate reports, evidence, messages, workflow tasks,
-- owner decisions, and outcome feedback for the hiring pipeline.

create extension if not exists pgcrypto;

create table if not exists public.ranger_applicants (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'craigslist',
  source_thread_id text,
  status text not null default 'new_applicant',
  full_name text,
  preferred_name text,
  email text,
  phone text,
  city_area text,
  has_reliable_transportation boolean,
  has_valid_driver_license boolean,
  can_work_nights boolean,
  can_work_saturdays boolean,
  can_do_physical_work boolean,
  relevant_experience text,
  availability_notes text,
  social_profiles jsonb not null default '[]'::jsonb,
  missing_fields text[] not null default '{}'::text[],
  hard_requirement_misses text[] not null default '{}'::text[],
  next_action text,
  follow_up_due_at timestamptz,
  last_contact_at timestamptz,
  owner_notes text,
  final_decision text,
  hired_at timestamptz,
  passed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ranger_applicants_status_check check (
    status in (
      'new_applicant',
      'needs_screening',
      'screening_sent',
      'awaiting_reply',
      'research_running',
      'candidate_report_ready',
      'owner_review',
      'follow_up_drafting',
      'late_stage_contact',
      'phone_call_ready',
      'interview_scheduled',
      'no_show',
      'passed',
      'hired',
      'ghosted',
      'outcome_tracking'
    )
  ),
  constraint ranger_applicants_final_decision_check check (
    final_decision is null or final_decision in (
      'hard_miss_pass',
      'screened_out',
      'owner_passed',
      'ghosted',
      'offered',
      'hired',
      'no_show'
    )
  )
);

create table if not exists public.ranger_candidate_reports (
  id uuid primary key default gen_random_uuid(),
  applicant_id uuid not null references public.ranger_applicants(id) on delete cascade,
  research_depth text not null default 'standard',
  overall_recommendation text not null default 'needs_review',
  overall_fit text not null default 'unknown',
  identity_confidence text not null default 'unknown',
  research_confidence text not null default 'unknown',
  summary text,
  strengths text[] not null default '{}'::text[],
  concerns text[] not null default '{}'::text[],
  missing_information text[] not null default '{}'::text[],
  suggested_questions text[] not null default '{}'::text[],
  suggested_next_step text,
  category_scores jsonb not null default '{}'::jsonb,
  report_payload jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ranger_candidate_reports_depth_check check (
    research_depth in ('light', 'standard', 'deep')
  ),
  constraint ranger_candidate_reports_recommendation_check check (
    overall_recommendation in (
      'pass_hard_miss',
      'needs_more_info',
      'owner_review',
      'continue_screening',
      'late_stage_contact',
      'ready_for_phone_call'
    )
  ),
  constraint ranger_candidate_reports_fit_check check (
    overall_fit in ('unknown', 'low', 'medium', 'medium_high', 'high')
  ),
  constraint ranger_candidate_reports_identity_confidence_check check (
    identity_confidence in ('unknown', 'low', 'medium', 'high')
  ),
  constraint ranger_candidate_reports_research_confidence_check check (
    research_confidence in ('unknown', 'low', 'medium', 'high')
  )
);

create table if not exists public.ranger_evidence (
  id uuid primary key default gen_random_uuid(),
  applicant_id uuid not null references public.ranger_applicants(id) on delete cascade,
  report_id uuid references public.ranger_candidate_reports(id) on delete set null,
  evidence_type text not null,
  source_label text,
  source_url text,
  source_date timestamptz,
  finding text not null,
  confidence text not null default 'medium',
  category text not null,
  sentiment text not null default 'neutral',
  raw_snippet text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint ranger_evidence_confidence_check check (
    confidence in ('low', 'medium', 'high')
  ),
  constraint ranger_evidence_category_check check (
    category in (
      'identity',
      'transportation',
      'schedule',
      'physical_work',
      'experience',
      'reliability',
      'judgment',
      'professionalism',
      'honesty',
      'safety',
      'customer_trust',
      'communication',
      'other'
    )
  ),
  constraint ranger_evidence_sentiment_check check (
    sentiment in ('positive', 'neutral', 'concern', 'red_flag')
  )
);

create table if not exists public.ranger_messages (
  id uuid primary key default gen_random_uuid(),
  applicant_id uuid references public.ranger_applicants(id) on delete cascade,
  channel text not null,
  direction text not null,
  subject text,
  body text not null,
  external_message_id text,
  status text not null default 'logged',
  requires_approval boolean not null default false,
  approved_by text,
  approved_at timestamptz,
  sent_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint ranger_messages_channel_check check (
    channel in ('gmail', 'sms', 'telegram', 'system')
  ),
  constraint ranger_messages_direction_check check (
    direction in ('inbound', 'outbound', 'internal')
  ),
  constraint ranger_messages_status_check check (
    status in ('draft', 'pending_approval', 'approved', 'sent', 'failed', 'logged')
  )
);

create table if not exists public.ranger_tasks (
  id uuid primary key default gen_random_uuid(),
  applicant_id uuid references public.ranger_applicants(id) on delete cascade,
  task_type text not null,
  status text not null default 'pending',
  priority text not null default 'normal',
  due_at timestamptz,
  locked_at timestamptz,
  completed_at timestamptz,
  error_message text,
  payload jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ranger_tasks_status_check check (
    status in ('pending', 'running', 'waiting_for_owner', 'completed', 'failed', 'cancelled')
  ),
  constraint ranger_tasks_priority_check check (
    priority in ('low', 'normal', 'high', 'urgent')
  )
);

create table if not exists public.ranger_owner_decisions (
  id uuid primary key default gen_random_uuid(),
  applicant_id uuid references public.ranger_applicants(id) on delete cascade,
  report_id uuid references public.ranger_candidate_reports(id) on delete set null,
  decision_type text not null,
  decision_value text not null,
  notes text,
  actor_email text,
  telegram_user_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.ranger_outcomes (
  id uuid primary key default gen_random_uuid(),
  applicant_id uuid not null references public.ranger_applicants(id) on delete cascade,
  outcome_type text not null,
  outcome_label text not null,
  notes text,
  recorded_by text,
  recorded_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint ranger_outcomes_type_check check (
    outcome_type in ('pipeline', 'feedback', 'employment')
  )
);

create table if not exists public.ranger_audit_events (
  id uuid primary key default gen_random_uuid(),
  applicant_id uuid references public.ranger_applicants(id) on delete set null,
  actor text not null default 'ranger',
  event_type text not null,
  event_summary text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ranger_applicants_status_idx
  on public.ranger_applicants(status, created_at desc);

create index if not exists ranger_applicants_email_idx
  on public.ranger_applicants(lower(email))
  where email is not null;

create index if not exists ranger_applicants_phone_idx
  on public.ranger_applicants(phone)
  where phone is not null;

create index if not exists ranger_candidate_reports_applicant_idx
  on public.ranger_candidate_reports(applicant_id, generated_at desc);

create index if not exists ranger_evidence_applicant_idx
  on public.ranger_evidence(applicant_id, created_at desc);

create index if not exists ranger_messages_applicant_idx
  on public.ranger_messages(applicant_id, created_at desc);

create index if not exists ranger_tasks_status_due_idx
  on public.ranger_tasks(status, due_at nulls first, created_at);

create index if not exists ranger_audit_events_applicant_idx
  on public.ranger_audit_events(applicant_id, created_at desc);

create or replace function public.set_ranger_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_ranger_applicants_updated_at on public.ranger_applicants;
create trigger set_ranger_applicants_updated_at
  before update on public.ranger_applicants
  for each row execute function public.set_ranger_updated_at();

drop trigger if exists set_ranger_candidate_reports_updated_at on public.ranger_candidate_reports;
create trigger set_ranger_candidate_reports_updated_at
  before update on public.ranger_candidate_reports
  for each row execute function public.set_ranger_updated_at();

drop trigger if exists set_ranger_tasks_updated_at on public.ranger_tasks;
create trigger set_ranger_tasks_updated_at
  before update on public.ranger_tasks
  for each row execute function public.set_ranger_updated_at();

alter table public.ranger_applicants enable row level security;
alter table public.ranger_candidate_reports enable row level security;
alter table public.ranger_evidence enable row level security;
alter table public.ranger_messages enable row level security;
alter table public.ranger_tasks enable row level security;
alter table public.ranger_owner_decisions enable row level security;
alter table public.ranger_outcomes enable row level security;
alter table public.ranger_audit_events enable row level security;

-- Admin APIs use the service role client. Keep browser access closed by default.
