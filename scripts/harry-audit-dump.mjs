import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Pull all conversations with at least one assistant message (i.e. Harry replied)
const { data: convos, error } = await supabase
  .from('conversations')
  .select('id, phone_number, source, status, created_at, updated_at, messages, metadata')
  .order('updated_at', { ascending: false })
  .limit(200)

if (error) { console.error('Error:', error); process.exit(1) }

let totalConvos = 0
let harryConvos = 0
let totalHarryMessages = 0
let totalUserMessages = 0

const patterns = {
  flaggedForCharles: 0,
  saidWillUpdate: 0,       // "I'll update X"
  saidUpdated: 0,          // "I've updated X" / "updated X"
  saidBooked: 0,           // "I've booked" / "Booked for"
  saidCancelled: 0,        // Harry claiming cancellation
  saidReschedule: 0,
  offlineDeferral: 0,      // "Charles will" / "office will" / "we'll" vague
  bookingLinkMention: 0,   // mentions /book URL
  housecallProMention: 0,
  pendingApproval: 0,      // "pending approval" phrases
  emergencyEscalation: 0,
  followUp: 0,             // "follow up" / "get back to you"
  thankYou: 0,
  emojiUsage: 0,
}

const examples = {
  falseConfirm: [],        // Said done, no tool call visible
  charlesBailout: [],
  badBooking: [],
  missedAddress: [],
  housecallProSlip: [],
  cancelClaim: [],
  confusionOrLoops: [],
  goodCompletions: [],
}

