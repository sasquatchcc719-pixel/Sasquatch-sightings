/**
 * Alternative RingCentral Webhook Setup
 * This script walks you through setting up the webhook manually via the RingCentral Developer Console
 * Since password auth is deprecated, we'll guide you through the web UI approach
 */

console.log('═══════════════════════════════════════════════════════════════');
console.log('  RingCentral Webhook Setup - Manual Configuration Guide');
console.log('═══════════════════════════════════════════════════════════════\n');

console.log('⚠️  NOTE: RingCentral deprecated password authentication on March 31, 2024.');
console.log('    We need to set up the webhook manually through their Developer Console.\n');

console.log('📋 STEP 1: Log into RingCentral Developer Console');
console.log('   Go to: https://developers.ringcentral.com/');
console.log('   Login with: sasquatchcc719@gmail.com\n');

console.log('📋 STEP 2: Configure Your App for JWT (if not already done)');
console.log('   1. Go to "My Apps"');
console.log('   2. Select your app (or create a new "Server/Bot" app)');
console.log('   3. Click "Edit" → "Auth" tab');
console.log('   4. Enable "JWT Auth Flow"');
console.log('   5. Save changes\n');

console.log('📋 STEP 3: Get Your JWT Token');
console.log('   1. In your app, go to "Credentials"');
console.log('   2. Under "JWT Credentials", click "Create JWT"');
console.log('   3. Copy the JWT token (it\'s very long)\n');

console.log('📋 STEP 4: Add JWT to .env.local');
console.log('   Add this line to your .env.local file:');
console.log('   RINGCENTRAL_JWT=your-jwt-token-here\n');

console.log('📋 STEP 5: Create Webhook Subscription');
console.log('   Option A - Via API Explorer (Easiest):');
console.log('   1. Go to: https://developers.ringcentral.com/api-reference');
console.log('   2. Search for "Create Subscription"');
console.log('   3. Click "Try it out"');
console.log('   4. Use this JSON body:\n');

const webhookConfig = {
  eventFilters: [
    '/restapi/v1.0/account/~/extension/~/presence?detailedTelephonyState=true'
  ],
  deliveryMode: {
    transportType: 'WebHook',
    address: 'https://sightings.sasquatchcarpet.com/api/leads'
  }
};

console.log(JSON.stringify(webhookConfig, null, 2));
console.log('\n   5. Click "Execute"');
console.log('   6. You should see "Status: Active" in the response\n');

console.log('   Option B - Via This Script (After adding JWT):');
console.log('   1. Add RINGCENTRAL_JWT to .env.local');
console.log('   2. Run: node setup-ringcentral-webhook-jwt.js\n');

console.log('📋 STEP 6: Verify Webhook is Active');
console.log('   1. In Developer Console, go to your app');
console.log('   2. Click "Webhooks" tab');
console.log('   3. You should see an active subscription to:');
console.log('      https://sightings.sasquatchcarpet.com/api/leads\n');

console.log('═══════════════════════════════════════════════════════════════');
console.log('  Once complete, test by calling your RingCentral number!');
console.log('═══════════════════════════════════════════════════════════════\n');

console.log('Need help? See RINGCENTRAL_SETUP.md for detailed instructions.');
