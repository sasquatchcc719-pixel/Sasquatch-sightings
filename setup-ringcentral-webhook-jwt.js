/**
 * RingCentral Webhook Setup - JWT Authentication
 * Run this after adding RINGCENTRAL_JWT to .env.local
 */

require('dotenv').config({ path: '.env.local' });

const CLIENT_ID = process.env.RINGCENTRAL_CLIENT_ID;
const CLIENT_SECRET = process.env.RINGCENTRAL_CLIENT_SECRET;
const JWT_TOKEN = process.env.RINGCENTRAL_JWT;
const WEBHOOK_URL = 'https://sightings.sasquatchcarpet.com/api/leads';

const SDK = require('@ringcentral/sdk').SDK;

const rcsdk = new SDK({
  server: 'https://platform.ringcentral.com',
  clientId: CLIENT_ID,
  clientSecret: CLIENT_SECRET
});

const platform = rcsdk.platform();

async function setupWebhook() {
  if (!JWT_TOKEN) {
    console.error('❌ Error: RINGCENTRAL_JWT is not set in .env.local\n');
    console.log('To get your JWT token:');
    console.log('1. Go to https://developers.ringcentral.com/');
    console.log('2. Select your app → Credentials');
    console.log('3. Under "JWT Credentials", click "Create JWT"');
    console.log('4. Copy the token and add to .env.local:\n');
    console.log('   RINGCENTRAL_JWT=your-very-long-jwt-token-here\n');
    console.log('Or run: node setup-ringcentral-webhook-manual.js for manual setup guide');
    process.exit(1);
  }

  try {
    console.log('Logging into RingCentral with JWT...');
    
    // Login using JWT
    await platform.login({ jwt: JWT_TOKEN });
    
    console.log('✓ Login successful!');
    console.log('Creating webhook subscription...');
    
    // Create webhook subscription for missed calls
    const response = await platform.post('/restapi/v1.0/subscription', {
      eventFilters: ['/restapi/v1.0/account/~/extension/~/presence?detailedTelephonyState=true'],
      deliveryMode: {
        transportType: 'WebHook',
        address: WEBHOOK_URL
      }
    });
    
    const result = await response.json();
    console.log('✓ Webhook created successfully!');
    console.log('Subscription ID:', result.id);
    console.log('Webhook URL:', WEBHOOK_URL);
    console.log('Status:', result.status);
    console.log('\n✅ Setup complete! Test by calling your RingCentral number.');
  } catch (error) {
    console.error('❌ Error:', error.message);
    
    if (error.message.includes('JWT')) {
      console.error('\nYour JWT token may be invalid or expired.');
      console.error('To generate a new JWT token:');
      console.error('1. Go to https://developers.ringcentral.com/');
      console.error('2. Select your app → Credentials');
      console.error('3. Under "JWT Credentials", click "Create JWT"');
      console.error('4. Copy and update RINGCENTRAL_JWT in .env.local');
    } else if (error.message.includes('Unauthorized')) {
      console.error('\nMake sure your RingCentral app is configured for JWT authentication:');
      console.error('1. Go to https://developers.ringcentral.com/');
      console.error('2. Edit your app → Auth tab');
      console.error('3. Enable "JWT Auth Flow"');
      console.error('4. Save and generate a new JWT token');
    } else {
      console.error('\nFor manual setup instructions, run:');
      console.error('node setup-ringcentral-webhook-manual.js');
    }
  }
}

setupWebhook();
