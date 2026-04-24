import { config } from 'dotenv'

config({ path: '.env.local' })

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN

if (!TELEGRAM_BOT_TOKEN) {
  console.error('❌ TELEGRAM_BOT_TOKEN not found in .env.local')
  process.exit(1)
}

async function getChatId() {
  console.log('🔍 Fetching recent messages to find your chat ID...\n')

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates`

  try {
    const response = await fetch(url)
    const data = await response.json()

    if (!data.ok) {
      console.error('❌ Telegram API error:', data.description)
      process.exit(1)
    }

    if (!data.result || data.result.length === 0) {
      console.log('⚠️  No messages found yet.')
      console.log('\n📱 Please send a message to your bot first:')
      console.log('   1. Open Telegram')
      console.log('   2. Search for @Sasquatchnotificationsbot')
      console.log('   3. Send any message (like "test")')
      console.log('   4. Run this script again\n')
      process.exit(0)
    }

    // Get the most recent message
    const latestUpdate = data.result[data.result.length - 1]
    const chatId = latestUpdate.message?.chat?.id
    const firstName = latestUpdate.message?.chat?.first_name
    const username = latestUpdate.message?.chat?.username
    const messageText = latestUpdate.message?.text

    if (!chatId) {
      console.error('❌ Could not find chat ID in the message')
      process.exit(1)
    }

    console.log('✅ Found your chat!\n')
    console.log('📋 Details:')
    console.log(`   Name: ${firstName || 'Unknown'}`)
    console.log(`   Username: @${username || 'Unknown'}`)
    console.log(`   Chat ID: ${chatId}`)
    console.log(`   Last message: "${messageText}"\n`)

    console.log('🔧 Add this to your .env.local:')
    console.log(`   TELEGRAM_CHAT_ID=${chatId}\n`)

    // Test sending a message
    console.log('📤 Sending test message...')
    const testUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`
    const testResponse = await fetch(testUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: "✅ Sasquatch Notifications Bot is connected! You'll now receive booking alerts and job reminders here.",
      }),
    })

    const testData = await testResponse.json()
    if (testData.ok) {
      console.log('✅ Test message sent! Check your Telegram.\n')
    } else {
      console.log(
        '⚠️  Could not send test message:',
        testData.description,
        '\n',
      )
    }
  } catch (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  }
}

getChatId()
