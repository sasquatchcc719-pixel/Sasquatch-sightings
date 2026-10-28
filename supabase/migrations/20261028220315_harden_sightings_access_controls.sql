-- Close public database access before granting only the established browser workflows.
-- Service clients retain existing privileges and RLS bypass; no business data changes.
revoke create on schema public from public, anon, authenticated;
revoke all on all tables in schema public from public, anon;

create or replace function public.current_app_role()
returns text language sql stable security definer set search_path = public, pg_temp
as $$
  select case when exists(select 1 from auth.users u where u.id=auth.uid() and not coalesce(u.is_anonymous,false)) then
    coalesce(
      (select s.role from public.staff_users s where s.user_id=auth.uid() and s.is_active=true and s.role in ('owner','dispatcher','tech','marketing') limit 1),
      (select p.role from public.partners p where p.user_id=auth.uid() and p.role in ('partner','admin') limit 1)
    ) else null end;
$$;
create or replace function public.app_has_role(allowed_roles text[])
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select coalesce(public.current_app_role()='admin' or public.current_app_role()=any(allowed_roles),false); $$;
revoke all on function public.current_app_role(), public.app_has_role(text[]) from public, anon;
grant execute on function public.current_app_role(), public.app_has_role(text[]) to authenticated, service_role;

-- Registration checks identity without granting a business role or exposing auth.users.
create function public.is_registered_app_user()
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select exists(select 1 from auth.users u where u.id=auth.uid() and not coalesce(u.is_anonymous,false)); $$;
revoke all on function public.is_registered_app_user() from public,anon;
grant execute on function public.is_registered_app_user() to authenticated,service_role;

