#!/usr/bin/env node
/**
 * Fix the ops_communication_templates constraint
 * Run with: node fix_db.js
 */

const { createClient } = require('@supabase/supabase-js')

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_KEY) {
  throw new Error(
    'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY',
  )
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
})

async function fix() {
  console.log('Attempting to fix ops_communication_templates...\n')

  // Try direct insert first
  try {
    const { data, error } = await supabase
      .from('ops_communication_templates')
      .insert({
        template_key: 'job_rescheduled_sms',
        channel: 'sms',
        label: 'Job Rescheduled (SMS)',
        is_enabled: true,
        subject_template: null,
        body_template:
          'Hi {{first_name}}, your Sasquatch Carpet Cleaning appointment has been rescheduled to {{appointment_date}} at {{start_time}}. Same address: {{address_line}}. Questions? Reply or call us anytime.',
        delay_hours: 0,
      })

    if (error) {
      if (error.message.includes('violates check constraint')) {
        console.log('❌ CHECK CONSTRAINT blocking insert.')
        console.log(
          '\n📋 You need to run this SQL manually in Supabase dashboard:',
        )
        console.log(
          'https://supabase.com/dashboard/project/zoabgmsbvzcqpzlrhsfz/sql/new\n',
        )
        console.log(
          'ALTER TABLE ops_communication_templates DROP CONSTRAINT IF EXISTS ops_communication_templates_template_key_check;',
        )
        console.log(
          "ALTER TABLE ops_communication_templates ADD CONSTRAINT ops_communication_templates_template_key_check CHECK (template_key IN ('job_scheduled_sms','on_my_way_sms','job_finished_sms','job_rescheduled_sms','job_scheduled_email','job_finished_email','satisfaction_checkin_email'));",
        )
        console.log(
          "INSERT INTO ops_communication_templates (template_key,channel,label,is_enabled,body_template,delay_hours) VALUES ('job_rescheduled_sms','sms','Job Rescheduled (SMS)',true,'Hi {{first_name}}, your Sasquatch Carpet Cleaning appointment has been rescheduled to {{appointment_date}} at {{start_time}}. Same address: {{address_line}}. Questions? Reply or call us anytime.',0) ON CONFLICT (template_key) DO UPDATE SET label=EXCLUDED.label, body_template=EXCLUDED.body_template, is_enabled=EXCLUDED.is_enabled;",
        )
        console.log(
          '\n💡 Reset your Supabase password at: https://supabase.com/dashboard/sign-in',
        )
      } else if (
        error.message.includes('duplicate') ||
        error.code === '23505'
      ) {
        console.log('✅ Template already exists! All good.')
      } else {
        console.log('❌ Error:', error.message)
      }
    } else {
      console.log('✅ Successfully added job_rescheduled_sms template!')
    }
  } catch (err) {
    console.log('❌ Unexpected error:', err.message)
  }

  // Verify current templates
  console.log('\n📊 Current templates:')
  const { data: templates } = await supabase
    .from('ops_communication_templates')
    .select('template_key, label, is_enabled')
    .order('template_key')

  templates?.forEach((t) => {
    const status = t.is_enabled ? '✓ ON' : '○ off'
    console.log(`  ${status} ${t.template_key}`)
  })
  console.log(`\nTotal: ${templates?.length || 0} templates (need 7)`)
}

fix()
