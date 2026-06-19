-- Phase 4 teardown — drop the now-dead Harry SMS agent, HarryCommandbot, and
-- Retell/Rabecca voice tables. All reachable code was removed in commits
-- 6010a1e..a754283; verified zero references in src/ and no inbound foreign
-- keys before dropping. Irreversible (Charles approved, decision D4).
--
-- KEPT on purpose (still used by the Analyst/Radar feature, which stays):
--   harry_conversations, harry_memory
-- (named under the harry_ prefix for historical reasons only.)

drop table if exists public.harry_action_ledger          cascade;
drop table if exists public.harry_command_action_audit   cascade;
drop table if exists public.harry_command_artifacts      cascade;
drop table if exists public.harry_command_messages       cascade;
drop table if exists public.harry_command_pending_actions cascade;
drop table if exists public.harry_command_sms_drafts     cascade;
drop table if exists public.harry_command_telegram_updates cascade;
drop table if exists public.harry_command_threads        cascade;
drop table if exists public.harry_control_settings       cascade;
drop table if exists public.harry_knowledge_blocks       cascade;
drop table if exists public.harry_logic_profiles         cascade;
drop table if exists public.harry_next_pending_actions   cascade;
drop table if exists public.harry_workflow_states        cascade;
drop table if exists public.retell_call_logs             cascade;
drop table if exists public.retell_tool_logs             cascade;
