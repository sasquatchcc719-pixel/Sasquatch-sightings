/**
 * Provision a client_manager portal user.
 * Creates (or reuses) a Supabase auth user and links them to an ops_customers record
 * via ops_client_users. Idempotent.
 *
 * Usage:
 *   node scripts/provision-client-user.mjs --email x@y.com --password 123456 \
 *     --customer <uuid> --name "Lance Johnson" [--must-change]
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

// Load .env.local manually (no dotenv dependency needed)
try {
  const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
    }
  }
} catch {}

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`)
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1]
  return fallback
}

const email = arg('email')
const password = arg('password')
const customerId = arg('customer')
const displayName = arg('name')
const mustChange = process.argv.includes('--must-change')

if (!email || !password || !customerId || !displayName) {
  console.error('Missing required args: --email --password --customer --name')
  process.exit(1)
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function findUserByEmail(targetEmail) {
  // listUsers is paginated; scan for the email
  let page = 1
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw error
    const found = data.users.find(
      (u) => (u.email || '').toLowerCase() === targetEmail.toLowerCase(),
    )
    if (found) return found
    if (data.users.length < 200) return null
    page += 1
  }
}

async function main() {
  // 1. Verify customer exists
  const { data: customer, error: custErr } = await admin
    .from('ops_customers')
    .select('id, business_name, full_name')
    .eq('id', customerId)
    .single()
  if (custErr || !customer) {
    console.error('Customer not found:', customerId, custErr?.message)
    process.exit(1)
  }

  // 2. Create or reuse auth user
  let user = await findUserByEmail(email)
  if (user) {
    console.log('Auth user already exists:', user.id)
    const { error } = await admin.auth.admin.updateUserById(user.id, {
      password,
      email_confirm: true,
      app_metadata: { ...user.app_metadata, must_change_password: mustChange },
    })
    if (error) {
      console.error('Failed to update auth user:', error.message)
      process.exit(1)
    }
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { must_change_password: mustChange },
    })
    if (error || !data.user) {
      console.error('Failed to create auth user:', error?.message)
      process.exit(1)
    }
    user = data.user
    console.log('Created auth user:', user.id)
  }

  // 3. Upsert ops_client_users link
  const { error: linkErr } = await admin.from('ops_client_users').upsert(
    {
      user_id: user.id,
      customer_id: customerId,
      display_name: displayName,
      email,
      is_active: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  )
  if (linkErr) {
    console.error('Failed to link client user:', linkErr.message)
    process.exit(1)
  }

  console.log('✅ Provisioned client_manager')
  console.log('   email:   ', email)
  console.log('   user_id: ', user.id)
  console.log('   customer:', customer.business_name || customer.full_name, `(${customerId})`)
  console.log('   must_change_password:', mustChange)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
