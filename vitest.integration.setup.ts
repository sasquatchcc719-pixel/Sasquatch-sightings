import { config as loadEnv } from 'dotenv'

loadEnv({ path: '.env.local' })

if (
  process.env.ALLOW_LIVE_INTEGRATION_TESTS !==
  'I_UNDERSTAND_THIS_WRITES_LIVE_DATA'
) {
  throw new Error(
    'Live integration tests are disabled. Set ALLOW_LIVE_INTEGRATION_TESTS=I_UNDERSTAND_THIS_WRITES_LIVE_DATA only for an intentional, supervised run.',
  )
}
