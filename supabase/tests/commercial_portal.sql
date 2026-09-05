-- Run inside a transaction and ROLLBACK. Does not generate appointments or send messages.
DO $$
DECLARE cid uuid; address_id uuid; actor uuid; aid uuid := gen_random_uuid(); plan_id uuid := gen_random_uuid(); v integer;
BEGIN
  SELECT customer_id,id INTO cid,address_id FROM public.ops_service_addresses LIMIT 1;
  SELECT id INTO actor FROM auth.users LIMIT 1;
  IF cid IS NULL OR actor IS NULL THEN RAISE EXCEPTION 'Test requires an existing customer address and auth user'; END IF;
  INSERT INTO public.ops_commercial_agreements(id,customer_id,content,created_by)
    VALUES(aid,cid,'{"title":"Transaction-only verification"}',actor);
  UPDATE public.ops_commercial_agreements SET content='{"title":"Reviewed scope"}' WHERE id=aid;
  SELECT revision INTO v FROM public.ops_commercial_agreements WHERE id=aid;
  IF v <> 2 THEN RAISE EXCEPTION 'Revision did not increment'; END IF;
  BEGIN
    UPDATE public.ops_commercial_agreements SET status='signed' WHERE id=aid;
    RAISE EXCEPTION 'TEST FAILED: draft signing allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'TEST FAILED:%' THEN RAISE; END IF;
  END;
  UPDATE public.ops_commercial_agreements SET status='published',content_hash=repeat('a',64),published_at=now(),published_by=actor WHERE id=aid;
  BEGIN
    UPDATE public.ops_commercial_agreements SET content='{"title":"Tampered"}' WHERE id=aid;
    RAISE EXCEPTION 'TEST FAILED: published editing allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'TEST FAILED:%' THEN RAISE; END IF;
  END;
  UPDATE public.ops_commercial_agreements SET status='signed',signed_by=actor,signed_name='Test',signed_title='Manager',signed_email='test@example.invalid',signed_at=now(),signature_consent='Test consent' WHERE id=aid;
  BEGIN
    UPDATE public.ops_commercial_agreements SET signed_name='Changed' WHERE id=aid;
    RAISE EXCEPTION 'TEST FAILED: signed editing allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'TEST FAILED:%' THEN RAISE; END IF;
  END;
  BEGIN
    DELETE FROM public.ops_commercial_agreements WHERE id=aid;
    RAISE EXCEPTION 'TEST FAILED: signed deletion allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'TEST FAILED:%' THEN RAISE; END IF;
  END;
  PERFORM public.create_commercial_service_plan(plan_id,aid,jsonb_build_object('service_address_id',address_id,'label','Transaction-only test','line_items','[]'::jsonb,'start_time','18:00','scheduled_duration_minutes',120,'invoice_mode','per_visit'),jsonb_build_object('frequency','monthly','day_of_month',15,'effective_from','2030-01-15'));
  PERFORM public.create_commercial_service_plan(plan_id,aid,'{}','{}');
  SELECT count(*) INTO v FROM public.ops_recurrence_rules WHERE template_id=plan_id;
  IF v <> 1 THEN RAISE EXCEPTION 'Idempotent save created duplicate rules'; END IF;
  IF EXISTS(SELECT 1 FROM public.ops_recurring_templates WHERE id=plan_id AND is_active) THEN RAISE EXCEPTION 'Plan must start paused'; END IF;
  IF has_table_privilege('anon','public.ops_commercial_agreements','SELECT') OR has_table_privilege('authenticated','public.ops_commercial_agreements','UPDATE') THEN RAISE EXCEPTION 'Direct client agreement access exposed'; END IF;
  IF has_function_privilege('anon','public.create_commercial_service_plan(uuid,uuid,jsonb,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'Anonymous plan creation exposed'; END IF;
END;
$$;
