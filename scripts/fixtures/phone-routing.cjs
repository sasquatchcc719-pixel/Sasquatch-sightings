const { z } = require('zod')
const {
  phoneInstructions,
  previewPhoneTools,
} = require('../../src/lib/phone-assistant/engine.ts')
const {
  previewQuoteIntake,
} = require('../../src/lib/phone-assistant/preview-profile.ts')
const room = '85d2909f-7574-4ac5-928c-e61c91a3758c'
const catalog = [
  {
    id: room,
    slug: 'standard-bedroom',
    name: 'Standard bedroom carpet cleaning (up to 200 sq ft)',
    category: 'Carpet cleaning',
    base_price: 65,
    pricing_unit: 'room',
  },
]
// The caller explicitly asks about optional work in the second residential turn.
for (const [index, [slug, category, name, price, unit]] of [
  ['pet-urine', 'Carpet treatment', 'Pet urine treatment', 25, 'area'],
  ['area-rug', 'Rug cleaning', 'Area rug cleaning', 60, 'rug'],
  ['sofa', 'Upholstery', 'Three-seat fabric sofa', 120, 'sofa'],
  ['loveseat', 'Upholstery', 'Two-seat fabric loveseat', 95, 'loveseat'],
  [
    'large-room',
    'Carpet cleaning',
    'Large carpeted room, 201 through 400 square feet',
    85,
    'room',
  ],
  ['tile', 'Tile cleaning', 'Tile cleaning', 2, 'square foot'],
].entries()) {
  catalog.push({
    id: 'faf540ad-87be-44d2-95de-79dcd18da90' + index,
    slug,
    category,
    name,
    base_price: price,
    pricing_unit: unit,
  })
}
// The real preview exposes the supplied catalog inline and hides phone_catalog.
const businessTools = previewPhoneTools(catalog).filter(
  (tool) => tool.name !== 'phone_catalog',
)
const tools = businessTools.map((tool) => ({
  type: 'function',
  name: tool.name,
  description: tool.description,
  parameters: z.toJSONSchema(tool.inputSchema, {
    target: 'draft-7',
    unrepresentable: 'any',
    io: 'input',
  }),
}))
for (const [name, description] of [
  [
    'request_flood_confirmation',
    'For an active flood or water actively entering a property, ask the caller to confirm with the emergency keypad. Only that explicit confirmation can ring staff. A request for a person is a callback message.',
  ],
  [
    'end_call',
    'End this call after saying goodbye, including after politely declining a sales pitch.',
  ],
])
  tools.push({
    type: 'function',
    name,
    description,
    parameters: { type: 'object', properties: {} },
  })
const prompt =
  phoneInstructions(true, true) +
  previewQuoteIntake(catalog) +
  '\nWhen a call is over, say goodbye before calling end_call. Offer the flood confirmation tool only for active water intrusion. Other requests for a person are callback messages. If the line goes silent, check once whether the caller is still there. If silence continues, say goodbye and end the call.'
