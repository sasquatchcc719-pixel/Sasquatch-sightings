# ⚠️ RingCentral JWT Setup Required

## What You Need

RingCentral uses **JWT authentication** with a private key. You need to download this key from their Developer Console.

---

## Quick Setup (5 minutes)

### Step 1: Download Your Private Key

1. Go to **https://developers.ringcentral.com/**
2. Log in with: `sasquatchcc719@gmail.com`
3. Go to **"My Apps"** → Select your app (or create a "Server/Bot" app)
4. Go to **"Credentials"** tab
5. Under **"JWT Credentials"**, click **"Create/Download Private Key"**
6. A file called `private_key.pem` will download

### Step 2: Add Private Key to `.env.local`

1. Open `private_key.pem` in a text editor
2. Copy the **entire content** (including BEGIN/END lines)
3. Open `.env.local`
4. Find `RINGCENTRAL_JWT_PRIVATE_KEY` and paste your key:

```bash
RINGCENTRAL_JWT_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA1234567890abcdef...
(many lines)
...your key...
-----END RSA PRIVATE KEY-----"
```

### Step 3: Run the Setup

```bash
node setup-ringcentral-webhook-jwt.js
```

Expected output:
```
✓ Authentication successful!
✓ Webhook created successfully!
✅ Setup complete!
```

---

## Detailed Instructions

See **HOW_TO_GET_JWT_KEY.md** for step-by-step instructions with explanations.

---

## Current Status

✅ **OneSignal** - Configured and ready  
✅ **RingCentral Credentials** - Added to `.env.local`  
⏳ **RingCentral Private Key** - Need to download and add  
⏳ **Webhook Setup** - Will run after adding private key

---

## What's Working Now

Even without the webhook, these features are working:
- ✅ Contest entry notifications
- ✅ Partner referral notifications
- ✅ All lead tracking

**Once webhook is set up:**
- ✅ Missed call detection
- ✅ Automatic SMS responses to missed callers
- ✅ Missed call push notifications

---

## Alternative: Manual Setup

If you prefer to set it up via the web UI:

```bash
node setup-ringcentral-webhook-manual.js
```

---

## Files Reference

- **HOW_TO_GET_JWT_KEY.md** ← Detailed guide with screenshots
- **UPDATE_REQUIRED.md** ← This file (quick reference)
- **setup-ringcentral-webhook-jwt.js** ← Automated setup script
- **setup-ringcentral-webhook-manual.js** ← Manual setup guide
