const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

// Read .env.local
const envPath = path.join(process.cwd(), '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');

const getEnv = (key) => {
    const match = envContent.match(new RegExp(`${key}=(.+)`));
    return match ? match[1].trim() : '';
};

const clientId = getEnv('GOOGLE_CLIENT_ID');
const clientSecret = getEnv('GOOGLE_CLIENT_SECRET');
const refreshToken = getEnv('GOOGLE_REFRESH_TOKEN');

const auth = new google.auth.OAuth2(clientId, clientSecret);
auth.setCredentials({ refresh_token: refreshToken });

const accountManagement = google.mybusinessaccountmanagement('v1');
const businessInformation = google.mybusinessbusinessinformation('v1');

(async () => {
    try {
        console.log('Fetching Accounts...');
        const accountsRes = await accountManagement.accounts.list({ auth });
        const account = accountsRes.data.accounts?.[0];

        if (!account) throw new Error('No accounts found');
        const accountId = account.name.split('/')[1];
        console.log(`Account Found: ${account.name} -> ID: ${accountId}`);

        console.log('Fetching Locations...');
        const locationsRes = await businessInformation.accounts.locations.list({
            parent: account.name,
            readMask: 'name,title',
            auth,
        });

        const location = locationsRes.data.locations?.[0];
        if (!location) throw new Error('No locations found');

        const locationId = location.name.split('/')[1];
        console.log(`Location Found: ${location.title} (${location.name}) -> ID: ${locationId}`);

        console.log('\n--- ADD THESE TO .ENV.LOCAL ---');
        console.log(`GOOGLE_ACCOUNT_ID=${accountId}`);
        console.log(`GOOGLE_LOCATION_ID=${locationId}`);

    } catch (error) {
        console.error('Error fetching IDs:', error.message);
        if (error.response) {
            console.error('API Error:', error.response.data);
        }
    }
})();