const cases = {
  complete: [
    [
      "I'd like your first available appointment. It's a three-seat fabric couch and one 350-square-foot carpeted living room. My ZIP is eight zero one three three. My name is Jamie Tester and my address is one Example Lane.",
    ],
    [
      'The ZIP is eight zero one three three. Please book the first opening for one three-seat sofa and one 350-square-foot living room. What would it cost and when can you come?',
    ],
  ],
  couch: [
    [
      'How much to clean my couch?',
      "Great. Can I get that? And then can you clean my living room too? It's about three hundred square feet.",
    ],
  ],
  loveseat: [
    [
      'How much to clean my couch?',
      "Actually it's a loveseat, not a couch. Can I get that and the carpet in my living room? It's about three hundred square feet.",
    ],
  ],

  message: [
    [
      "I'd just like to leave a message. I'm Jamie. Tell the office I found the missing rug tag. No callback, thanks.",
    ],
    [
      'Can I just leave a note for the office?',
      'This is Morgan. The side gate will be open. No need to call me back.',
    ],
  ],
  human: [
    [
      "I need an actual person tonight to talk about a carpet stain. There's no flooding. Please put a person on.",
    ],
    [
      "Put the owner on right now, please. Our carpet got wet last week, but it's completely dry.",
    ],
  ],
  flood: [
    [
      'The pipe burst and is still pouring water into our basement. Can I get emergency help?',
      'Yes, water is actively pouring in right now. Please put me through.',
    ],
    [
      "Water is coming into my store right now. Yes, it's actively flooding. I need emergency help.",
      'Yes, water is still coming into the property right now.',
    ],
  ],
  commercial: [
    [
      "We need an estimate for the carpet in our office building. The ZIP code is eight zero one one zero. What's the earliest you can send someone to measure?",
    ],
    [
      "It's a restaurant, not a house. We'd like an on-site carpet measure, in eight zero one one zero. When can someone come?",
    ],
  ],
  residential: [
    [
      'I need an estimate to clean four standard bedrooms at my house. Each is one hundred fifty square feet. ZIP code eight zero one one zero. How much is that?',
      'Before we wrap up, what else do you clean? Any optional services?',
    ],
    [
      'What would it cost for five ordinary carpeted bedrooms in my home? Each is under two hundred square feet. My ZIP is eight zero one one zero.',
      'What other services could we add?',
    ],
  ],
  spam: [
    [
      "Hello business owner! This is a sales call. We'd love to sell you an extended warranty for your company vehicles.",
    ],
    [
      "We're a marketing company selling search engine packages. Can I speak to the owner about buying our advertising services?",
    ],
    [
      'This is an automated notification. This is an automated notification. Please hold.',
      'This is an automated notification. Please hold.',
    ],
  ],
}
const openingDate = new Date(Date.now() + 4 * 86_400_000)
  .toISOString()
  .slice(0, 10)