for (const convo of convos) {
  totalConvos++
  const msgs = Array.isArray(convo.messages) ? convo.messages : []
  const harryMsgs = msgs.filter(m => m.role === 'assistant')
  const userMsgs = msgs.filter(m => m.role === 'user')
  if (harryMsgs.length === 0) continue
  harryConvos++
  totalHarryMessages += harryMsgs.length
  totalUserMessages += userMsgs.length

  // Phrase counts
  const joinedHarry = harryMsgs.map(m => m.content || '').join('\n').toLowerCase()
  const joinedUser = userMsgs.map(m => m.content || '').join('\n').toLowerCase()

  if (joinedHarry.includes('flagged this for') || joinedHarry.includes("charles will")) patterns.flaggedForCharles++
  if (/\bi'?ll update\b|going to update|will update/.test(joinedHarry)) patterns.saidWillUpdate++
  if (/(i'?ve|i have) updated|updated your/.test(joinedHarry)) patterns.saidUpdated++
  if (/\bbooked for\b|i'?ve booked|i have booked|you'?re booked/.test(joinedHarry)) patterns.saidBooked++
  if (/cancelled|i'?ve cancelled|canceled/.test(joinedHarry)) patterns.saidCancelled++
  if (/reschedul/.test(joinedHarry)) patterns.saidReschedule++
  if (/office will|office handles|office can|we'?ll follow up|follow up shortly/.test(joinedHarry)) patterns.offlineDeferral++
  if (/sightings\.sasquatchcarpet|\/book/.test(joinedHarry)) patterns.bookingLinkMention++
  if (/housecall/.test(joinedHarry)) patterns.housecallProMention++
  if (/pending approval|needs approval/.test(joinedHarry)) patterns.pendingApproval++
  if (/emergenc|water damag|flood|burst pipe/.test(joinedHarry)) patterns.emergencyEscalation++
  if (/follow up|get back to you|get in touch/.test(joinedHarry)) patterns.followUp++
  if (/thank|thanks/.test(joinedHarry)) patterns.thankYou++
  if (/👍|😊|👋|🙂|❤️|🎉|✨/.test(joinedHarry)) patterns.emojiUsage++

  // Collect specific example patterns (capped)
  const shortConvo = {
    id: convo.id,
    phone: convo.phone_number,
    source: convo.source,
    status: convo.status,
    updated: convo.updated_at,
    messages: msgs.slice(-10).map(m => ({
      role: m.role,
      ts: m.timestamp,
      content: m.content,
    })),
  }

  // Patricia-style: said "I'll update address" but tool_calls array (if stored) shows nothing
  // We can't see tool calls from the conversations table alone, but pattern-match obvious lies:
  if (/i'?ll update your address|update your address to|going to update your address/.test(joinedHarry) && examples.missedAddress.length < 8) {
    examples.missedAddress.push(shortConvo)
  }

  // Charles bailouts
  if ((joinedHarry.match(/charles will/g) || []).length > 0 && examples.charlesBailout.length < 8) {
    examples.charlesBailout.push(shortConvo)
  }

  // Cancel claims (Harry isn't supposed to cancel)
  if (/i'?ve cancelled|i have cancelled|canceled your/.test(joinedHarry) && examples.cancelClaim.length < 5) {
    examples.cancelClaim.push(shortConvo)
  }

  // Housecall pro slip-up
  if (/housecall/.test(joinedHarry) && examples.housecallProSlip.length < 5) {
    examples.housecallProSlip.push(shortConvo)
  }

  // Booking link when tools exist
  if (/\/book/.test(joinedHarry) && examples.goodCompletions.length < 10) {
    examples.goodCompletions.push(shortConvo)
  }

  // Loops / confusion: user repeats "yes" or "?" multiple times
  const userContent = userMsgs.map(m => m.content || '').join(' ').toLowerCase()
  if (((userContent.match(/\?/g) || []).length >= 3) && examples.confusionOrLoops.length < 5) {
    examples.confusionOrLoops.push(shortConvo)
  }
}

console.log('\n═══════════════════════════════════════')
console.log('HARRY CONVERSATION AUDIT — SAMPLE STATS')
console.log('═══════════════════════════════════════')
console.log(`Total conversations loaded:     ${totalConvos}`)
console.log(`Conversations where Harry replied: ${harryConvos}`)
console.log(`Harry messages total:            ${totalHarryMessages}`)
console.log(`User messages total:             ${totalUserMessages}`)

console.log('\n── PATTERN COUNTS ──────────────────────')
const p = patterns
const pct = n => harryConvos ? `${((n / harryConvos) * 100).toFixed(1)}%` : '—'
console.log(`Charles bailout ("flagged"/"Charles will"):  ${p.flaggedForCharles}  (${pct(p.flaggedForCharles)})`)
console.log(`"I'll update X" (future tense):              ${p.saidWillUpdate}  (${pct(p.saidWillUpdate)})`)
console.log(`"I've updated X" (past tense claim):         ${p.saidUpdated}  (${pct(p.saidUpdated)})`)
console.log(`"Booked for..." claims:                      ${p.saidBooked}  (${pct(p.saidBooked)})`)
console.log(`Cancelled claim (forbidden):                 ${p.saidCancelled}  (${pct(p.saidCancelled)})`)
console.log(`Reschedule mention:                          ${p.saidReschedule}  (${pct(p.saidReschedule)})`)
console.log(`"Office will" / vague deferral:              ${p.offlineDeferral}  (${pct(p.offlineDeferral)})`)
console.log(`Booking URL (/book) mention:                 ${p.bookingLinkMention}  (${pct(p.bookingLinkMention)})`)
console.log(`HousecallPro slip:                           ${p.housecallProMention}`)
console.log(`"Pending approval" phrases:                  ${p.pendingApproval}`)
console.log(`Emergency escalation:                        ${p.emergencyEscalation}`)
console.log(`Generic "follow up":                         ${p.followUp}  (${pct(p.followUp)})`)
console.log(`Emoji usage:                                 ${p.emojiUsage}  (${pct(p.emojiUsage)})`)
console.log(`Thank you/thanks:                            ${p.thankYou}`)

for (const [bucket, arr] of Object.entries(examples)) {
  if (arr.length === 0) continue
  console.log(`\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
  console.log(`EXAMPLES: ${bucket.toUpperCase()}  (${arr.length})`)
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
  arr.forEach((c, i) => {
    console.log(`\n── Example ${i+1} ── phone=${c.phone} source=${c.source} status=${c.status}`)
    c.messages.forEach(m => {
      const tag = m.role === 'user' ? 'CUSTOMER' : 'HARRY   '
      const time = m.ts ? new Date(m.ts).toLocaleString() : ''
      const text = (m.content || '').slice(0, 400).replace(/\n/g, ' ')
      console.log(`  ${tag} [${time}]: ${text}`)
    })
  })
}
