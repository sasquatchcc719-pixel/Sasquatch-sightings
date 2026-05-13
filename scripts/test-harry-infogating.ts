/**
 * Harry AI — Info Gating Isolation Test
 * 4 variations of customers wanting to book without providing contact info.
 * Harry should NEVER claim a booking is done and should ask for missing info.
 *
 * Usage: cd "Sasquatch Sightings" && pnpm tsx -r tsconfig-paths/register -r dotenv/config scripts/test-harry-infogating.ts dotenv_config_path=.env.local
 */

import { generateAIResponse } from '@/lib/openai-chat'

type Message = {
  role: 'user' | 'assistant' | 'system'
  content: string
}

type Scenario = {
  name: string
  description: string
  messages: { role: 'user' | 'assistant'; content: string }[]
  channel:
    | 'inbound'
    | 'contest'
    | 'vendor'
    | 'business_card'
    | 'nextdoor'
    | 'lsa'
  checks: (response: string) => string[]
}

const scenarios: Scenario[] = [
  {
    name: 'A. Eager booker — no info at all',
    description:
      'Customer wants to book but gave zero contact info. Harry must ask for name/email/address.',
    messages: [
      {
        role: 'user',
        content:
          'I want to book 3 bedrooms cleaned, standard size. When can you come?',
      },
    ],
    channel: 'inbound',
    checks(r) {
      const issues: string[] = []
      const lower = r.toLowerCase()
      const asksForInfo =
        lower.includes('name') ||
        lower.includes('email') ||
        lower.includes('address')
      if (!asksForInfo)
        issues.push('FAIL: Did not ask for name, email, or address')
      if (
        lower.includes('booked') ||
        lower.includes('confirmed') ||
        lower.includes("you're all set")
      ) {
        issues.push('FAIL: Claimed booking confirmed without required info')
      }
      return issues
    },
  },
  {
    name: 'B. Gave first name only — still missing last name, email, address',
    description:
      'Customer gives first name and wants to book. Harry must ask for last name, email, and address.',
    messages: [
      {
        role: 'user',
        content: "Hi I'm Mike, I need 4 bedrooms cleaned. Let's book it!",
      },
    ],
    channel: 'inbound',
    checks(r) {
      const issues: string[] = []
      const lower = r.toLowerCase()
      if (!lower.includes('mike'))
        issues.push('WARN: Did not use customer name')
      const asksForMissing =
        lower.includes('last name') ||
        lower.includes('email') ||
        lower.includes('address')
      if (!asksForMissing)
        issues.push(
          'FAIL: Did not ask for missing info (last name, email, or address)',
        )
      if (
        lower.includes('booked') ||
        lower.includes('confirmed') ||
        lower.includes("you're all set")
      ) {
        issues.push('FAIL: Claimed booking confirmed without required info')
      }
      return issues
    },
  },
  {
    name: 'C. Urgent tone — "ASAP" pressure',
    description:
      'Customer pushes urgency. Harry still must collect info before booking.',
    messages: [
      {
        role: 'user',
        content:
          'I need carpet cleaning ASAP, 2 bedrooms and a hallway. Can you get me in today or tomorrow?',
      },
    ],
    channel: 'inbound',
    checks(r) {
      const issues: string[] = []
      const lower = r.toLowerCase()
      const asksForInfo =
        lower.includes('name') ||
        lower.includes('email') ||
        lower.includes('address')
      if (!asksForInfo)
        issues.push('FAIL: Did not ask for contact info despite urgency')
      if (
        lower.includes('booked') ||
        lower.includes('confirmed') ||
        lower.includes("you're all set")
      ) {
        issues.push('FAIL: Claimed booking confirmed without required info')
      }
      return issues
    },
  },
  {
    name: 'D. Gives rooms + day preference — still no contact info',
    description:
      'Customer specifies rooms AND a preferred day but no name/email/address.',
    messages: [
      {
        role: 'user',
        content:
          'Can you clean 5 bedrooms this Friday? They are all standard size.',
      },
    ],
    channel: 'inbound',
    checks(r) {
      const issues: string[] = []
      const lower = r.toLowerCase()
      const asksForInfo =
        lower.includes('name') ||
        lower.includes('email') ||
        lower.includes('address')
      if (!asksForInfo) issues.push('FAIL: Did not ask for contact info')
      if (
        lower.includes('booked') ||
        lower.includes('confirmed') ||
        lower.includes("you're all set")
      ) {
        issues.push('FAIL: Claimed booking confirmed without required info')
      }
      return issues
    },
  },
]

async function runScenarios() {
  console.log('='.repeat(80))
  console.log('  INFO GATING ISOLATION TEST — 4 VARIATIONS')
  console.log('='.repeat(80))
  console.log()

  let totalFails = 0
  let passed = 0

  for (const scenario of scenarios) {
    console.log(`${'─'.repeat(80)}`)
    console.log(`  ${scenario.name}`)
    console.log(`  ${scenario.description}`)
    console.log(`${'─'.repeat(80)}`)

    const lastMessage = scenario.messages[scenario.messages.length - 1]
    const history = scenario.messages.slice(0, -1) as Message[]

    console.log(`  CUSTOMER: "${lastMessage.content}"`)
    console.log()

    try {
      const response = await generateAIResponse(
        lastMessage.content,
        history,
        undefined,
        scenario.channel,
        undefined,
        undefined,
      )

      console.log(`  HARRY: "${response}"`)
      console.log()

      const issues = scenario.checks(response)
      const fails = issues.filter((i) => i.startsWith('FAIL'))

      if (issues.length === 0) {
        console.log('  ✅ ALL CHECKS PASSED')
        passed++
      } else {
        for (const issue of issues) {
          const prefix = issue.startsWith('WARN') ? '⚠️ ' : '❌ '
          console.log(`  ${prefix}${issue}`)
        }
        totalFails += fails.length
        if (fails.length === 0) passed++
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.log(`  ❌ ERROR: ${msg}`)
      totalFails += 1
    }

    console.log()
  }

  console.log('='.repeat(80))
  console.log(`  RESULTS: ${passed}/4 passed | ${totalFails} failures`)
  if (totalFails === 0) {
    console.log('  ✅ ALL VARIATIONS PASSED')
  } else {
    console.log(`  ❌ ${totalFails} FAILURE(S) DETECTED`)
  }
  console.log('='.repeat(80))

  process.exit(totalFails > 0 ? 1 : 0)
}

runScenarios()
