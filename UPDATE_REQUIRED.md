# ⚠️ RingCentral Authentication Update Required

## What Happened

RingCentral **deprecated password authentication** on March 31, 2024. We need to switch to **JWT authentication** instead.

Your credentials have been added to `.env.local`, but we need a JWT token to complete the setup.

---

## Quick Fix (5 minutes)

### Step 1: Get Your JWT Token

1. Go to **[RingCentral Developer Console](https://developers.ringcentral.com/)**
2. Log in with: `sasquatchcc719@gmail.com`
3. Go to **"My Apps"**
4. Select your app (or create a new "Server/Bot" app if needed)
5. Go to **"Credentials"** tab
6. Under **"JWT Credentials"**, click **"Create JWT"**
7. **Copy the entire JWT token** (it's very long, starts with `eyJ...`)

### Step 2: Add JWT to `.env.local`

Open `.env.local` and add this line after the RingCentral section:

```bash
RINGCENTRAL_JWT=your-very-long-jwt-token-here
```

Example:
```bash
RINGCENTRAL_JWT=eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6IjEyMzQ1Njc4OSJ9.eyJpc3MiOiJodHRwczovL3BsYXRmb3JtLnJpbmdjZW50cmFsLmNvbS8iLCJzdWIiOiI0MDQ4NTc4MTIiLCJhdWQiOiJodHRwczovL3BsYXRmb3JtLnJpbmdjZW50cmFsLmNvbS9yZXN0YXBpL3YxLjAvYWNjb3VudC9+L2V4dGVuc2lvbi9+L3RvL...
```

### Step 3: Run Setup Script

```bash
node setup-ringcentral-webhook-jwt.js
```

You should see:
```
✓ Login successful!
✓ Webhook created successfully!
✅ Setup complete!
```

---

## Alternative: Manual Setup (If JWT Script Fails)

If you prefer to set it up manually via the web UI:

```bash
node setup-ringcentral-webhook-manual.js
```

This will show you step-by-step instructions for using the RingCentral API Explorer.

---

## Current Status

✅ **OneSignal** - Configured and ready
✅ **RingCentral Credentials** - Added to `.env.local`
⏳ **RingCentral JWT** - Waiting for you to add it
⏳ **Webhook Setup** - Will be done after JWT is added

---

## What's Working Now

Even without the webhook, these features are working:
- ✅ Contest entry notifications
- ✅ Partner referral notifications
- ✅ All lead tracking

**Once webhook is set up:**
- ✅ Missed call detection
- ✅ Automatic SMS responses
- ✅ Missed call push notifications

---

## Files Created

- `setup-ringcentral-webhook-jwt.js` - Automated setup with JWT
- `setup-ringcentral-webhook-manual.js` - Manual setup guide
- `UPDATE_REQUIRED.md` - This file

---

## Need Help?

See the full guide: `RINGCENTRAL_SETUP.md`

Or just run: `node setup-ringcentral-webhook-manual.js` for step-by-step instructions.
