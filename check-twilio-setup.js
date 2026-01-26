/**
 * Quick diagnostic script to check Twilio setup
 * Run: node check-twilio-setup.js
 */

require('dotenv').config({ path: '.env.local' })

console.log('\n🔍 TWILIO CONFIGURATION CHECK\n')
console.log('=' .repeat(50))

const checks = {
  'TWILIO_ACCOUNT_SID': process.env.TWILIO_ACCOUNT_SID,
  'TWILIO_AUTH_TOKEN': process.env.TWILIO_AUTH_TOKEN,
  'TWILIO_PHONE_NUMBER': process.env.TWILIO_PHONE_NUMBER,
  'ADMIN_PHONE_NUMBER': process.env.ADMIN_PHONE_NUMBER,
  'OPENAI_API_KEY': process.env.OPENAI_API_KEY,
  'AI_DISPATCHER_ENABLED': process.env.AI_DISPATCHER_ENABLED,
}

let allGood = true

for (const [key, value] of Object.entries(checks)) {
  if (!value) {
    console.log(`❌ ${key}: NOT SET`)
    allGood = false
  } else if (key.includes('KEY') || key.includes('TOKEN') || key.includes('SID')) {
    // Mask sensitive data
    const masked = value.substring(0, 6) + '...' + value.substring(value.length - 4)
    console.log(`✅ ${key}: ${masked}`)
  } else {
    console.log(`✅ ${key}: ${value}`)
  }
}

console.log('=' .repeat(50))

if (allGood) {
  console.log('\n✅ All environment variables are set!')
  console.log('\nNext steps:')
  console.log('1. Check Vercel has the same env vars')
  console.log('2. Check Twilio logs: https://console.twilio.com/us1/monitor/logs/messaging')
  console.log('3. Verify phone numbers are in E.164 format (+1XXXXXXXXXX)')
} else {
  console.log('\n❌ Missing environment variables!')
  console.log('Copy from .env.local.example and fill in your values')
}

console.log('\n')
