const CLIENT_ID = 'WCfoTe4MMO8fPxAzLo3P6v';
const CLIENT_SECRET = '4gaHOBidjlldlmJeZSIS2PbVD8SKDFzo5bNbvKdy6WT9';
const WEBHOOK_URL = 'https://sightings.sasquatchcarpet.com/api/leads';

const SDK = require('@ringcentral/sdk').SDK;

const rcsdk = new SDK({
  server: 'https://platform.ringcentral.com',
  clientId: CLIENT_ID,
  clientSecret: CLIENT_SECRET
});

const platform = rcsdk.platform();

async function setupWebhook() {
  console.log('Logging into RingCentral...');
  
  // Login using username/password
  await platform.login({
    username: process.env.RINGCENTRAL_USERNAME,
    password: process.env.RINGCENTRAL_PASSWORD,
    extension: process.env.RINGCENTRAL_EXTENSION || ''
  });
  
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
}

setupWebhook().catch((error) => {
  console.error('❌ Error:', error.message);
  console.error('\nMake sure you have set in .env.local:');
  console.error('  RINGCENTRAL_USERNAME');
  console.error('  RINGCENTRAL_PASSWORD');
  console.error('  RINGCENTRAL_EXTENSION (if needed)');
});
