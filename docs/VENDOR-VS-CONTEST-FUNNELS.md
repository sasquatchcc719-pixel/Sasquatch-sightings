# Vendor vs Contest Funnels — Keep Them Separate to Compare

Two distinct lead funnels are tracked so you can compare which pays off better.

## The Two Funnels

| Funnel | Where it starts | How they're tagged | Admin view |
|--------|-----------------|--------------------|------------|
| **Vendor** | Customer taps NFC card at a **vendor location** (e.g. barbershop, gym). Lands on `/location/[partnerId]`. CTA = $20 off, text to book. **No contest.** | First SMS pre-fill: "I found your card at [Partner Name]…" → `conversations.source` = **NFC Card** (and `metadata.partner_id` set). | **Marketing → Vendor Chats** (`/admin/conversations?source=vendor`) |
| **Contest** | Truck / sightings / contest (e.g. "spotted the truck", "contest"). CTA includes contest entry. | First message mentions contest/truck/sighting → `conversations.source` = **Contest**. | **Marketing → Contest Chats** (`/admin/conversations?source=contest`) |

## How We Keep Them From Mixing

- **Vendor page** (`/location/[partnerId]`): No contest CTA. Pre-filled SMS body includes “found your card at [partner name]” so the system tags the conversation as **NFC Card** and attaches the partner.
- **Contest/truck**: Different entry point and messaging (contest, sightings, “spotted the truck”), so first message triggers **Contest**.
- **SMS routing** (`api/twilio/sms-incoming`): Source is set from the **first message** (NFC phrases + partner name → vendor; contest phrases → contest). Same phone can have one conversation per source (vendor vs contest vs inbound).

## How to Compare Payoff

1. **Conversations by funnel**
   - **Vendor Chats:** Marketing → Vendor Chats (only vendor NFC conversations).
   - **Contest Chats:** Marketing → Contest Chats (only contest conversations).

2. **Conversion**
   - Use lead status and any booking/job linkage you have. Compare “Vendor Chats” vs “Contest Chats” (e.g. how many per funnel became leads, booked, etc.).

3. **Tap volume (vendor only)**
   - **Vendor List** (Location Partners): tap counts per vendor. **Tap Analytics** for your own NFC card (business card) taps.

Keeping contest off the vendor page keeps the vendor funnel higher-intent so you can measure quality (vendor) vs volume (contest) and see which pays off better.
