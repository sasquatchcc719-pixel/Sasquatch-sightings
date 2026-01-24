# How to Get Your RingCentral JWT Private Key

## Quick Steps (5 minutes)

### Step 1: Go to RingCentral Developer Console
Visit: **https://developers.ringcentral.com/**

Log in with: `sasquatchcc719@gmail.com`

### Step 2: Select or Create Your App

**Option A - If you have an existing app:**
1. Click **"My Apps"**
2. Select your app from the list

**Option B - If you need to create a new app:**
1. Click **"Create App"**
2. Choose **"Server/Bot"** app type
3. Name it: `Sasquatch Webhook App`
4. Click **"Create"**

### Step 3: Enable JWT Authentication

1. In your app, go to the **"Auth"** tab
2. Under **"OAuth 2.0 Settings"**, check:
   - ✅ **JWT Auth Flow**
3. Under **"Permissions"**, ensure these are enabled:
   - ✅ **Read Accounts**
   - ✅ **Webhook Subscriptions**
   - ✅ **Read Presence**
4. Click **"Save"**

### Step 4: Download Private Key

1. Go to the **"Credentials"** tab
2. Under **"JWT Credentials"** section:
   - Click **"Create/Download Private Key"**
   - A file named `private_key.pem` will download

### Step 5: Add to `.env.local`

1. Open the downloaded `private_key.pem` in a text editor
2. Copy the **entire content** (including BEGIN/END lines)
3. Open your `.env.local` file
4. Find the `RINGCENTRAL_JWT_PRIVATE_KEY` line
5. Replace the placeholder with your key:

```bash
RINGCENTRAL_JWT_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA1234567890abcdefghijklmnopqrstuvwxyz...
(your key will be many lines long)
...rest of your key...
-----END RSA PRIVATE KEY-----"
```

**Important:** 
- Keep the quotes `"` around the key
- Include all the line breaks (the key is multiline)
- Don't add extra spaces or modify the key content

### Step 6: Run the Setup Script

```bash
node setup-ringcentral-webhook-jwt.js
```

You should see:
```
✓ Authentication successful!
✓ Webhook created successfully!
✅ Setup complete!
```

---

## Example Private Key Format

Your `.env.local` should look like this:

```bash
RINGCENTRAL_JWT_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEAxyzK4kGt8WXwnJVasdEw/qrQPdWHvqPn4jvF3z1bkYXc5gF+
N8pMN1xR7YzQ2LvKj4pXm8nW9Kp+vL8hJ5nM/Wp9L8dF2xG1Hq7Y+3gT5vH8kJ9L
... (many more lines) ...
dW5hYXNkZmFkYXN0ZGZhZGZhc2RmYXNkZmFzZGZhc2RmYXNkZmFzZGY=
-----END RSA PRIVATE KEY-----"
```

---

## Troubleshooting

### "Invalid JWT" Error
- Make sure you copied the entire key including BEGIN/END lines
- Check that there are no extra spaces or line breaks
- Verify the key hasn't expired (regenerate if needed)

### "Unauthorized" Error
- Make sure JWT Auth Flow is enabled in your app settings
- Verify your app has the correct permissions (Webhook Subscriptions, Read Presence)
- Try regenerating the private key

### Still Not Working?
Use the manual setup instead:
```bash
node setup-ringcentral-webhook-manual.js
```

This will guide you through setting up the webhook via the RingCentral web UI.

---

## Security Note

⚠️ **Keep your private key secure!**
- Never commit `.env.local` to git (it's already in `.gitignore`)
- Don't share your private key with anyone
- If compromised, regenerate a new key immediately in the Developer Console
