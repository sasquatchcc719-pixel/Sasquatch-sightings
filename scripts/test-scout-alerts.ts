/**
 * Fire each Scout Telegram alert once, so you can confirm they actually land on
 * your phone. Run after changing bot config or env vars:
 *
 *   npx tsx scripts/test-scout-alerts.ts
 *
 * Sends three real messages. They are clearly marked as tests.
 */
import { config as loadEnv } from 'dotenv'

loadEnv({ path: '.env.local' })

async function main() {
  const {
    sendScoutBookingFailureAlert,
    sendScoutEscalationAlert,
    sendScoutPhantomBookingAlert,
  } = await import('../src/lib/telegram')

  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    console.error(
      'TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID are not set — alerts would be silently dropped.',
    )
    process.exit(1)
  }

  const sample = {
    sessionId: 'TEST-SESSION-0000',
    customerName: '[TEST] Jane Doe',
    phone: '+17195551234',
    email: 'test@example.com',
    address: '123 Test St, Monument 80132',
    requestedDate: '2026-09-01',
    requestedTime: '15:00',
    errors: ['This is a test alert — no action needed.'],
    lastCustomerMessage: 'This is a test. Ignore.',
  }

  const results: Array<[string, boolean]> = []

  results.push([
    'phantom booking',
    await sendScoutPhantomBookingAlert({
      ...sample,
      claimedText: "[TEST] You're booked! Confirmation #TESTONLY",
    }),
  ])
  results.push(['booking failure', await sendScoutBookingFailureAlert(sample)])
  results.push([
    'escalation',
    await sendScoutEscalationAlert({
      reason: '[TEST] alert plumbing check',
      customerName: sample.customerName,
      phone: sample.phone,
      notes: 'This is a test alert — no action needed.',
    }),
  ])

  for (const [name, ok] of results) {
    console.log(`${ok ? '✅' : '❌'} ${name}`)
  }

  if (results.some(([, ok]) => !ok)) process.exit(1)
  console.log('\nAll three delivered. Check Telegram.')
}

void main()