function fixture(call) {
  const { name } = call
  let args = call.args
  const def = businessTools.find((t) => t.name === name)
  if (def) {
    const parsed = def.inputSchema.safeParse(args)
    if (!parsed.success)
      return { error: 'Invalid arguments in synthetic fixture' }
    args = parsed.data
  }
  if (name === 'phone_service_area') return { allowed: true, travel_charge: 0 }
  if (name === 'phone_quote') {
    let total = 0
    for (const line of args.line_items) {
      const service = catalog.find((item) => item.id === line.service_id)
      if (!service) return { error: 'Unknown fixture service' }
      total += service.base_price * line.quantity
    }
    return {
      status: 'standard_estimate',
      total,
      subtotal: total,
      travel_fee: 0,
      lsa_fee: 0,
      minimum_charge_applied: false,
      quote_ref: '120.fixture',
      duration_minutes: 120,
    }
  }
  if (name === 'phone_openings' && args.visit_type === 'residential_service') {
    if (!args.service) return { error: 'Residential service details required' }
    const quote = fixture({ name: 'phone_quote', args: args.service })
    if (quote.error) return quote
    return {
      date: openingDate,
      times: ['11:00'],
      timezone: 'America/Denver',
      quote,
    }
  }
  if (['phone_openings', 'phone_quoted_openings'].includes(name))
    return { date: openingDate, times: ['11:00'], timezone: 'America/Denver' }
  if (name === 'request_flood_confirmation')
    return {
      fixture: 'Emergency keypad confirmation requested.',
      staff_rang: false,
    }
  if (name === 'end_call') return { fixture: 'Call ended.' }
  return {
    simulated: true,
    executed: false,
    error: 'No booking or change authorized in this fixture',
  }
}
// In the combined-job scenario, supply only a requested missing detail. An
// orphaned hold never receives a made-up “are you there?” to restart it.
function promptedDetail(scenario, lines, answer) {
  if (!['couch', 'loveseat'].includes(scenario)) return
  const zip = 'The ZIP code is eight zero nine one eight.'
  const seats =
    scenario === 'couch'
      ? 'It is a standard three-seat sofa.'
      : 'It is a loveseat.'
  if (
    !lines.includes(zip) &&
    /zip(?: code)?|postal code/i.test(answer) &&
    /\?|what|which|need|give|provide|may I/i.test(answer)
  )
    return zip
  if (
    !lines.includes(seats) &&
    /seat|sofa|couch|sectional|loveseat|size/i.test(answer) &&
    /\?/.test(answer)
  )
    return seats
}
function matchesQuote(call, zip, expected, total) {
  if (!call || call.args.zip_code !== zip || call.result.total !== total)
    return false
  const lines = call.args.line_items || []
  return (
    lines.length === expected.length &&
    expected.every(([slug, qty]) => {
      const service = catalog.find((row) => row.slug === slug)
      return lines.some(
        (line) =>
          (line.service_id === slug || line.service_id === service?.id) &&
          line.quantity === qty,
      )
    })
  )
}
function evaluate(row) {
  const failures = []
  const check = (ok, label) => {
    if (!ok) failures.push(label)
  }
  if (!['replied', 'terminal-tool'].includes(row.outcome))
    return [
      'No completed routing result: ' + (row.errors.join(', ') || row.outcome),
    ]
  const calls = (name) => row.tools.filter((call) => call.name === name)
  const noQuotePreamble = (quote) =>
    !quote ||
    !row.responses.some(
      (reply) =>
        reply.turn === quote.turn &&
        reply.audio !== undefined &&
        reply.audio <= quote.at,
    )

  const speech = (turn) =>
    row.responses
      .filter((res) => res.turn === turn && res.audio !== undefined)
      .map((res) => res.text || '')
      .join(' ')
  const text = row.turns.map((_, i) => speech(i)).join(' ')
  const close =
    /good[ -]?bye|\bbye\b|have a (?:good|nice) (?:day|evening|night)|take care/i
  const extras = [/pet|urine/i, /rug/i, /furniture|upholstery/i, /tile/i]
  const only = (...allowed) =>
    check(
      row.tools.every((call) => allowed.includes(call.name)),
      'Unexpected tool for this scenario',
    )
  check(
    row.tools.every((call) => !call.result.error),
    'Invalid or unauthorized synthetic tool arguments',
  )
  check(
    !/\b(?:booked|scheduled) (?:you|your (?:job|visit|appointment))\b/i.test(
      text,
    ),
    'Claimed a booking',
  )
  switch (row.scenario) {
    case 'message': {
      only('end_call')
      const final = speech(row.lines.length - 1)
      check(
        row.turns.length === row.lines.length,
        'Ended before intake finished',
      )
      check(
        close.test(final) &&
          /thank|got it|pass|note|message|office|let .* know|will let|will be open/i.test(
            final,
          ),
        'Missing audible acknowledgment and goodbye after the completed note',
      )
      check(
        !/pet urine|furniture|upholstery|tile|zip code|how did you hear/i.test(
          text,
        ),
        'Started sales or service intake on a message',
      )
      check(calls('end_call').length === 1, 'Missing or duplicated hangup')
      break
    }
    case 'spam': {
      only('end_call')
      const final = speech(row.lines.length - 1)
      check(
        /good[ -]?bye|\bbye\b|have a (?:good|nice)|take care|wrap up|end (?:the|this) call/i.test(
          final,
        ),
        'No audible polite close',
      )
      if (row.rep === 3)
        check(
          /cleaning|appointment/i.test(speech(0)) && row.turns.length === 2,
          'Recorded loop did not get one clarification',
        )
      else
        check(
          /no thanks|no thank|not interested|don.t (?:take|handle|accept)|not (?:accept|tak)|decline|isn.t (?:for|the)/i.test(
            final,
          ),
          'No audible sales decline',
        )
      check(calls('end_call').length === 1, 'Missing or duplicated hangup')
      break
    }
    case 'complete': {
      only('phone_openings')
      const lookups = calls('phone_openings')
      const lookup = lookups[0]
      check(
        lookups.length === 1 &&
          lookup.args.visit_type === 'residential_service' &&
          lookup.args.zip_code === '80133' &&
          !lookup.args.appointment_date &&
          !lookup.args.search_from &&
          matchesQuote(
            {
              args: lookup.args.service ?? {},
              result: lookup.result.quote ?? {},
            },
            '80133',
            [
              ['sofa', 1],
              ['large-room', 1],
            ],
            205,
          ),
        'Expected one combined price and earliest-opening lookup for the stated job',
      )
      check(
        /205|two hundred (?:and )?five/i.test(speech(0)) &&
          /11|eleven/i.test(speech(0)),
        'Missing verified amount or first time before caller had to speak again',
      )
      break
    }
    case 'couch':
    case 'loveseat': {
      only('phone_quote', 'phone_service_area')
      const corrected = row.scenario === 'loveseat'
      const initial = speech(0)
      check(
        /120|one hundred (?:and )?twenty/i.test(initial) &&
          /three.?seat|3.?seat/i.test(initial),
        'Did not give the labeled standard three-seat sofa example',
      )
      const zipRequest = speech(1)
      check(
        /zip|postal/i.test(zipRequest),
        'Did not promptly ask for ZIP after adding the 300-square-foot room',
      )
      check(
        zipRequest.trim().split(/\s+/).length <= 12,
        'Added filler before the ZIP question',
      )
      const quotes = calls('phone_quote')
      const total = corrected ? 180 : 205
      check(
        quotes.length === 1 &&
          matchesQuote(
            quotes[0],
            '80918',
            [
              [corrected ? 'loveseat' : 'sofa', 1],
              ['large-room', 1],
            ],
            total,
          ),
        'Did not independently quote the correct furniture and 300-square-foot room',
      )
      const final = speech(row.turns.length - 1)
      check(
        (corrected
          ? /180|one hundred (?:and )?eighty/i
          : /205|two hundred (?:and )?five/i
        ).test(final),
        'Did not speak the verified total without prompting',
      )
      check(noQuotePreamble(quotes[0]), 'Narrated a routine price lookup')
      break
    }
    case 'residential': {
      only('phone_quote', 'phone_service_area')
      const qty = row.rep === 1 ? 4 : 5
      const quote = calls('phone_quote')
      check(
        quote.length === 1 &&
          matchesQuote(
            quote[0],
            '80110',
            [['standard-bedroom', qty]],
            qty * 65,
          ),
        'Incorrect job quote, ZIP or quantity',
      )
      const initial = speech(0)
      const amount =
        qty === 4
          ? /260|two hundred (?:and )?sixty/i
          : /325|three hundred (?:and )?twenty[ -]five/i
      check(amount.test(initial), 'Did not speak the verified price')
      check(
        !extras.some((pattern) => pattern.test(initial)),
        'Added optional services to the initial price',
      )
      check(noQuotePreamble(quote[0]), 'Narrated a routine price lookup')
      check(
        extras.every((pattern) => pattern.test(speech(1))),
        'Later optional-services reply omitted requested categories',
      )
      break
    }
    case 'human':
      only()
      check(
        /message|note|pass .*along|callback/i.test(text),
        'Ordinary caller was not offered a message',
      )
      check(
        !/I.ll (?:transfer|connect)|put you through/i.test(text),
        'Promised an after-hours transfer',
      )
      break
    case 'flood':
      only('request_flood_confirmation')
      check(
        calls('request_flood_confirmation').length === 1,
        'Did not request exactly one simulated emergency keypad',
      )
      break
    case 'commercial': {
      only('phone_openings', 'phone_service_area')
      const lookup = calls('phone_openings')
      check(
        lookup.length === 1 &&
          lookup[0].args.visit_type === 'commercial_measurement' &&
          lookup[0].args.zip_code === '80110',
        'Did not check the commercial measurement calendar',
      )
      check(
        /11(?::00)?\s*(?:a\.?m\.?|in the morning)|eleven/i.test(text),
        'Missing fixture opening time',
      )
      check(
        !/dollars|\$\d/.test(text),
        'Quoted residential pricing for commercial work',
      )
      break
    }
  }
  return failures
}

module.exports = { cases, tools, prompt, fixture, evaluate, promptedDetail }
