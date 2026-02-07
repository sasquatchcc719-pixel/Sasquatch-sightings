# Future Projects

Backlog of planned improvements and features.

---

## Second Phone Number for Direct vs AI Chats

**Priority:** Medium  
**Status:** Not started

### Goal

Separate "direct texts" (people who contact your business number directly) from "AI chats" (people who came through vendor NFC cards, business card, or contest) using two different phone numbers instead of keyword detection.

### Current State

- One Twilio number (**719-249-8791**) handles all SMS
- Source is inferred from message content (keywords like "found your card," "sasquatch," etc.)
- Inferred sources: `inbound` (direct), `NFC Card` (vendor), `Business Card`, `Contest`
- Misclassification is possible when people don't mention how they found you

### Second Number

- **970-536-5154** – already purchased (~$1.50), currently on Twilio
- Voice: points to Twilio demo (not our app)
- Messaging: "My New Notifications Service" (different from main number's A2P service)

### What Needs to Happen

**1. Twilio setup**
- Add 970 number to **Sole Proprietor A2P Messaging Service** (or verify My New Notifications Service has A2P)
- Point messaging webhook to same endpoint: `/api/twilio/sms-incoming`
- Configure voice webhook if needed

**2. App changes**
- In `src/app/api/twilio/sms-incoming/route.ts`: use the **To** number (which number received the text) to determine source, instead of keyword detection
- 719 = direct (inbound)
- 970 = funnel (vendor/business card/contest – could sub-classify later or keep as one group)

**3. Marketing / placement**
- Vendor NFC cards → show 970 number
- Business card → show 970 number
- Contest page → show 970 number
- Main number (719) stays on Google, calls, voicemail, anywhere people find you directly

### Why It Matters

- Clean separation, no guessing
- Reliable reporting: "How many texts came from vendor cards?"
- Simpler mental model
- Should do before scaling SMS volume

---

*Last updated: Feb 2026*
