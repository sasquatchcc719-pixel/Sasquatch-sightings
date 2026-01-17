const { google } = require('googleapis');
const http = require('http');
const url = require('url');
const readline = require('readline');
const fs = require('fs');
const path = require('path');

// Read .env.local to find defaults
let defaultClientId = '';
let defaultClientSecret = '';

try {
    const envPath = path.join(process.cwd(), '.env.local');
    if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf8');
        const clientIdMatch = envContent.match(/GOOGLE_CLIENT_ID=(.+)/);
        const clientSecretMatch = envContent.match(/GOOGLE_CLIENT_SECRET=(.+)/);
        if (clientIdMatch) defaultClientId = clientIdMatch[1].trim();
        if (clientSecretMatch) defaultClientSecret = clientSecretMatch[1].trim();
    }
} catch (e) {
    // Ignore
}

// Create readline interface for user input
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const askQuestion = (query, defaultVal) => {
    return new Promise(resolve => {
        rl.question(defaultVal ? `${query} [${defaultVal.substring(0, 10)}...]: ` : `${query}: `, (answer) => {
            resolve(answer.trim() || defaultVal);
        });
    });
};

(async () => {
    console.log('\n--- Google Business Profile Token Generator ---');
    console.log('Using credentials from .env.local if available.');
    console.log('Ensure Authorized Redirect URI is set to: http://localhost:3000/oauth2callback');
    console.log('-----------------------------------------------\n');

    const clientId = await askQuestion('Enter Client ID', defaultClientId);
    const clientSecret = await askQuestion('Enter Client Secret', defaultClientSecret);

    if (!clientId || !clientSecret) {
        console.error('Error: Client ID and Secret are required.');
        process.exit(1);
    }

    // Create OAuth2 client
    const oauth2Client = new google.auth.OAuth2(
        clientId,
        clientSecret,
        'http://localhost:3001/oauth2callback'
    );

    // Scopes for Google Business Profile
    const scopes = [
        'https://www.googleapis.com/auth/business.manage'
    ];

    // Generate Auth URL
    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: scopes,
        prompt: 'consent' // Force refresh token generation
    });

    console.log('\n-----------------------------------------------');
    console.log('Open this URL in your browser to authorize:');
    console.log('-----------------------------------------------');
    console.log(authUrl);
    console.log('-----------------------------------------------\n');

    // Start local server to handle callback
    const server = http.createServer(async (req, res) => {
        if (req.url.startsWith('/oauth2callback')) {
            try {
                const qs = new url.URL(req.url, 'http://localhost:3001').searchParams;
                const code = qs.get('code');

                if (code) {
                    res.end('Authentication successful! You can close this tab and check your terminal.');

                    const { tokens } = await oauth2Client.getToken(code);

                    console.log('\n--- SUCCESS! ---');
                    console.log('Copy this REFRESH TOKEN to your .env.local file:');
                    console.log('-----------------------------------------------');
                    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
                    console.log('-----------------------------------------------');

                } else {
                    res.end('Error: No code found.');
                }
            } catch (error) {
                console.error('Error exchanging token:', error);
                res.end('Error during authentication.');
            } finally {
                server.close();
                rl.close();
                process.exit(0);
            }
        }
    });

    server.listen(3001, () => {
        console.log('Waiting for authentication on port 3001...');
    });

})();
