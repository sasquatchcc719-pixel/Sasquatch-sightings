/**
 * RingCentral Webhook Setup - JWT Authentication with Private Key
 * This uses the RingCentral JWT private key to authenticate automatically
 */

require('dotenv').config({ path: '.env.local' });

const CLIENT_ID = 'WCfoTe4MMO8fPxAzLo3P6v';
const CLIENT_SECRET = '4gaHOBidjlldlmJeZSIS2PbVD8SKDFzo5bNbvKdy6WT9';
const WEBHOOK_URL = 'https://sightings.sasquatchcarpet.com/api/leads';

// Get JWT private key from environment
const JWT_PRIVATE_KEY = process.env.RINGCENTRAL_JWT_PRIVATE_KEY;

const SDK = require('@ringcentral/sdk').SDK;

async function setupWebhook() {
  // Check for required credentials
  if (!JWT_PRIVATE_KEY) {
    console.error('❌ Error: RINGCENTRAL_JWT_PRIVATE_KEY is not set in .env.local\n');
    console.log('To get your JWT private key:');
    console.log('1. Go to https://developers.ringcentral.com/');
    console.log('2. Log in with: sasquatchcc719@gmail.com');
    console.log('3. Go to "My Apps" → Select your app');
    console.log('4. Go to "Credentials" tab');
    console.log('5. Under "JWT Credentials", download the private key');
    console.log('6. Copy the entire private key content and add to .env.local:\n');
    console.log('   RINGCENTRAL_JWT_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\\nMIIE...');
    console.log('   ...your private key...\\n-----END RSA PRIVATE KEY-----"\n');
    console.log('\nAlternatively, use the manual setup:');
    console.log('   node setup-ringcentral-webhook-manual.js');
    process.exit(1);
  }

  try {
    console.log('Initializing RingCentral SDK...');
    
    const rcsdk = new SDK({
      server: 'https://platform.ringcentral.com',
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET
    });

    const platform = rcsdk.platform();

    console.log('Authenticating with JWT...');
    
    // Authenticate using JWT with private key
    await platform.login({
      jwt: JWT_PRIVATE_KEY
    });
    
    console.log('✓ Authentication successful!');
    console.log('Creating webhook subscription...');
    
    // Create webhook subscription for missed calls
    const response = await platform.post('/restapi/v1.0/subscription', {
      eventFilters: [
        '/restapi/v1.0/account/~/extension/~/presence?detailedTelephonyState=true'
      ],
      deliveryMode: {
        transportType: 'WebHook',
        address: WEBHOOK_URL
      }
    });
    
    const result = await response.json();
    
    console.log('✓ Webhook created successfully!');
    console.log('\n📋 Webhook Details:');
    console.log('   Subscription ID:', result.id);
    console.log('   Webhook URL:', WEBHOOK_URL);
    console.log('   Status:', result.status);
    console.log('   Created:', new Date(result.creationTime).toLocaleString());
    console.log('\n✅ Setup complete! Test by calling (719) 749-8807 and letting it ring.');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    
    if (error.response) {
      const errorBody = await error.response.json();
      console.error('API Error:', JSON.stringify(errorBody, null, 2));
    }
    
    console.error('\n🔧 Troubleshooting:');
    
    if (error.message.includes('JWT') || error.message.includes('401')) {
      console.error('• Your JWT private key may be invalid or expired');
      console.error('• Make sure the private key is copied correctly with all line breaks');
      console.error('• Ensure your RingCentral app has JWT auth enabled');
      console.error('\nTo regenerate:');
      console.error('1. Go to https://developers.ringcentral.com/');
      console.error('2. Your app → Credentials → JWT Credentials');
      console.error('3. Download a new private key');
    } else if (error.message.includes('Unauthorized')) {
      console.error('• Make sure your RingCentral app is configured for JWT authentication');
      console.error('• Go to app settings → Auth tab → Enable "JWT Auth Flow"');
    } else {
      console.error('• Check that your app has the required permissions');
      console.error('• Verify the webhook URL is accessible: ' + WEBHOOK_URL);
    }
    
    console.error('\nFor manual setup instructions:');
    console.error('   node setup-ringcentral-webhook-manual.js');
    
    process.exit(1);
  }
}

setupWebhook();
