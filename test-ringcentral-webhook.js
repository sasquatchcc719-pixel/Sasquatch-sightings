/**
 * Test script for RingCentral webhook integration
 * Usage: node test-ringcentral-webhook.js
 */

const testMissedCallPayload = {
  uuid: 'test-uuid-123',
  event: '/restapi/v1.0/account/~/extension/~/presence',
  timestamp: new Date().toISOString(),
  subscriptionId: 'test-sub-123',
  body: {
    extensionId: '123456',
    telephonyStatus: 'NoCall',
    activeCalls: [
      {
        id: 'call-123',
        direction: 'Inbound',
        from: '+17195551234',
        fromName: 'Test Caller',
        to: '+17197498807',
        telephonyStatus: 'NoCall',
      },
    ],
  },
}

async function testWebhook() {
  console.log('Testing RingCentral webhook...\n')
  console.log('Sending payload to: http://localhost:3000/api/leads\n')

  try {
    const response = await fetch('http://localhost:3000/api/leads', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(testMissedCallPayload),
    })

    const data = await response.json()
    
    console.log('Response status:', response.status)
    console.log('Response data:', JSON.stringify(data, null, 2))

    if (response.ok) {
      console.log('\n✅ Webhook test successful!')
      console.log('\nCheck your:')
      console.log('1. Database for new lead with source="missed_call"')
      console.log('2. Phone for SMS message')
      console.log('3. Device for push notification')
    } else {
      console.log('\n❌ Webhook test failed')
    }
  } catch (error) {
    console.error('\n❌ Error:', error.message)
    console.log('\nMake sure:')
    console.log('1. Your dev server is running (npm run dev)')
    console.log('2. Environment variables are set in .env.local')
  }
}

testWebhook()
