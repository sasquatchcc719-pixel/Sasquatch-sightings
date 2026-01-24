# Quick Start: Run RingCentral Webhook Setup

## What You Need

1. Your RingCentral login credentials:
   - Username (phone number or email)
   - Password
   - Extension (if you use one, otherwise leave blank)

## Steps

### 1. Add Credentials to `.env.local`

Open `.env.local` and fill in these values:

```bash
# RingCentral credentials (already in file, just fill in the values)
RINGCENTRAL_CLIENT_ID=WCfoTe4MMO8fPxAzLo3P6v  # Already filled
RINGCENTRAL_CLIENT_SECRET=4gaHOBidjlldlmJeZSIS2PbVD8SKDFzo5bNbvKdy6WT9  # Already filled
RINGCENTRAL_USERNAME=YOUR_RINGCENTRAL_PHONE_OR_EMAIL_HERE
RINGCENTRAL_PASSWORD=YOUR_RINGCENTRAL_PASSWORD_HERE
RINGCENTRAL_EXTENSION=  # Leave blank unless you use extensions
RINGCENTRAL_PHONE_NUMBER=+17197498807  # Your main business number
```

**Example:**
```bash
RINGCENTRAL_USERNAME=john@sasquatchcarpet.com
RINGCENTRAL_PASSWORD=mySecurePassword123
RINGCENTRAL_EXTENSION=
RINGCENTRAL_PHONE_NUMBER=+17197498807
```

### 2. Run the Setup Script

```bash
node setup-ringcentral-webhook.js
```

### Expected Output

If successful, you'll see:

```
Logging into RingCentral...
✓ Login successful!
Creating webhook subscription...
✓ Webhook created successfully!
Subscription ID: abc-123-def-456
Webhook URL: https://sightings.sasquatchcarpet.com/api/leads
Status: Active
```

### Troubleshooting

**Error: "Invalid credentials"**
- Check your username/password in `.env.local`
- Make sure you're using the same credentials you use to log into RingCentral

**Error: "Extension not found"**
- If you don't use extensions, leave `RINGCENTRAL_EXTENSION=` blank
- If you do use extensions, make sure the extension number is correct

**Error: "Webhook URL must be HTTPS"**
- This script only works with the production URL
- Make sure you've deployed to Vercel first

## What Happens Next?

Once the webhook is registered:

1. When someone calls and you miss it → RingCentral sends a webhook
2. Your `/api/leads` endpoint receives it
3. System creates a lead, sends SMS, and sends push notification

## Testing

After setup, test it:
1. Call your RingCentral number from another phone
2. Let it ring without answering
3. Check `/admin/leads` for a new "missed_call" lead

## Need Help?

- Full documentation: See `RINGCENTRAL_SETUP.md`
- Quick reference: See `INTEGRATION_SUMMARY.md`