-- Audited server-only tables: 23 lacked RLS; the others have no browser workflow.
do $block$ declare t text; p record; begin
  foreach t in array array['agent_api_keys', 'ai_chat_logs', 'ai_diagnostic_logs', 'ai_tool_calls', 'api_v1_rate_limits', 'api_v1_request_logs', 'appointment_call_dispatch', 'asset_meter_logs', 'backup_name_case_addresses_20260810', 'backup_name_case_customers_20260810', 'bing_rank_snapshots', 'blacklist', 'booking_error_events', 'booking_funnel_events', 'brand_mentions', 'business_cost_snapshots', 'canvass_points', 'canvass_sessions', 'channel_ad_costs', 'chemical_products', 'cleaning_reminder_prompts', 'cleaning_reminders', 'commercial_ach_access_requests', 'competitors', 'drip_campaign_enrollments', 'drip_email_log', 'drip_email_templates', 'echo_settings', 'fiber_checks', 'fleet_assets', 'fleet_dispatch_state', 'fleet_dispatch_tracking', 'fleet_job_trips', 'fleet_job_visits', 'fleet_tracker_points', 'fleet_trackers', 'gap_outreach_batches', 'gap_outreach_contacts', 'gap_outreach_recipients', 'gbp_profile_snapshots', 'gbp_questions', 'gbp_review_counts', 'gbp_review_pulls', 'gbp_reviews', 'gsc_keyword_snapshots', 'gsc_page_snapshots', 'gsc_ranking_snapshots', 'gsc_watchlist_keywords', 'harry_conversations', 'harry_memory', 'hcp_customer_history', 'keyword_volume_snapshots', 'local_falcon_account_snapshot', 'local_falcon_campaign_runs', 'local_falcon_campaigns', 'local_falcon_competitor_points', 'local_falcon_competitor_reports', 'local_falcon_guard_locations', 'local_falcon_guard_reports', 'local_falcon_keyword_reports', 'local_falcon_location_reports', 'local_falcon_points', 'local_falcon_reviews_reports', 'local_falcon_scans', 'local_falcon_trend_reports', 'lsa_charges', 'maintenance_rules', 'maintenance_tasks', 'market_intel', 'market_intel_targets', 'marketing_campaign_costs', 'marketing_campaigns', 'marketing_events', 'marketing_weekly_rollup', 'mcp_action_audit', 'mcp_action_previews', 'mcp_authorized_users', 'mcp_event_deliveries', 'mcp_event_subscriptions', 'mcp_first_message_attempts', 'mcp_inbound_event_ledger', 'mcp_saved_conversation_drafts', 'nextdoor_notifications', 'nfc_button_clicks', 'ops_after_hours_premiums', 'ops_client_change_requests', 'ops_client_users', 'ops_commercial_agreements', 'ops_commercial_documents', 'ops_commercial_profiles', 'ops_commercial_setup_deliveries', 'ops_commission_details', 'ops_deleted_records', 'ops_invoice_email_deliveries', 'ops_job_photos', 'ops_payments', 'ops_payroll_lines', 'ops_payroll_periods', 'ops_sms_consent_events', 'ops_tech_receipts', 'ops_time_clock_events', 'ops_unscheduled_follow_ups', 'outreach_measurement_receipts', 'phone_health_alerts', 'phone_health_state', 'phone_settings', 'promo_code_tiers', 'promo_codes', 'qb_historical_transactions', 'quickbooks_oauth_tokens', 'radar_grid_points', 'radar_grid_scans', 'radar_map_pack_snapshots', 'ranger_applicants', 'ranger_audit_events', 'ranger_candidate_reports', 'ranger_command_messages', 'ranger_command_threads', 'ranger_evidence', 'ranger_messages', 'ranger_outcomes', 'ranger_owner_decisions', 'ranger_pending_actions', 'ranger_tasks', 'ranger_telegram_updates', 'reactivation_campaign_enrollments', 'reactivation_email_clicks', 'reactivation_email_log', 'reactivation_email_templates', 'reactivation_settings', 'relay_operators', 'restoration_air_readings', 'restoration_area_openings', 'restoration_areas', 'restoration_catalog_items', 'restoration_category_events', 'restoration_dehu_readings', 'restoration_equipment_placements', 'restoration_equipment_positions', 'restoration_estimate_lines', 'restoration_plan_nodes', 'restoration_plan_walls', 'restoration_projects', 'restoration_reading_points', 'restoration_readings', 'restoration_visit_queue', 'review_requests', 'review_station_taps', 'scan_schedules', 'sms_marketing_consents', 'social_post_log', 'system_settings', 'telegram_relay_groups', 'telegram_relay_threads', 'tomorrow_fill_campaigns', 'tomorrow_fill_events', 'tomorrow_fill_recipients', 'tomorrow_fill_settings'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public, anon, authenticated',t);
    for p in select policyname from pg_policies where schemaname='public' and tablename=t loop
      execute format('drop policy %I on public.%I',p.policyname,t);
    end loop;
  end loop;
end; $block$;

do $block$ declare p record; begin for p in select policyname from pg_policies where schemaname='public' and tablename='partners' loop execute format('drop policy %I on public.%I',p.policyname,'partners'); end loop; end; $block$;
alter table public."partners" enable row level security;
revoke all on public."partners" from authenticated;
grant select on public.partners to authenticated;
grant insert(user_id,name,email,phone,company_name,company_website,home_address,backlink_opted_in,role,credit_balance) on public.partners to authenticated;
grant update(name,email,phone,company_name,company_website,home_address,backlink_opted_in) on public.partners to authenticated;
create policy "partners_own_read" on public."partners" for SELECT to authenticated using (user_id=auth.uid() and public.is_registered_app_user());
create policy "partners_safe_registration" on public."partners" for INSERT to authenticated with check (user_id=auth.uid() and public.is_registered_app_user() and role='partner' and credit_balance=0 and not coalesce(backlink_verified,false) and coalesce(referral_balance_owed,0)=0 and partner_type='referral' and coalesce(reward_tier,0)=0 and coalesce(total_taps,0)=0 and coalesce(total_conversions,0)=0 and card_id is null and pin is null);
create policy "partners_own_profile_update" on public."partners" for UPDATE to authenticated using (user_id=auth.uid() and public.is_registered_app_user()) with check (user_id=auth.uid() and public.is_registered_app_user());

do $block$ declare p record; begin for p in select policyname from pg_policies where schemaname='public' and tablename='referrals' loop execute format('drop policy %I on public.%I',p.policyname,'referrals'); end loop; end; $block$;
alter table public."referrals" enable row level security;
revoke all on public."referrals" from authenticated;
grant select on public."referrals" to authenticated;
create policy "referrals_own_read" on public."referrals" for SELECT to authenticated using (public.is_registered_app_user() and partner_id in(select id from public.partners where user_id=auth.uid()));

do $block$ declare p record; begin for p in select policyname from pg_policies where schemaname='public' and tablename='outbound_referrals' loop execute format('drop policy %I on public.%I',p.policyname,'outbound_referrals'); end loop; end; $block$;
alter table public."outbound_referrals" enable row level security;
revoke all on public."outbound_referrals" from authenticated;
grant select on public."outbound_referrals" to authenticated;
create policy "outbound_referrals_own_read" on public."outbound_referrals" for SELECT to authenticated using (public.is_registered_app_user() and partner_id in(select id from public.partners where user_id=auth.uid()));

do $block$ declare p record; begin for p in select policyname from pg_policies where schemaname='public' and tablename='jobs' loop execute format('drop policy %I on public.%I',p.policyname,'jobs'); end loop; end; $block$;
alter table public."jobs" enable row level security;
revoke all on public."jobs" from authenticated;
grant select,insert,update,delete on public."jobs" to authenticated;
create policy "jobs_staff_access" on public."jobs" for ALL to authenticated using (public.app_has_role(array['owner','dispatcher','tech','marketing'])) with check (public.app_has_role(array['owner','dispatcher','tech','marketing']));

do $block$ declare p record; begin for p in select policyname from pg_policies where schemaname='public' and tablename='sightings' loop execute format('drop policy %I on public.%I',p.policyname,'sightings'); end loop; end; $block$;
alter table public."sightings" enable row level security;
revoke all on public."sightings" from authenticated;
grant select,insert,update,delete on public."sightings" to authenticated;
create policy "sightings_staff_access" on public."sightings" for ALL to authenticated using (public.app_has_role(array['owner','dispatcher','tech','marketing'])) with check (public.app_has_role(array['owner','dispatcher','tech','marketing']));

do $block$ declare p record; begin for p in select policyname from pg_policies where schemaname='public' and tablename='settings' loop execute format('drop policy %I on public.%I',p.policyname,'settings'); end loop; end; $block$;
alter table public."settings" enable row level security;
revoke all on public."settings" from authenticated;
grant select on public."settings" to authenticated;
grant insert(user_id,annual_revenue_goal,available_hours_per_week,work_weeks_per_year,hiring_threshold,hiring_consecutive_weeks,updated_at),update(annual_revenue_goal,available_hours_per_week,work_weeks_per_year,hiring_threshold,hiring_consecutive_weeks,updated_at) on public.settings to authenticated;
create policy "settings_staff_own_select" on public."settings" for SELECT to authenticated using (user_id=auth.uid() and public.app_has_role(array['owner','dispatcher','tech','marketing']));
create policy "settings_staff_own_insert" on public."settings" for INSERT to authenticated with check (user_id=auth.uid() and public.app_has_role(array['owner','dispatcher','tech','marketing']));
create policy "settings_staff_own_update" on public."settings" for UPDATE to authenticated using (user_id=auth.uid() and public.app_has_role(array['owner','dispatcher','tech','marketing'])) with check (user_id=auth.uid() and public.app_has_role(array['owner','dispatcher','tech','marketing']));

do $block$ declare p record; begin for p in select policyname from pg_policies where schemaname='public' and tablename='revenue_entries' loop execute format('drop policy %I on public.%I',p.policyname,'revenue_entries'); end loop; end; $block$;
alter table public."revenue_entries" enable row level security;
revoke all on public."revenue_entries" from authenticated;
grant select on public."revenue_entries" to authenticated;
grant insert,update,delete on public."revenue_entries" to authenticated;
create policy "revenue_entries_staff_own" on public."revenue_entries" for ALL to authenticated using (user_id=auth.uid() and public.app_has_role(array['owner','dispatcher','tech','marketing'])) with check (user_id=auth.uid() and public.app_has_role(array['owner','dispatcher','tech','marketing']));

do $block$ declare p record; begin for p in select policyname from pg_policies where schemaname='public' and tablename='weekly_revenue' loop execute format('drop policy %I on public.%I',p.policyname,'weekly_revenue'); end loop; end; $block$;
alter table public."weekly_revenue" enable row level security;
revoke all on public."weekly_revenue" from authenticated;
grant select on public."weekly_revenue" to authenticated;
grant insert,update,delete on public."weekly_revenue" to authenticated;
create policy "weekly_revenue_staff_own" on public."weekly_revenue" for ALL to authenticated using (user_id=auth.uid() and public.app_has_role(array['owner','dispatcher','tech','marketing'])) with check (user_id=auth.uid() and public.app_has_role(array['owner','dispatcher','tech','marketing']));

do $block$ declare p record; begin for p in select policyname from pg_policies where schemaname='public' and tablename='nfc_card_taps' loop execute format('drop policy %I on public.%I',p.policyname,'nfc_card_taps'); end loop; end; $block$;
alter table public."nfc_card_taps" enable row level security;
revoke all on public."nfc_card_taps" from authenticated;
grant select on public."nfc_card_taps" to authenticated;
create policy "nfc_card_taps_staff_read" on public."nfc_card_taps" for SELECT to authenticated using (public.app_has_role(array['owner','dispatcher','marketing']));

do $block$ declare p record; begin for p in select policyname from pg_policies where schemaname='public' and tablename='services' loop execute format('drop policy %I on public.%I',p.policyname,'services'); end loop; end; $block$;
alter table public."services" enable row level security;
revoke all on public."services" from authenticated;
grant select on public.services to anon,authenticated;
create policy "services_public_catalog" on public."services" for SELECT to anon,authenticated using (true);

do $block$ declare p record; begin for p in select policyname from pg_policies where schemaname='public' and tablename='station_health_alerts' loop execute format('drop policy %I on public.%I',p.policyname,'station_health_alerts'); end loop; end; $block$;
alter table public."station_health_alerts" enable row level security;
revoke all on public."station_health_alerts" from authenticated;
grant select,insert,update,delete on public."station_health_alerts" to authenticated;
create policy "station_health_alerts_staff_access" on public."station_health_alerts" for ALL to authenticated using (public.app_has_role(array['owner','dispatcher','tech','marketing'])) with check (public.app_has_role(array['owner','dispatcher','tech','marketing']));

do $block$ declare p record; begin for p in select policyname from pg_policies where schemaname='public' and tablename='radar_domain_profiles' loop execute format('drop policy %I on public.%I',p.policyname,'radar_domain_profiles'); end loop; end; $block$;
alter table public."radar_domain_profiles" enable row level security;
revoke all on public."radar_domain_profiles" from authenticated;
grant select on public."radar_domain_profiles" to authenticated;
create policy "radar_domain_profiles_staff_read" on public."radar_domain_profiles" for SELECT to authenticated using (public.app_has_role(array['owner','dispatcher','marketing']));

do $block$ declare p record; begin for p in select policyname from pg_policies where schemaname='public' and tablename='radar_domains' loop execute format('drop policy %I on public.%I',p.policyname,'radar_domains'); end loop; end; $block$;
alter table public."radar_domains" enable row level security;
revoke all on public."radar_domains" from authenticated;
grant select on public."radar_domains" to authenticated;
create policy "radar_domains_staff_read" on public."radar_domains" for SELECT to authenticated using (public.app_has_role(array['owner','dispatcher','marketing']));

do $block$ declare p record; begin for p in select policyname from pg_policies where schemaname='public' and tablename='radar_keywords' loop execute format('drop policy %I on public.%I',p.policyname,'radar_keywords'); end loop; end; $block$;
alter table public."radar_keywords" enable row level security;
revoke all on public."radar_keywords" from authenticated;
grant select on public."radar_keywords" to authenticated;
create policy "radar_keywords_staff_read" on public."radar_keywords" for SELECT to authenticated using (public.app_has_role(array['owner','dispatcher','marketing']));

do $block$ declare p record; begin for p in select policyname from pg_policies where schemaname='public' and tablename='radar_rankings' loop execute format('drop policy %I on public.%I',p.policyname,'radar_rankings'); end loop; end; $block$;
alter table public."radar_rankings" enable row level security;
revoke all on public."radar_rankings" from authenticated;
grant select on public."radar_rankings" to authenticated;
create policy "radar_rankings_staff_read" on public."radar_rankings" for SELECT to authenticated using (public.app_has_role(array['owner','dispatcher','marketing']));

do $block$ declare p record; begin for p in select policyname from pg_policies where schemaname='public' and tablename='radar_scan_runs' loop execute format('drop policy %I on public.%I',p.policyname,'radar_scan_runs'); end loop; end; $block$;
alter table public."radar_scan_runs" enable row level security;
revoke all on public."radar_scan_runs" from authenticated;
grant select on public."radar_scan_runs" to authenticated;
create policy "radar_scan_runs_staff_read" on public."radar_scan_runs" for SELECT to authenticated using (public.app_has_role(array['owner','dispatcher','marketing']));

do $block$ declare p record; begin for p in select policyname from pg_policies where schemaname='public' and tablename='radar_serp_snapshots' loop execute format('drop policy %I on public.%I',p.policyname,'radar_serp_snapshots'); end loop; end; $block$;
alter table public."radar_serp_snapshots" enable row level security;
revoke all on public."radar_serp_snapshots" from authenticated;
grant select on public."radar_serp_snapshots" to authenticated;
create policy "radar_serp_snapshots_staff_read" on public."radar_serp_snapshots" for SELECT to authenticated using (public.app_has_role(array['owner','dispatcher','marketing']));

drop policy if exists "ops_batch_invoice_entries_read" on public."ops_batch_invoice_entries";
create policy "ops_batch_invoice_entries_read" on public."ops_batch_invoice_entries" for SELECT to authenticated using (public.app_has_role(array['admin', 'dispatcher', 'marketing', 'owner', 'tech']));

drop policy if exists "ops_batch_invoice_entries_write" on public."ops_batch_invoice_entries";
create policy "ops_batch_invoice_entries_write" on public."ops_batch_invoice_entries" for ALL to authenticated using (public.app_has_role(array['admin', 'dispatcher', 'owner'])) with check (public.app_has_role(array['admin', 'dispatcher', 'owner']));

drop policy if exists "ops_batch_invoices_read" on public."ops_batch_invoices";
create policy "ops_batch_invoices_read" on public."ops_batch_invoices" for SELECT to authenticated using (public.app_has_role(array['admin', 'dispatcher', 'marketing', 'owner', 'tech']));

drop policy if exists "ops_batch_invoices_write" on public."ops_batch_invoices";
create policy "ops_batch_invoices_write" on public."ops_batch_invoices" for ALL to authenticated using (public.app_has_role(array['admin', 'dispatcher', 'owner'])) with check (public.app_has_role(array['admin', 'dispatcher', 'owner']));

drop policy if exists "ops_calendar_events_read" on public."ops_calendar_events";
create policy "ops_calendar_events_read" on public."ops_calendar_events" for SELECT to authenticated using (public.app_has_role(array['admin', 'dispatcher', 'marketing', 'owner', 'tech']));

drop policy if exists "ops_calendar_events_write" on public."ops_calendar_events";
create policy "ops_calendar_events_write" on public."ops_calendar_events" for ALL to authenticated using (public.app_has_role(array['admin', 'dispatcher', 'owner'])) with check (public.app_has_role(array['admin', 'dispatcher', 'owner']));

drop policy if exists "ops_email_log_read" on public."ops_email_log";
create policy "ops_email_log_read" on public."ops_email_log" for SELECT to authenticated using (public.app_has_role(array['admin', 'dispatcher', 'marketing', 'owner', 'tech']));

drop policy if exists "ops_recurrence_rules_read" on public."ops_recurrence_rules";
create policy "ops_recurrence_rules_read" on public."ops_recurrence_rules" for SELECT to authenticated using (public.app_has_role(array['admin', 'dispatcher', 'marketing', 'owner', 'tech']));

drop policy if exists "ops_recurrence_rules_write" on public."ops_recurrence_rules";
create policy "ops_recurrence_rules_write" on public."ops_recurrence_rules" for ALL to authenticated using (public.app_has_role(array['admin', 'dispatcher', 'owner'])) with check (public.app_has_role(array['admin', 'dispatcher', 'owner']));

drop policy if exists "ops_recurring_templates_read" on public."ops_recurring_templates";
create policy "ops_recurring_templates_read" on public."ops_recurring_templates" for SELECT to authenticated using (public.app_has_role(array['admin', 'dispatcher', 'marketing', 'owner', 'tech']));

drop policy if exists "ops_recurring_templates_write" on public."ops_recurring_templates";
create policy "ops_recurring_templates_write" on public."ops_recurring_templates" for ALL to authenticated using (public.app_has_role(array['admin', 'dispatcher', 'owner'])) with check (public.app_has_role(array['admin', 'dispatcher', 'owner']));

drop policy if exists "promotional_posts_read" on public."promotional_posts";
create policy "promotional_posts_read" on public."promotional_posts" for SELECT to authenticated using (public.app_has_role(array['admin', 'marketing', 'owner']));

drop policy if exists "promotional_posts_write" on public."promotional_posts";
create policy "promotional_posts_write" on public."promotional_posts" for ALL to authenticated using (public.app_has_role(array['admin', 'marketing', 'owner'])) with check (public.app_has_role(array['admin', 'marketing', 'owner']));

drop policy if exists "push_sends_read" on public."push_sends";
create policy "push_sends_read" on public."push_sends" for SELECT to authenticated using (public.app_has_role(array['admin', 'dispatcher', 'marketing', 'owner', 'tech']));

drop policy if exists "push_sends_write" on public."push_sends";
create policy "push_sends_write" on public."push_sends" for ALL to authenticated using (public.app_has_role(array['admin', 'owner'])) with check (public.app_has_role(array['admin', 'owner']));

drop policy if exists "social_post_drafts_read" on public."social_post_drafts";
create policy "social_post_drafts_read" on public."social_post_drafts" for SELECT to authenticated using (public.app_has_role(array['admin', 'marketing', 'owner']));

drop policy if exists "social_post_drafts_write" on public."social_post_drafts";
create policy "social_post_drafts_write" on public."social_post_drafts" for ALL to authenticated using (public.app_has_role(array['admin', 'marketing', 'owner'])) with check (public.app_has_role(array['admin', 'marketing', 'owner']));

drop policy if exists "gps_visits_own_read" on public."gps_appointment_visits";
create policy "gps_visits_own_read" on public."gps_appointment_visits" for SELECT to authenticated using ((((shift_id IN ( SELECT gps_shifts.id
   FROM gps_shifts
  WHERE (gps_shifts.user_id = auth.uid()))) OR app_has_role(ARRAY['owner'::text, 'dispatcher'::text]))) and public.app_has_role(array['owner','dispatcher','tech','marketing']));

drop policy if exists "gps_visits_own_write" on public."gps_appointment_visits";
create policy "gps_visits_own_write" on public."gps_appointment_visits" for ALL to authenticated using ((((shift_id IN ( SELECT gps_shifts.id
   FROM gps_shifts
  WHERE (gps_shifts.user_id = auth.uid()))) OR app_has_role(ARRAY['owner'::text, 'dispatcher'::text]))) and public.app_has_role(array['owner','dispatcher','tech','marketing'])) with check ((((shift_id IN ( SELECT gps_shifts.id
   FROM gps_shifts
  WHERE (gps_shifts.user_id = auth.uid()))) OR app_has_role(ARRAY['owner'::text, 'dispatcher'::text]))) and public.app_has_role(array['owner','dispatcher','tech','marketing']));

drop policy if exists "gps_points_own_insert" on public."gps_points";
create policy "gps_points_own_insert" on public."gps_points" for INSERT to authenticated with check (((shift_id IN ( SELECT gps_shifts.id
   FROM gps_shifts
  WHERE (gps_shifts.user_id = auth.uid())))) and public.app_has_role(array['owner','dispatcher','tech','marketing']));

drop policy if exists "gps_points_own_read" on public."gps_points";
create policy "gps_points_own_read" on public."gps_points" for SELECT to authenticated using ((((shift_id IN ( SELECT gps_shifts.id
   FROM gps_shifts
  WHERE (gps_shifts.user_id = auth.uid()))) OR app_has_role(ARRAY['owner'::text, 'dispatcher'::text]))) and public.app_has_role(array['owner','dispatcher','tech','marketing']));

drop policy if exists "gps_shifts_own_insert" on public."gps_shifts";
create policy "gps_shifts_own_insert" on public."gps_shifts" for INSERT to authenticated with check (((auth.uid() = user_id)) and public.app_has_role(array['owner','dispatcher','tech','marketing']));

drop policy if exists "gps_shifts_own_read" on public."gps_shifts";
create policy "gps_shifts_own_read" on public."gps_shifts" for SELECT to authenticated using ((((auth.uid() = user_id) OR app_has_role(ARRAY['owner'::text, 'dispatcher'::text]))) and public.app_has_role(array['owner','dispatcher','tech','marketing']));

drop policy if exists "gps_shifts_own_update" on public."gps_shifts";
create policy "gps_shifts_own_update" on public."gps_shifts" for UPDATE to authenticated using ((((auth.uid() = user_id) OR app_has_role(ARRAY['owner'::text, 'dispatcher'::text]))) and public.app_has_role(array['owner','dispatcher','tech','marketing'])) with check ((((auth.uid() = user_id) OR app_has_role(ARRAY['owner'::text, 'dispatcher'::text]))) and public.app_has_role(array['owner','dispatcher','tech','marketing']));

drop policy if exists "owner_dispatcher_full_access" on public."staff_daily_availability";
create policy "owner_dispatcher_full_access" on public."staff_daily_availability" for ALL to authenticated using (((EXISTS ( SELECT 1
   FROM staff_users
  WHERE ((staff_users.user_id = auth.uid()) AND (staff_users.role = ANY (ARRAY['owner'::text, 'dispatcher'::text])))))) and public.app_has_role(array['owner','dispatcher','tech','marketing'])) with check (((EXISTS ( SELECT 1
   FROM staff_users
  WHERE ((staff_users.user_id = auth.uid()) AND (staff_users.role = ANY (ARRAY['owner'::text, 'dispatcher'::text])))))) and public.app_has_role(array['owner','dispatcher','tech','marketing']));

drop policy if exists "tech_read_own" on public."staff_daily_availability";
create policy "tech_read_own" on public."staff_daily_availability" for SELECT to authenticated using (((staff_user_id IN ( SELECT staff_users.id
   FROM staff_users
  WHERE (staff_users.user_id = auth.uid())))) and public.app_has_role(array['owner','dispatcher','tech','marketing']));

drop policy if exists "Ops users can read own staff profile" on public."staff_users";
create policy "Ops users can read own staff profile" on public."staff_users" for SELECT to authenticated using ((((auth.uid() = user_id) OR app_has_role(ARRAY['owner'::text, 'dispatcher'::text]))) and public.app_has_role(array['owner','dispatcher','tech','marketing']));

drop policy if exists "Owner can manage staff users" on public."staff_users";
create policy "Owner can manage staff users" on public."staff_users" for ALL to authenticated using ((app_has_role(ARRAY['owner'::text])) and public.app_has_role(array['owner','dispatcher','tech','marketing'])) with check ((app_has_role(ARRAY['owner'::text])) and public.app_has_role(array['owner','dispatcher','tech','marketing']));

-- Public intake uses validated server routes; public catalogs remain readable.
drop policy if exists "Admins can manage lead source options" on public.lead_source_options;
drop policy if exists "Public can read active public lead source options" on public.lead_source_options;
create policy "Public can read active public lead source options" on public.lead_source_options for select to anon,authenticated using(is_active=true and is_public=true);
create policy "Admins can manage lead source options" on public.lead_source_options for all to authenticated using(public.app_has_role(array['owner'])) with check(public.app_has_role(array['owner']));
grant select on public.lead_source_options to anon,authenticated;
alter view public."ops_invoice_payment_totals" set (security_invoker=true);
revoke all on public."ops_invoice_payment_totals" from public,anon,authenticated;
alter view public."reactivation_template_results" set (security_invoker=true);
revoke all on public."reactivation_template_results" from public,anon,authenticated;
alter view public."restoration_equipment_billing" set (security_invoker=true);
revoke all on public."restoration_equipment_billing" from public,anon,authenticated;
alter function public.update_conversations_updated_at() set search_path=public,pg_temp;
alter function public.restoration_estimate_line_sync() set search_path=public,pg_temp;
alter function public.set_ranger_updated_at() set search_path=public,pg_temp;
alter function public.fn_log_deleted_record() set search_path=public,pg_temp;
alter function public.backfill_call_log_recordings() set search_path=public,pg_temp;
alter function public.tg_normalize_customer_name_case() set search_path=public,pg_temp;
alter function public.tg_normalize_address_case() set search_path=public,pg_temp;
alter function public.restoration_equipment_days() set search_path=public,pg_temp;
alter function public.normalize_name_case(text) set search_path=public,pg_temp;
alter function public.restoration_reading_taken_at() set search_path=public,pg_temp;
revoke all on function public.attribute_reactivation_click() from public,anon,authenticated;
grant execute on function public.attribute_reactivation_click() to service_role;
revoke all on function public.backfill_call_log_recordings() from public,anon,authenticated;
grant execute on function public.backfill_call_log_recordings() to service_role;
revoke all on function public.cleanup_orphan_plan_nodes() from public,anon,authenticated;
grant execute on function public.cleanup_orphan_plan_nodes() to service_role;
revoke all on function public.increment_promo_use_count(uuid) from public,anon,authenticated;
grant execute on function public.increment_promo_use_count(uuid) to service_role;
revoke all on function public.link_customer_media_by_phone() from public,anon,authenticated;
grant execute on function public.link_customer_media_by_phone() to service_role;
revoke all on function public.notify_appointment_booked() from public,anon,authenticated;
grant execute on function public.notify_appointment_booked() to service_role;
revoke all on function public.sync_restoration_quoted_total() from public,anon,authenticated;
grant execute on function public.sync_restoration_quoted_total() to service_role;

-- Only staff can upload directly. Existing public images remain publicly readable;
-- private customer-media/restoration/commercial buckets receive no new policies.
drop policy if exists "Anyone can upload sighting images" on storage.objects;
drop policy if exists "Authenticated users can upload images" on storage.objects;
create policy "Staff can upload public business images" on storage.objects for insert to authenticated
with check(bucket_id in ('job-images','sighting-images') and public.app_has_role(array['owner','dispatcher','tech','marketing']));

-- Opt future postgres-owned application objects into explicit browser access.
-- Do not modify managed Supabase owner defaults or recreate nonrelocatable pg_net.
alter default privileges for role postgres in schema public revoke all on tables from anon,authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon,authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from anon,authenticated;
alter default privileges for role postgres revoke execute on functions from public;
