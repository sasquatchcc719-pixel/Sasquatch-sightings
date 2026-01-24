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
  // Login using JWT (your credentials)
  await platform.login({ jwt: process.env.RINGCENTRAL_JWT });
  
  // Create webhook subscription for missed calls
  const response = await platform.post('/restapi/v1.0/subscription', {
    eventFilters: ['/restapi/v1.0/account/~/extension/~/presence?detailedTelephonyState=true'],
    deliveryMode: {
      transportType: 'WebHook',
      address: WEBHOOK_URL
    }
  });
  
  console.log('Webhook created:', response.json());
}

setupWebhook().catch(console.error);
