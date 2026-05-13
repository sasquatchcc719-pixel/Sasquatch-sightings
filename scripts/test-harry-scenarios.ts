/**
 * Harry AI Scenario Tests (25 scenarios)
 * Calls generateAIResponse directly against real OpenAI + Supabase
 * to verify Harry handles common customer interactions correctly.
 *
 * Usage: cd "Sasquatch Sightings" && pnpm tsx -r tsconfig-paths/register -r dotenv/config scripts/test-harry-scenarios.ts dotenv_config_path=.env.local
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
  // ─── PRICING MATH ────────────────────────────────────────────────────
  {
    name: '1. Multi-room pricing — 5 bedrooms',
    description: '5 × $46 = $230. Must NOT combine sqft into one tier.',
    messages: [
      {
        role: 'user',
        content:
          'Hi, how much to clean 5 bedrooms? They are all standard size, about 150 sq ft each.',
      },
    ],
    channel: 'inbound',
    checks(r) {
      const issues: string[] = []
      if (!r.includes('230')) issues.push('FAIL: Expected $230 (5×$46)')
      if (r.includes('138'))
        issues.push('FAIL: Used Monster tier — combined sqft across rooms')
      if (r.toLowerCase().includes('minimum'))
        issues.push('FAIL: Mentioned minimum when total exceeds $150')
      return issues
    },
  },
  {
    name: '2. Multi-room pricing — 2 bedrooms',
    description: '2 × $46 = $92. Must mention $150 minimum.',
    messages: [
      {
        role: 'user',
        content: 'How much for 2 bedrooms? About 150 sq ft each.',
      },
    ],
    channel: 'inbound',
    checks(r) {
      const issues: string[] = []
      if (!r.includes('92')) issues.push('FAIL: Expected $92 (2×$46)')
      if (!r.includes('150') || !r.toLowerCase().includes('minimum'))
        issues.push('FAIL: Must mention $150 minimum when total < $150')
      return issues
    },
  },
  {
    name: '3. Single bedroom — under minimum',
    description: '$46 for 1 room. Must mention $150 minimum.',
    messages: [
      { role: 'user', content: 'How much for one bedroom? About 150 sq ft.' },
    ],
    channel: 'inbound',
    checks(r) {
      const issues: string[] = []
      if (!r.includes('46'))
        issues.push('FAIL: Expected $46 for standard bedroom')
      if (!r.includes('150') || !r.toLowerCase().includes('minimum'))
        issues.push('FAIL: Must mention $150 minimum')
      return issues
    },
  },
  {
    name: '4. Large living room pricing',
    description:
      'Customer gives 350 sqft. Should quote $90 (Sasquatch size), not $46.',
    messages: [
      {
        role: 'user',
        content: 'My living room is about 350 square feet. How much?',
      },
    ],
    channel: 'inbound',
    checks(r) {
      const issues: string[] = []
      if (!r.includes('90'))
        issues.push('FAIL: Expected $90 for 350 sqft (Sasquatch tier)')
      if (r.includes('46'))
        issues.push('FAIL: Quoted $46 (Regular tier) for a 350 sqft room')
      return issues
    },
  },
  {
    name: '5. Stairs pricing',
    description: '15 steps × $4 = $60. Must mention $150 minimum.',
    messages: [
      { role: 'user', content: 'I need my stairs cleaned. 15 steps.' },
    ],
    channel: 'inbound',
    checks(r) {
      const issues: string[] = []
      if (!r.includes('60')) issues.push('FAIL: Expected $60 (15×$4)')
      if (!r.includes('150') || !r.toLowerCase().includes('minimum'))
        issues.push('FAIL: Must mention $150 minimum when total < $150')
      return issues
    },
  },
  {
    name: '6. Above-minimum — no minimum mention',
    description: '4 bedrooms = $184. Must NOT mention minimum.',
    messages: [
      {
        role: 'user',
        content: 'How much for 4 standard bedrooms? All under 200 sq ft.',
      },
    ],
    channel: 'inbound',
    checks(r) {
      const issues: string[] = []
      if (!r.includes('184')) issues.push('FAIL: Expected $184 (4×$46)')
      if (r.toLowerCase().includes('minimum'))
        issues.push('FAIL: Mentioned minimum when total ($184) exceeds $150')
      return issues
    },
  },

  // ─── UPHOLSTERY & SPECIALTY ──────────────────────────────────────────
  {
    name: '7. Sectional pricing — $50/seat',
    description: 'Must quote $50/seat and ask how many seats.',
    messages: [
      { role: 'user', content: 'How much to clean my sectional couch?' },
    ],
    channel: 'inbound',
    checks(r) {
      const issues: string[] = []
      const lower = r.toLowerCase()
      if (!r.includes('50')) issues.push('FAIL: Did not mention $50 per seat')
      if (
        !lower.includes('seat') &&
        !lower.includes('section') &&
        !lower.includes('cushion')
      ) {
        issues.push('FAIL: Did not ask about number of seats')
      }
      if (r.includes('15') && lower.includes('linear'))
        issues.push('FAIL: Used old $15/linear foot pricing')
      return issues
    },
  },
  {
    name: '8. Leather chair — under minimum',
    description: 'Leather chair = $99. Must mention $150 minimum.',
    messages: [{ role: 'user', content: 'How much to clean a leather chair?' }],
    channel: 'inbound',
    checks(r) {
      const issues: string[] = []
      if (!r.includes('99')) issues.push('FAIL: Expected $99 for leather chair')
      if (!r.includes('150') || !r.toLowerCase().includes('minimum'))
        issues.push('FAIL: Must mention $150 minimum when total < $150')
      return issues
    },
  },
  {
    name: '9. Tile & grout pricing',
    description: 'Must quote $0.80/sqft and ask for size.',
    messages: [
      { role: 'user', content: 'How much for tile and grout cleaning?' },
    ],
    channel: 'inbound',
    checks(r) {
      const issues: string[] = []
      const lower = r.toLowerCase()
      if (!r.includes('80') && !r.includes('0.80') && !lower.includes('cent')) {
        issues.push('FAIL: Did not mention $0.80/sqft pricing')
      }
      if (
        !lower.includes('sq') &&
        !lower.includes('size') &&
        !lower.includes('how big') &&
        !lower.includes('how many')
      ) {
        issues.push('FAIL: Did not ask for square footage or size')
      }
      return issues
    },
  },

  // ─── INFO GATING & BOOKING FLOW ─────────────────────────────────────
  {
    name: '10. Info gating — wants to book without providing info',
    description: 'Must ask for missing info, NOT claim booking is done.',
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
        lower.includes('address') ||
        lower.includes('sq ft') ||
        lower.includes('square') ||
        lower.includes('size')
      if (!asksForInfo) issues.push('FAIL: Did not ask for any missing info')
      if (lower.includes('booked') || lower.includes('confirmed'))
        issues.push('FAIL: Claimed booking confirmed without required info')
      return issues
    },
  },
  {
    name: '11. Vague message — must ask for details',
    description:
      'Customer says "I need carpet cleaning" with no details. Harry must ask what/how many.',
    messages: [{ role: 'user', content: 'I need my carpets cleaned.' }],
    channel: 'inbound',
    checks(r) {
      const issues: string[] = []
      const lower = r.toLowerCase()
      if (
        !lower.includes('how many') &&
        !lower.includes('room') &&
        !lower.includes('what') &&
        !lower.includes('area') &&
        !lower.includes('size')
      ) {
        issues.push('FAIL: Did not ask about rooms, areas, or sizes')
      }
      if (r.includes('$'))
        issues.push('FAIL: Quoted a price without knowing any details')
      return issues
    },
  },
  {
    name: '12. Must not assume living room size',
    description:
      'Customer says "living room" without size. Harry must ask for sqft.',
    messages: [{ role: 'user', content: 'How much to clean my living room?' }],
    channel: 'inbound',
    checks(r) {
      const issues: string[] = []
      const lower = r.toLowerCase()
      if (
        !lower.includes('sq') &&
        !lower.includes('size') &&
        !lower.includes('how big') &&
        !lower.includes('square')
      ) {
        issues.push('FAIL: Did not ask for square footage of living room')
      }
      return issues
    },
  },

  // ─── CHANNEL-SPECIFIC ────────────────────────────────────────────────
  {
    name: '13. NFC card — partner recognition + $20 discount',
    description:
      'Vendor channel. Must acknowledge partner and mention $20 off.',
    messages: [
      {
        role: 'user',
        content:
          "Hey I found your card at Tony's Barbershop and I'm interested in getting my carpets cleaned",
      },
    ],
    channel: 'vendor',
    checks(r) {
      const issues: string[] = []
      const lower = r.toLowerCase()
      if (
        !lower.includes('barbershop') &&
        !lower.includes('tony') &&
        !lower.includes('card')
      ) {
        issues.push('FAIL: Did not acknowledge partner location')
      }
      if (!lower.includes('20') && !lower.includes('discount'))
        issues.push('FAIL: Did not mention $20 discount')
      return issues
    },
  },
  {
    name: '14. LSA lead — must ask for callback phone',
    description:
      'Google LSA channel. Must ask for phone number early in conversation.',
    messages: [
      {
        role: 'user',
        content: 'Hi, I need 3 bedrooms cleaned. My name is Sarah Johnson.',
      },
    ],
    channel: 'lsa',
    checks(r) {
      const issues: string[] = []
      const lower = r.toLowerCase()
      if (
        !lower.includes('phone') &&
        !lower.includes('number') &&
        !lower.includes('reach you') &&
        !lower.includes('call')
      ) {
        issues.push(
          'FAIL: Did not ask for callback phone number (required for LSA)',
        )
      }
      return issues
    },
  },

  // ─── COMMERCIAL ROUTING ──────────────────────────────────────────────
  {
    name: '15. Commercial — dental office',
    description: 'Must route to walkthrough, NOT quote residential pricing.',
    messages: [
      {
        role: 'user',
        content:
          'Hi, I manage a dental office and we need our carpets cleaned. About 2000 sq ft total.',
      },
    ],
    channel: 'inbound',
    checks(r) {
      const issues: string[] = []
      const lower = r.toLowerCase()
      if (
        !lower.includes('walkthrough') &&
        !lower.includes('walk-through') &&
        !lower.includes('come out') &&
        !lower.includes('comes out') &&
        !lower.includes('on-site') &&
        !lower.includes('in person') &&
        !lower.includes('measure') &&
        !lower.includes('free estimate')
      ) {
        issues.push('FAIL: Did not offer commercial walkthrough')
      }
      if (r.includes('$46') || r.includes('$90') || r.includes('$138')) {
        issues.push('FAIL: Quoted residential pricing for commercial')
      }
      return issues
    },
  },
  {
    name: '16. Commercial — church',
    description: 'Church = commercial. Must route to walkthrough.',
    messages: [
      {
        role: 'user',
        content:
          "I'm the facilities manager at Grace Community Church. We need all the carpet in the fellowship hall cleaned.",
      },
    ],
    channel: 'inbound',
    checks(r) {
      const issues: string[] = []
      const lower = r.toLowerCase()
      if (
        !lower.includes('walkthrough') &&
        !lower.includes('walk-through') &&
        !lower.includes('come out') &&
        !lower.includes('comes out') &&
        !lower.includes('on-site') &&
        !lower.includes('measure') &&
        !lower.includes('free estimate')
      ) {
        issues.push('FAIL: Did not offer commercial walkthrough for church')
      }
      if (r.includes('$46') || r.includes('$90'))
        issues.push('FAIL: Quoted residential pricing')
      return issues
    },
  },
  {
    name: '17. Residential — big house is NOT commercial',
    description: 'Big house should NOT get routed to commercial walkthrough.',
    messages: [
      {
        role: 'user',
        content:
          'I have a really big house, like 5000 sq ft. Can someone come out and give me an estimate?',
      },
    ],
    channel: 'inbound',
    checks(r) {
      const issues: string[] = []
      const lower = r.toLowerCase()
      if (lower.includes('walkthrough') || lower.includes('commercial')) {
        issues.push('FAIL: Routed residential to commercial walkthrough')
      }
      return issues
    },
  },

  // ─── ESCALATION & SAFETY ─────────────────────────────────────────────
  {
    name: '18. Cancellation — never cancel',
    description: 'Must NOT cancel. Must flag for Charles.',
    messages: [
      {
        role: 'assistant',
        content:
          "Hi! I'm Harry, Charles's assistant at Sasquatch Carpet Cleaning. You're all set for May 20 at 10:00 AM!",
      },
      { role: 'user', content: 'Actually I need to cancel my appointment.' },
    ],
    channel: 'inbound',
    checks(r) {
      const issues: string[] = []
      const lower = r.toLowerCase()
      if (
        lower.includes("i've cancelled") ||
        lower.includes("i've canceled") ||
        lower.includes('has been cancelled') ||
        lower.includes('has been canceled')
      ) {
        issues.push('FAIL: Claimed to have cancelled')
      }
      if (
        !lower.includes('charles') &&
        !lower.includes('flag') &&
        !lower.includes('owner')
      ) {
        issues.push('FAIL: Did not flag for Charles')
      }
      return issues
    },
  },
  {
    name: '19. Angry customer — escalation',
    description: 'Must empathize and escalate. Must NOT promise refund.',
    messages: [
      {
        role: 'user',
        content:
          'You guys cleaned my carpet last week and it still looks terrible. There are stains everywhere. I want a refund!',
      },
    ],
    channel: 'inbound',
    checks(r) {
      const issues: string[] = []
      const lower = r.toLowerCase()
      if (
        !lower.includes('sorry') &&
        !lower.includes('apologize') &&
        !lower.includes('understand')
      ) {
        issues.push('FAIL: Did not show empathy')
      }
      if (!lower.includes('charles') && !lower.includes('owner'))
        issues.push('FAIL: Did not escalate to Charles')
      return issues
    },
  },
  {
    name: '20. Water emergency — immediate escalation',
    description: 'Must escalate immediately for water emergency.',
    messages: [
      {
        role: 'user',
        content:
          'My basement is flooding! A pipe burst and there is standing water everywhere. Can you help?',
      },
    ],
    channel: 'inbound',
    checks(r) {
      const issues: string[] = []
      const lower = r.toLowerCase()
      if (
        !lower.includes('emergency') &&
        !lower.includes('restoration') &&
        !lower.includes('flag') &&
        !lower.includes('immediately') &&
        !lower.includes('urgent')
      ) {
        issues.push('FAIL: Did not treat as emergency')
      }
      return issues
    },
  },

  // ─── FAQ & KNOWLEDGE ─────────────────────────────────────────────────
  {
    name: '21. Carpet protector — banned in Colorado',
    description: 'Must explain Scotchgard is banned. Must NOT offer it.',
    messages: [
      {
        role: 'user',
        content: 'Do you offer carpet protector or Scotchgard after cleaning?',
      },
    ],
    channel: 'inbound',
    checks(r) {
      const issues: string[] = []
      const lower = r.toLowerCase()
      if (
        !lower.includes('ban') &&
        !lower.includes('colorado') &&
        !lower.includes('regulation') &&
        !lower.includes('pfas') &&
        !lower.includes("can't") &&
        !lower.includes('cannot') &&
        !lower.includes("don't") &&
        !lower.includes('not available') &&
        !lower.includes('no longer')
      ) {
        issues.push(
          'FAIL: Did not explain carpet protector is unavailable in Colorado',
        )
      }
      return issues
    },
  },
  {
    name: '22. Company experience question',
    description: 'Must answer with 20+ years and certifications.',
    messages: [
      {
        role: 'user',
        content:
          'How long have you guys been cleaning carpets? Are you certified?',
      },
    ],
    channel: 'inbound',
    checks(r) {
      const issues: string[] = []
      const lower = r.toLowerCase()
      if (
        !lower.includes('20') &&
        !lower.includes('2004') &&
        !lower.includes('years')
      ) {
        issues.push('FAIL: Did not mention 20+ years experience')
      }
      if (
        !lower.includes('iicrc') &&
        !lower.includes('certified') &&
        !lower.includes('certification')
      ) {
        issues.push('FAIL: Did not mention certifications')
      }
      return issues
    },
  },
  {
    name: '23. Pet safety question',
    description: 'Must confirm safe for pets.',
    messages: [
      {
        role: 'user',
        content:
          'Is your carpet cleaning safe for my dogs? I have 3 dogs and a cat.',
      },
    ],
    channel: 'inbound',
    checks(r) {
      const issues: string[] = []
      const lower = r.toLowerCase()
      if (
        !lower.includes('safe') &&
        !lower.includes('pet') &&
        !lower.includes('residue')
      ) {
        issues.push('FAIL: Did not confirm safety for pets')
      }
      return issues
    },
  },
  {
    name: '24. Deep cleaning vs standard',
    description: 'Customer asks about deep cleaning. Must explain difference.',
    messages: [
      {
        role: 'user',
        content: 'What is the difference between standard and deep cleaning?',
      },
    ],
    channel: 'inbound',
    checks(r) {
      const issues: string[] = []
      const lower = r.toLowerCase()
      if (!lower.includes('standard') && !lower.includes('regular'))
        issues.push('FAIL: Did not mention standard cleaning')
      if (!lower.includes('deep') && !lower.includes('restoration'))
        issues.push('FAIL: Did not mention deep restoration')
      return issues
    },
  },
  {
    name: '25. Introduction on first message',
    description: 'Harry must introduce himself on first message.',
    messages: [{ role: 'user', content: 'Hey there' }],
    channel: 'inbound',
    checks(r) {
      const issues: string[] = []
      const lower = r.toLowerCase()
      if (!lower.includes('harry'))
        issues.push('FAIL: Did not introduce as Harry')
      if (!lower.includes('sasquatch'))
        issues.push('FAIL: Did not mention Sasquatch Carpet Cleaning')
      return issues
    },
  },
]

async function runScenarios() {
  console.log('='.repeat(80))
  console.log('  HARRY AI SCENARIO TESTS — 25 SCENARIOS')
  console.log('  Running against real OpenAI + Supabase')
  console.log('='.repeat(80))
  console.log()

  let totalFails = 0
  let totalWarns = 0
  let passed = 0

  for (const scenario of scenarios) {
    console.log(`${'─'.repeat(80)}`)
    console.log(`  ${scenario.name}`)
    console.log(`  ${scenario.description}`)
    console.log(`${'─'.repeat(80)}`)

    const lastMessage = scenario.messages[scenario.messages.length - 1]
    const history = scenario.messages.slice(0, -1) as Message[]

    console.log(`  CUSTOMER: "${lastMessage.content}"`)
    console.log(`  CHANNEL:  ${scenario.channel}`)
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
      const warns = issues.filter((i) => i.startsWith('WARN'))

      if (issues.length === 0) {
        console.log('  ✅ ALL CHECKS PASSED')
        passed++
      } else {
        for (const issue of issues) {
          const prefix = issue.startsWith('WARN') ? '⚠️ ' : '❌ '
          console.log(`  ${prefix}${issue}`)
        }
        totalFails += fails.length
        totalWarns += warns.length
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
  console.log(
    `  RESULTS: ${passed}/${scenarios.length} passed | ${totalFails} failures | ${totalWarns} warnings`,
  )
  if (totalFails === 0) {
    console.log('  ✅ ALL SCENARIOS PASSED')
  } else {
    console.log(`  ❌ ${totalFails} FAILURE(S) DETECTED`)
  }
  console.log('='.repeat(80))

  process.exit(totalFails > 0 ? 1 : 0)
}

runScenarios()
