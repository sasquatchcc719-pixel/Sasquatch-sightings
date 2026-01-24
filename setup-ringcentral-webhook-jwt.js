/**
 * RingCentral Webhook Setup - OAuth Client Credentials
 * Uses client_credentials grant type - simplest authentication method
 */

const CLIENT_ID = 'WCfoTe4MMO8fPxAzLo3P6v';
const CLIENT_SECRET = '4gaHOBidjlldlmJeZSIS2PbVD8SKDFzo5bNbvKdy6WT9';
const WEBHOOK_URL = 'https://sightings.sasquatchcarpet.com/api/leads';

const SDK = require('@ringcentral/sdk').SDK;

async function setupWebhook() {
  try {
    console.log('Initializing RingCentral SDK...');
    
    const rcsdk = new SDK({
      server: 'https://platform.ringcentral.com',
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET
    });

    const platform = rcsdk.platform();

    console.log('Authenticating with OAuth Client Credentials...');
    
    // Use OAuth Client Credentials Grant (simplest method)
    await platform.login({
      grant_type: 'client_credentials',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET
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
      try {
        const errorBody = await error.response.json();
        console.error('API Error:', JSON.stringify(errorBody, null, 2));
      } catch (e) {
        console.error('Could not parse error response');
      }
    }
    
    console.error('\n🔧 Troubleshooting:');
    
    if (error.message.includes('401') || error.message.includes('Unauthorized')) {
      console.error('• Verify your CLIENT_ID and CLIENT_SECRET are correct');
      console.error('• Make sure your app is active in RingCentral Developer Console');
      console.error('• Check that your app has the required permissions:');
      console.error('  - Webhook Subscriptions');
      console.error('  - Read Presence');
      console.error('  - Read Accounts');
    } else if (error.message.includes('403') || error.message.includes('Forbidden')) {
      console.error('• Your app may not have webhook subscription permissions');
      console.error('• Go to https://developers.ringcentral.com/');
      console.error('• Edit your app → Permissions → Enable webhook permissions');
    } else {
      console.error('• Check that the webhook URL is accessible: ' + WEBHOOK_URL);
      console.error('• Verify your app configuration in RingCentral Developer Console');
    }
    
    console.error('\nFor manual setup:');
    console.error('   node setup-ringcentral-webhook-manual.js');
    
    process.exit(1);
  }
}

setupWebhook();
