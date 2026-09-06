# Echo Content Engine Plan

## System Context: The Full Stack

This section exists so any AI model reviewing Echo understands the complete system it operates inside. Echo is not a standalone tool — it is one output layer of a larger platform designed from the beginning to win the Monument, CO local map pack.

**The overarching goal of every piece of this system is to own the Google Maps local pack in the Monument / Tri-Lakes / Palmer Lake / Woodmoor / Black Forest market for carpet cleaning. Every feature below exists in service of that goal.**

### The Monument Market

Sasquatch Carpet Cleaning is a local service area business operating out of Monument, CO. Primary service areas: Monument, Palmer Lake, Woodmoor, Gleneagle, Black Forest, North Colorado Springs, Castle Rock, Larkspur, Tri-Lakes area, El Paso County.

Services: carpet cleaning, pet urine treatment, upholstery cleaning, tile and grout cleaning, commercial carpet cleaning, stain removal, odor treatment (hot water extraction / truck-mounted / CRB agitation process).

Current position: 68 five-star Google reviews as of June 2026, strong review velocity, competing against legacy companies with 1,000–3,000 reviews. Several competitors with fewer reviews are currently outranking in the map pack. The goal is consistent, dominant map pack presence.

### Sasquatch Sightings (the Admin Platform)

`sasquatchcc719-pixel/Sasquatch-sightings` — Next.js 16 / React 19 / TypeScript / Tailwind / Supabase / Vercel. This is the internal operations platform Charles uses to run the business. Everything below lives here.

**Harry** (`src/lib/harry/`) — SMS automation agent. Handles inbound customer texts: new booking requests, reschedule requests, appointment lookups, address updates, job notes. Multi-phase state machine. This is an operational tool, not a marketing tool. It keeps customers managed so the business runs smoothly and reviews stay positive — indirect map pack support through customer satisfaction. Harry is already at scope capacity and should not be given additional responsibilities.

**George** (`src/app/api/admin/george/`) — Admin AI agent. Handles back-office tasks: phone settings, QuickBooks operations, scheduling decisions. Enabled by default in production with `GEORGE_HENDERSON_ROLLOUT_MODE=confirm_actions`.

**Rabecca** (`src/lib/retell/`) — Voice AI via Retell. Gated by `REBECCA_VOICE_ENABLED`. Not wired into live call routing — only gates the `/api/retell/functions` endpoint.

**Call Routing** — Twilio inbound calls route through `/api/twilio/call-router`. Business hours (9am–5pm MT Mon–Fri) and all forward numbers come from the `phone_settings` table. IVR menu: press 1 to book/change an appointment, press 2 for active water damage routed to Charles + browser client. After hours, press 2 remains available for water damage; all other calls go to voicemail + SMS follow-up.

**Job / Invoice System** — Core operational workflow. Invoices are created and published via `/api/admin/ops/invoices/[id]/publish`. Publishing a job: creates a job record with city, service, line items, before/after images, and an AI-generated description. This is the trigger point for Echo.

**Job Map / Job Pages** — Every published job creates a permanent public-facing page. These are real proof pages: city, service, process, images, description. They live on the public site and are crawlable. This is a key local SEO asset — real job proof with real city + service combinations indexed by Google. These pages feed prominence and relevance signals for the map pack.

**Echo** (`src/lib/echo/`) — Google Business Profile and Facebook content automation. Triggered automatically when a job is published. Decides whether to skip, draft, or post content based on settings, weekly cap, and repeat-city rules. Generates varied copy via OpenAI (style memory, opener ban list). Delivers to Google Business Profile and Facebook via Zapier webhooks. Admin UI at `/admin/social-posts`. Currently built and complete but awaiting Zapier setup (two webhook env vars not yet configured). Full spec in `docs/ECHO_V1_SPEC.md`.

**SERP Tracking** — Daily cron job (`track-serps`) monitors keyword rankings. Provides data on where the business is currently appearing in search results.

**Review Builder** — Exists on the customer-facing website. Customers are directed here from multiple touchpoints: post-job close-out, 3-day follow-up SMS, NFC business card / magnet. Funnels happy customers to leave Google reviews.

**QuickBooks Sync** — Financial sync cron. Keeps job/invoice data in sync with accounting. Operational, not SEO-relevant.

**Gmail Intake** — Cron reads incoming Gmail for customer requests, feeds into the task/booking system.

**Push Notifications** — OneSignal integration for customer/admin notifications.

**Cron Jobs** — 13 total in `vercel.json`. Includes job reminders (every 5 min), Gmail intake + task worker (every 10 min), daily SERP tracking, QuickBooks sync, booking cleanup, and others.

### SasquatchCarpet.com (the Customer Website)

`sasquatchcc719-pixel/sasquatch.com-client` — HTML-based site deployed on Vercel. This is the public-facing marketing website that Google indexes and that GBP links point to.

**Known features:**
- Main marketing site for Sasquatch Carpet Cleaning
- Review builder / review funnel page
- Job pages / map (proof pages generated from Sightings jobs, either embedded or linked)
- NFC business card / magnet links to review page

**Gap:** This repo was not accessible during the session this section was written. A full audit of service area pages, blog/field notes, internal linking structure, and on-page SEO signals still needs to be done. Before any strategic recommendation about Echo or map pack ranking is finalized, the website structure should be reviewed — specifically: which city/service pages exist, how job pages are structured, whether there are blog or field notes pages, and how the site links internally.

### How the System Works Together Toward the Map Pack

```
Customer calls / texts
→ Harry manages booking → job gets scheduled → Charles does the job
→ Invoice published in Sightings
→ Job page created (permanent local proof, indexed by Google)
→ Echo triggered → evaluates job quality → drafts or posts GBP update
→ Customer receives 3-day follow-up → directed to review builder → Google review posted
→ SERP tracker monitors ranking movement
→ All of this feeds: relevance (real service + city signals), prominence (reviews, indexed job pages, GBP activity), and behavioral signals (GBP clicks/calls)
```

The platform was designed from November 2025 onward with the map pack as the explicit end goal. Individual features should be evaluated against that goal, not in isolation.

### What Has Changed Since November 2025

Google's local ranking environment shifted meaningfully between when this system was designed and mid-2026:

- **AI Overviews** expanded into local search — businesses now need signals that feed AI-generated local answers, not just the traditional map pack
- **Behavioral signals** (clicks, calls, direction requests from GBP) carry more weight in 2026 than when the original plan was written
- **Review recency** now outweighs total review count — velocity matters more than volume
- **August 2025 Spam Update** targeted GBP keyword stuffing and fake profiles — benefits legitimate businesses with real job proof
- **GBP posts** confirmed by controlled studies (Sterling Sky, 441 keywords) to have **zero direct effect on map pack position** — they help click-through rate and feed freshness signals but do not move rank

Any AI model reviewing this system should evaluate Echo's design against the 2026 reality, not the November 2025 assumptions it was built on.

---

## Working Goal

Build Echo, an agent-backed Google Updates and local SEO content engine that stops dumping every finished job directly into Google Business Profile.

The system should collect real job proof, generate useful local authority content, decide the right timing, and publish the right item to the right channel.

Google Business Profile is the priority. Zapier can stay as the easy delivery pipe for Facebook, Instagram, LinkedIn, and other annoying platforms.

## Current Repair Status

As of 2026-05-27, the current invoice publish system creates the map/job page successfully, but Google Business Profile and Zapier posting were too silent.

Repair pass completed:

- Invoice publish now returns explicit `channels.googleBusiness` and `channels.zapier` results.
- The invoice UI now reports whether the job page was created, whether Google Business posted, and whether Zapier accepted the payload.
- Direct Google Business posting now validates required OAuth config before trying to post.
- A Google Business status endpoint exists at `/api/admin/google-business/status`.
- `social_posted_at` is updated only when direct Google Business posting succeeds.
- Social draft posting no longer marks a draft posted when both Google Business and Zapier fail.
- Map/job-page publishing remains unchanged and should continue to work even if Google/Zapier fail.

Known unresolved items:

- Real env files currently show `ZAPIER_WEBHOOK_URL`, but not `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, or `GOOGLE_REFRESH_TOKEN`; direct Google posting still needs OAuth credentials.
- `GOOGLE_ACCOUNT_ID` and `GOOGLE_LOCATION_ID` are optional but recommended so the exact Business Profile location is pinned.
- Zapier webhook could not be tested from the sandbox because outbound network failed before Zapier returned a response. Test from production logs or a non-sandbox terminal.
- Echo content queue/scheduler/skills are still plan-only and not implemented.

## Feature Name

**Echo**

Echo takes the real work Sasquatch does and echoes it out as proof, expertise, and updates at the right time.

## Core Strategy

Own the brain. Own Google. Use Zapier for the annoying social plumbing.

```text
Finished job / field notes / images
→ content inventory
→ Echo
→ draft or schedule
→ direct Google Business Profile post
→ optional Zapier webhook for other platforms
→ log every result
```

Google Updates should become an announcement channel, not the source of truth.

Permanent content should live in two places:

1. Real completed jobs go on the map/job pages.
2. Non-job authority content goes in a blog / field notes library.

## Agent vs Automation Split

Echo is an agent feature with automation underneath.

The automation layer is the clock, queue, safety rails, delivery, retry, and logging system.

The agent layer is the editor. It reasons about content quality, local SEO value, timing, variety, risk, channel fit, and what asset or copy needs to be created.

### Agent Features

Echo should be able to:

- Review the content inventory and explain what it wants to post next.
- Score real jobs for Google Update potential.
- Decide whether a job should be map-only, Google-worthy, Zapier-worthy, or saved for later.
- Decide whether a non-job idea should become a blog / field note.
- Choose the post type: job spotlight, educational tip, seasonal update, local area post, offer, event, behind the scenes, brand/mascot visual.
- Write Google Business Profile copy.
- Write blog / field note drafts.
- Rewrite copy for channel fit.
- Recommend a target URL: booking page, job page, blog post, service page, or offer page.
- Decide whether an item needs approval.
- Explain its reasoning in plain language.
- Flag risks: weak photo, missing city, duplicate topic, overposting, too salesy, too generic, phone number in Google post body, fake-looking image, privacy issue.
- Request Gemini/Nano Banana visual generation or image editing when useful.
- Keep the feed varied over time.

### Automation Features

The automation layer should:

- Wake Echo on a schedule.
- Ingest finished jobs into the content queue.
- Ingest manual content ideas.
- Enforce weekly Google post limits.
- Enforce spacing between posts.
- Enforce no duplicate/same-style back-to-back posting.
- Publish approved/scheduled posts.
- Send finished content to Zapier when enabled.
- Log every post attempt and result.
- Retry safe failures.
- Alert when Google posting fails.
- Keep old drafts from silently sitting forever.
- Maintain status fields for queued, drafted, approved, scheduled, posted, skipped, and failed content.

### Human Controls

The admin should be able to:

- See Echo's recommended next posts.
- Approve, reject, edit, or schedule drafts.
- Force-post a specific item.
- Pause Echo.
- Set weekly posting limits.
- Set priority service areas.
- Set priority services.
- Choose whether a content type can auto-post or requires approval.
- View post logs and failures.
- Talk to Echo through Telegram.

## Telegram Command Surface

Echo needs to be conversational, not only a dashboard/cron feature.

Telegram should be the fast command and approval surface for Charles.

Use cases:
- Ask Echo what it wants to post next.
- Ask why Echo chose or skipped something.
- Approve/reject drafts from the phone.
- Tell Echo to hold, schedule, rewrite, or post something.
- Submit a manual content idea.
- Ask for recent Google/Zapier failures.
- Ask for the weekly content calendar.

Example commands:

```text
/echo status
/echo next
/echo drafts
/echo approve <draft_id>
/echo reject <draft_id>
/echo rewrite <draft_id> more local, less salesy
/echo schedule <draft_id> tomorrow 9am
/echo post <draft_id>
/echo pause
/echo resume
/echo failures
/echo calendar
/echo idea winter salt and sand carpet damage in Monument
```

Natural language should also work:

```text
Echo, what should we post this week?
Echo, why did you skip the Castle Rock job?
Echo, make this one more educational.
Echo, post the Woodmoor pet odor job tomorrow morning.
Echo, send the next approved post to Google only.
```

## Proactive Telegram Recommendation Flow

Echo should message Charles when the timing is good instead of expecting him to constantly check a dashboard.

Default behavior:

```text
When Echo sees a good posting window:
1. It reviews eligible content.
2. It chooses 2-4 strong options.
3. It messages Charles in Telegram with the options.
4. Charles picks one, asks for a rewrite, schedules it, or holds.
5. Echo drafts the final copy/image.
6. Charles approves/schedules/posts.
```

Example Telegram message:

```text
Echo: Good window for a Google Update tomorrow morning.

I found 3 good options:

1. Woodmoor pet odor job
   Strong real photo, good local signal, recent work.

2. Spring booking window
   Seasonal, but promotional. Needs approval.

3. Winter salt field note
   Useful authority content, would link to the guide.

Pick one:
[Draft 1] [Draft 2] [Draft 3] [Hold]
```

Echo should explain why each option is worth considering in one short line.

Echo should not dump a long analysis unless asked.

### Telegram Approval Buttons

Echo Telegram messages should include inline buttons when useful:

- Approve
- Reject
- Rewrite
- Schedule
- Post Now
- Google Only
- Google + Zapier
- Hold

### Telegram Guardrails

- Only approved admin Telegram users can control Echo.
- Destructive actions should require confirmation.
- Offers/discounts should not auto-post from casual text without confirmation.
- Echo should summarize exactly what it will post before publishing from Telegram.
- Telegram commands should log an audit event.

## Echo Skill System

Echo should be built as a set of explicit skills, not one giant prompt.

Each skill should have a clear input, output, guardrails, and tests/examples.

### Skill 1: Intake Skill

Purpose: Convert raw finished job data or manual ideas into normalized content inventory.

Inputs:
- invoice/job record
- city/neighborhood/GPS
- service type
- line items
- field notes
- photo URL(s)
- generated description
- manual idea text

Outputs:
- normalized content item
- source type
- missing fields
- initial suggested post type

Guardrails:
- Never allow `Unknown` city without fallback.
- Do not expose private customer address.
- Do not create fake job facts.

### Skill 2: Local SEO Scoring Skill

Purpose: Score content for Google/local SEO usefulness.

Signals:
- real city/area present
- service keyword present
- customer problem present
- real photo present
- process details present
- target URL available
- recent duplicate risk
- priority city/service match
- seasonality

Outputs:
- `local_seo_score`
- `quality_score`
- explanation
- blockers

### Skill 3: Editorial Decision Skill

Purpose: Decide what should happen to a content item.

Possible decisions:
- map/job page only
- draft Google Update
- draft blog / field note
- schedule later
- send to Zapier after Google
- skip
- require approval

Outputs:
- recommended action
- recommended post type
- recommended channel(s)
- recommended timing
- reasoning

### Skill 4: Copywriting Skill

Purpose: Write useful, local, non-spammy copy.

Variants:
- Google Update copy
- blog / field note draft
- Zapier/social caption
- offer/event copy
- short title
- excerpt

Guardrails:
- No keyword stuffing.
- No phone number in Google post body.
- No fake claims.
- No private address.
- Use service + city naturally.
- Keep Google copy concise.

### Skill 4A: Sasquatch Humor Voice Skill

Purpose: Add light, wholesome humor without sacrificing trust, clarity, or SEO.

Based on the existing `nate-bargatze-writer` style guide:
- 70% straight business information.
- 30% quiet, self-deprecating, conversational humor.
- The page/post must still work if every funny line is removed.
- Humor is seasoning, not the meal.
- Sasquatch should sound noticeably funny, not accidentally funny once every five paragraphs.

Allowed voice traits:
- humble competence
- warm local business owner tone
- mild self-deprecation
- small confused aside about ordinary things
- plainspoken anti-jargon explanations
- slow-burn understated humor

Not allowed:
- sarcasm
- mean jokes
- competitor jokes
- edgy humor
- jokes that replace service/location information
- fake modesty that sounds like bragging
- comedy in meta descriptions or technical SEO fields

Where humor is safest:
- blog / field notes
- behind-the-scenes posts
- brand/mascot posts
- FAQ-style educational content
- light social captions

Where humor should be very restrained:
- Google Business Profile job spotlights
- offers
- events
- review-related posts
- commercial work
- water damage/restoration or urgent service content

Google Update humor rule:

```text
For Google Business Profile posts, Echo may use one clear funny aside, or two very small ones if the post is educational/behind-the-scenes.
The service, location, process, and CTA must stay clear.
```

Example pattern:

```text
Straight: We cleaned pet-tracked carpet in Woodmoor using pre-spray, CRB agitation, and hot water extraction.
Humor layer: Carpet is basically a fabric sidewalk inside your house, so it asks a lot from everybody.
```

Skill workflow:
1. Lock in SEO skeleton: service, city, process, target URL.
2. Write the straight useful version.
3. Add enough earned humor to make the voice noticeable without turning the post into a bit.
4. Re-check that local SEO signals remain intact.
5. Offer mild vs fuller humor for lower-risk content.

### Skill 5: Image Selection Skill

Purpose: Decide which image should represent the post.

Possible outputs:
- use real before/after image
- use finished job image
- generate branded visual
- create blog header
- skip image
- request manual review because image is weak/risky

Signals:
- image exists
- before/after clarity
- customer privacy risk
- visual quality
- whether this is real job proof or authority content

### Skill 6: Gemini/Nano Banana Visual Skill

Purpose: Generate or edit visuals for non-job authority content and branded social variants.

Use cases:
- seasonal graphic
- mascot image
- blog header
- Google/Zapier social format variant
- branded educational visual

Guardrails:
- Do not fake real before/after results.
- Do not imply a generated interior is a real customer home.
- Prefer real job images for job spotlight posts.

### Skill 7: Schedule Skill

Purpose: Choose publish timing.

Rules:
- Respect weekly cap.
- Space posts apart.
- Prefer stronger windows.
- Avoid same-style repetition.
- Save strong job proof for useful windows.
- Avoid posting too soon after another update.

Outputs:
- `scheduled_for`
- reason
- fallback if schedule is full

### Skill 8: Publishing Skill

Purpose: Execute approved publishing.

Targets:
- Google Business Profile direct API
- Zapier outbound webhook
- website blog / field notes
- map/job pages already handled by job publishing

Outputs:
- platform result
- external post ID
- error details

Guardrails:
- One platform failure should not erase content.
- Google result must be explicit.
- Zapier result must be logged.

### Skill 9: Logging And Memory Skill

Purpose: Give Echo memory so it does not repeat itself.

Tracks:
- posts by platform
- post type history
- city history
- service history
- failures
- skipped reasons
- approval decisions

Outputs:
- feed variety context
- duplicate warnings
- performance notes later

### Skill 10: Review/Approval Skill

Purpose: Decide if a draft is safe to auto-post or needs human review.

Approval triggers:
- offer/discount
- weak or sensitive image
- generated image representing real work
- uncertain location
- medical/health claim
- commercial client name
- unusual service or claim
- low confidence

Outputs:
- approval_required
- reason
- suggested edits

### Skill 11: Telegram Conversation Skill

Purpose: Let Charles talk to Echo through Telegram.

Capabilities:
- Parse Echo commands.
- Interpret natural language instructions.
- Fetch queue/draft/status context.
- Ask clarifying questions when needed.
- Trigger approval/rejection/scheduling/posting actions.
- Explain Echo's reasoning.
- Build Telegram messages with inline action buttons.

Guardrails:
- Authenticate the Telegram sender.
- Require confirmation for risky publishing actions.
- Log every command and action.
- Never publish if the requested content violates approval rules.

## Content Buckets

### 1. Real Job Proof

Source: actual finished invoice/job.

Destination:
- public map
- job page
- optional Google Update when timing and quality are right
- optional Zapier/social distribution

Examples:
- Pet odor carpet cleaning in Woodmoor
- Commercial carpet cleaning in Colorado Springs
- Tile and grout cleaning in Monument
- Move-out carpet cleaning in Castle Rock

Required data:
- job/invoice ID
- city
- neighborhood or service area if available
- fuzzy GPS
- service type
- before/after or finished photo
- field notes
- process used
- public job page URL

### 2. Authority Content

Source: generated or planned educational/local content.

Destination:
- blog / field notes library
- optional Google Update linking to the article
- optional Zapier/social distribution

Does not go on the job map.

Examples:
- Why Colorado mud season damages carpet
- Pet urine treatment vs regular carpet cleaning
- Why CRB agitation matters before hot water extraction
- How often Monument homeowners should clean carpet
- Winter salt and sand: what it does to carpet fibers

## Google Ranking Signals To Feed

Google says local ranking is mainly based on relevance, distance, and prominence.

### Relevance

Every post or page should clearly connect to a service or customer problem:
- carpet cleaning
- pet urine treatment
- upholstery cleaning
- tile and grout
- commercial carpet cleaning
- stain removal
- odor treatment
- hot water extraction
- CRB agitation
- truck-mounted cleaning

Avoid keyword stuffing. Make it sound like a real local expert explaining real work.

### Distance / Location

Every post or page needs a real local anchor:
- Monument
- Palmer Lake
- Woodmoor
- Gleneagle
- Black Forest
- Colorado Springs
- Castle Rock
- Larkspur
- Tri-Lakes area
- North Colorado Springs
- El Paso County

Never publish or store `Unknown` as the city. Use a fallback region if exact city resolution fails.

### Prominence

Build proof and authority over time:
- real job pages
- real photos
- public map pins
- internal links between service, city, and job pages
- reviews
- structured business information
- consistent Google Updates
- crawlable blog / field notes content

## Echo Responsibilities

Echo should not blindly post. It should act like an editor.

It decides:
- Should this job become a Google Update?
- Should this job only live on the map?
- Should this idea become a blog/field note?
- Should this post happen now or wait?
- Have we posted too many similar items recently?
- Is this photo strong enough?
- Does the city/service combination help our SEO goals?
- Should Gemini/Nano Banana create or edit a visual?
- Should this require approval?

## Post Types

Echo should only use Google Updates for post types we can defend from Google guidance and local SEO testing.

Google Updates are best treated as conversion/freshness/visibility content on the Business Profile, not as a direct local ranking lever.

### 1. Recent Work Update

Real completed job proof.

Use:
- real job image
- service
- city/area
- process/result
- link to job page or booking

### 2. Offer

Real special with a real expiration date.

Requires approval.

### 3. Event / Booking Window

Real seasonal booking push or campaign.

Examples:
- Spring deep-clean booking window
- Holiday carpet cleaning schedule
- Winter salt/sand cleanup window

Requires approval.

### 4. Business Update

Real business news or operational update.

Examples:
- new service
- new equipment/process
- holiday hours
- schedule availability
- new guide published
- new review milestone

### 5. Authority Page Announcement

Short Google Update pointing to a useful permanent page.

The real content lives on the website as a field note/blog/guide. The Google Update announces it.

Example:
- "We wrote a quick guide on why Colorado winter salt is rough on carpet fibers."

## Rejected / Suspicious Post Types

These should not exist as standalone Google Update types unless they become one of the approved types above:

- generic educational tip
- generic seasonal tip
- generic service area focus
- random brand/mascot content
- fake-looking generated before/after content
- duplicate job posts with swapped wording

Educational and seasonal content belongs primarily in field notes/blog content. Google Updates can announce that content if it is useful.

## Detailed Post Type Specs

These specs define what Echo must produce for each approved Google Update type.

Every post type should produce a structured draft:

```text
post_type
title
body
image_url
target_url
cta_type
approval_required
recommended_publish_window
reasoning
google_policy_checks
zapier_payload
```

### 1. Recent Work Update

Purpose:

Show fresh proof that Sasquatch is actively doing real work in real local areas.

This is the default and strongest post type because it uses real job inventory.

When to use:
- A finished job has a strong photo.
- City/area is known.
- Service type is clear.
- There has not been a similar job post too recently.
- The job represents a service or city we want more visibility for.

Primary user intent:
- "Can this company actually solve my problem near me?"
- "Do they clean carpets in my area?"
- "Do they handle pet odor/stains/commercial work/etc.?"

Required inputs:
- job ID
- service type
- city or area
- job page URL or booking URL
- image URL
- short description or field notes
- process used if available
- result/outcome if available

Optional inputs:
- neighborhood
- problem type, such as pet odor, heavy traffic, move-out, stairs, upholstery
- before/after image
- invoice line item names
- season/weather context

Recommended Google post format:

```text
Body:
1-3 short paragraphs.
Mention service + city/area early.
Mention one real process detail.
Mention the result/outcome.
Include at most one Sasquatch-humor aside if it fits.

CTA:
BOOK or LEARN_MORE.

Target URL:
Prefer job page if it exists and is useful.
Use booking page if no useful job page exists.
```

Image rules:
- Prefer real job photo.
- Prefer before/after if clean and privacy-safe.
- Do not use Gemini/Nano Banana to fake job results.
- Generated branded overlay is allowed only if it does not misrepresent the job.

Approval:
- Can auto-draft.
- Can auto-post only if confidence is high and auto-posting is enabled.
- Requires approval if the job is commercial, sensitive, has a weak/uncertain image, or mentions a customer/business by name.

Good example direction:

```text
Carpet cleaning in Woodmoor today: this one had pet traffic, hallway wear, and the kind of mystery spot everybody agrees not to discuss too much. We used pre-spray, CRB agitation, and hot water extraction to pull the soil out instead of just making it look temporarily better.

Fresh carpet, softer fibers, and one less stain with a backstory.
```

Bad examples:
- Generic "Another great job completed!"
- No city.
- No service.
- No image.
- Fake before/after generated by AI.
- Phone number in body.

### 2. Offer

Purpose:

Promote a real special, discount, or seasonal deal with clear terms.

When to use:
- There is an actual offer.
- Offer has a start/end date.
- Terms are clear.
- Charles approves it.

Primary user intent:
- "Is there a reason to book now?"
- "Is this deal relevant to my home/business?"

Required inputs:
- offer title
- offer body
- start date
- end date
- terms/limitations
- target URL
- image URL or generated visual

Optional inputs:
- coupon code
- eligible services
- minimum job amount
- target city/area
- seasonal context

Recommended Google post format:

```text
Title:
Short and clear.

Body:
2-3 sentences.
State the offer plainly.
Mention who it is for.
Mention deadline or availability.

CTA:
BOOK or SIGN_UP if supported.

Target URL:
Offer landing page or booking page.
```

Image rules:
- Branded graphic is fine.
- Generated seasonal visual is fine.
- Avoid fake customer-home imagery that looks like a real job.
- Avoid cluttered text-heavy image.

Approval:
- Always requires approval.
- Never auto-post from cron or casual Telegram text without confirmation.

Good example direction:

```text
Spring Deep Clean Special for Monument and the Tri-Lakes area: get your carpets reset after a long season of snow, mud, and whatever the dog has been quietly working on.

Available through April 30 for qualifying carpet cleaning jobs. Book online and we’ll bring the truck, the hose, and a realistic understanding of what Colorado floors go through.
```

Bad examples:
- Missing expiration.
- Vague discount.
- Bait-and-switch language.
- Too many exclamation points.
- Phone number in body.

### 3. Event / Booking Window

Purpose:

Create urgency around a real seasonal or limited booking window.

This is different from an offer because it does not need a discount.

When to use:
- Seasonal demand is real.
- Capacity is limited.
- There is a natural reason to book now.
- It can have a real start/end date.

Primary user intent:
- "Should I schedule this before guests/weather/seasonal mess gets worse?"
- "Is now a good time to book?"

Required inputs:
- event/campaign name
- start date
- end date
- reason for timing
- target URL
- image URL or generated visual

Optional inputs:
- target service
- target cities/areas
- capacity note
- related blog/field note URL

Recommended Google post format:

```text
Title:
Seasonal booking window or campaign name.

Body:
2-3 sentences.
Explain why this timing matters.
Mention service area naturally.
Keep it useful and real, not fake urgency.

CTA:
BOOK or LEARN_MORE.
```

Image rules:
- Branded seasonal visual works well.
- Real job image works if it fits the campaign.
- Generated visual must not imply a real customer result.

Approval:
- Requires approval.
- Can be scheduled after approval.

Good example direction:

```text
Holiday Carpet Cleaning Window is open for Monument, Palmer Lake, and the Tri-Lakes area. If guests are coming, this is the better time to clean the carpet, before everyone stands in the living room pretending not to notice that one spot.

We’re booking pre-holiday appointments now.
```

Bad examples:
- Fake scarcity.
- Generic holiday greeting with no service/action.
- No date range.
- No clear booking action.

### 4. Business Update

Purpose:

Share real business news that helps customers make decisions.

When to use:
- Something real changed or is newly available.
- Customers would benefit from knowing it.
- It supports trust, availability, service clarity, or brand personality.

Primary user intent:
- "What is new with this business?"
- "Are they available?"
- "Do they offer this service?"
- "Can I trust them?"

Allowed update topics:
- new service
- new equipment/process
- expanded availability
- holiday hours
- service policy
- review milestone
- new field note/guide
- hiring/training milestone if customer-relevant
- operational update, such as winter schedule

Required inputs:
- update topic
- why it matters to customers
- target URL or booking URL

Optional inputs:
- image URL
- service/city focus
- supporting proof
- related blog/field note

Recommended Google post format:

```text
Body:
1-3 short paragraphs.
Lead with the update.
Explain why it matters.
Give a clear next action.

CTA:
LEARN_MORE or BOOK.
```

Image rules:
- Real equipment/team/process image is ideal.
- Branded visual is acceptable.
- Mascot/brand humor is acceptable if it does not bury the update.

Approval:
- Approval required for policy/service changes, hiring, review milestones, and anything involving claims.
- Lower-risk updates can be auto-drafted.

Good example direction:

```text
We added more winter carpet cleaning availability for Monument and the Tri-Lakes area. Colorado floors take a beating from salt, sand, snow, and boots, which is a lot for a surface we all agreed to make out of fabric.

If your entryway is looking tired, we can help get it reset.
```

Bad examples:
- "Happy Friday!"
- Random brand post with no customer value.
- News that does not affect customers.

### 5. Authority Page Announcement

Purpose:

Use Google Updates to point searchers toward useful permanent content on the website.

The Google Update is not the full educational post. It is the announcement/teaser.

When to use:
- A useful guide/field note exists or is approved.
- The page answers a real customer question.
- The topic connects to a service or seasonal problem.
- The page can support local organic SEO over time.

Primary user intent:
- "Can I learn what to do about this carpet problem?"
- "Does this company know what they are talking about?"

Required inputs:
- published or approved page URL
- page title
- page summary
- target service/problem
- city/area if relevant
- image URL or generated visual

Optional inputs:
- seasonal context
- related job example
- FAQ angle

Recommended Google post format:

```text
Body:
1-2 short paragraphs.
State the question/problem.
Say that Sasquatch wrote a useful guide/field note.
Give a reason to click.

CTA:
LEARN_MORE.
```

Image rules:
- Blog header or branded educational visual works.
- Generated visual is fine when clearly illustrative.
- Do not use generated visuals as fake proof.

Approval:
- Can auto-draft.
- Publishing depends on whether the source page is already approved/published.
- Requires approval for health, safety, restoration, or strong technical claims.

Good example direction:

```text
We put together a quick field note on why winter salt and sand are so rough on carpet in Colorado homes. Short version: tiny gritty rocks plus fabric floors is not a fair fight.

If your entryway carpet feels crunchy, this explains what is happening and when cleaning actually helps.
```

Bad examples:
- Full blog pasted into Google Update.
- No link.
- No clear question/problem.
- Generic "Read our latest blog."

## Post Type Selection Rules

Echo should choose post types in this priority order:

1. If there is a strong recent job and we need real proof, choose Recent Work Update.
2. If there is an approved real offer, choose Offer.
3. If there is an approved seasonal booking window, choose Event / Booking Window.
4. If there is real customer-relevant news, choose Business Update.
5. If there is a useful approved field note/blog page, choose Authority Page Announcement.
6. If nothing is strong enough, hold.

Echo should never invent a post just to hit a schedule.

## Posting Rules

Initial rules to start with:

- Max 2-3 Google Business Profile posts per week.
- Do not post two same-style updates back to back.
- Do not post weak images just because a job finished.
- Prefer useful posting windows, likely Tue/Wed/Thu morning or early afternoon.
- Save strong job posts for better windows.
- Use offers/events sparingly.
- Every Google post should include city/service/process when natural.
- Do not include phone numbers in Google post body because Google may reject them.
- Use CTA button/link for booking.
- Always log posted/failed/skipped status.
- Keep Zapier as optional last-mile distribution, not the decision maker.

## Proposed Data Model

### content_items

Potential queue for both job proof and authority content.

Fields to consider:

```text
id
source_type: job | blog | seasonal | offer | event | manual
source_id
title
body
image_url
target_url
city
neighborhood
service_type
post_type
status: idea | queued | drafted | approved | scheduled | posted | skipped
scheduled_for
quality_score
local_seo_score
approval_required
metadata
created_at
updated_at
```

### social_post_log

Track every platform attempt.

```text
id
content_item_id
job_id
platform: google_business | zapier | facebook | instagram | linkedin
status: success | failed | skipped
external_post_id
error_message
payload
posted_at
created_at
```

### blog_posts / field_notes

For permanent non-job authority content.

```text
id
slug
title
excerpt
body
image_url
topic
city
service_type
status: draft | published
published_at
metadata
```

## Existing Pieces In The Project

Already present or partly present:

- Google Business Profile helper: `src/lib/google-business.ts`
- Invoice publish route: `src/app/api/admin/ops/invoices/[id]/publish/route.ts`
- Admin social drafts page: `src/app/admin/social-posts/page.tsx`
- Social draft table migration: `migrations/add_social_post_drafts.sql`
- Weekly draft generator: `src/app/api/cron/social-draft-generator/route.ts`
- Promotional posts feed: `src/app/api/posts/promotional/route.ts`
- Job map/job pages as permanent real-world proof
- Zapier webhook fallback for social distribution

## Revised Position On Zapier

Do not replace Zapier completely right now.

Old plan tried direct APIs for:
- Facebook
- LinkedIn
- Instagram

That path caused too much friction with permissions and platform auth.

New plan:

```text
Google Business Profile: direct API
Website/map/blog: direct app ownership
Facebook: Zapier
Instagram: Zapier
LinkedIn: Zapier
Drive/Sheets/Gmail: Google Workspace CLI/API if useful
Gemini/Nano Banana: direct Gemini API for image generation/editing
```

Zapier receives finished, approved content. It should not decide what gets posted.

## Gemini / Nano Banana Role

Use Gemini image generation/editing for:
- branded seasonal graphics
- mascot visuals
- social-safe image variants
- resizing and adapting visuals
- blog header images
- non-job authority visuals

Use real photos for real job proof whenever possible.

Do not use generated images to fake before/after results.

## Google Workspace CLI Role

Useful as an operator and debugging layer, not necessarily production runtime.

Possible uses:
- Gmail debugging for Ranger
- Drive asset archive
- Sheets content/post log exports
- Calendar-aware posting ideas
- Docs drafts or planning docs

Production posting should still use direct app/API code.

## Implementation Phases

### Phase 1: Planning And Guardrails

- Finalize post types.
- Finalize posting frequency.
- Decide approval vs auto-post rules.
- Decide first blog/field notes URL structure.
- Add this plan to the repo.

### Phase 1A: Echo MVP Skill Set

Build only the minimum skills needed to stop raw Google dumping:

- Intake Skill
- Local SEO Scoring Skill
- Editorial Decision Skill
- Copywriting Skill
- Schedule Skill
- Publishing Skill
- Logging And Memory Skill
- Telegram Conversation Skill

Defer Gemini/Nano Banana visuals and full blog generation until the queue/scheduler is trustworthy.

### Phase 2: Logging

- Add `social_post_log`.
- Log Google Business Profile attempts.
- Log Zapier attempts.
- Add admin visibility for failures.

### Phase 3: Content Queue

- Add `content_items`.
- Send finished jobs into queue instead of treating every job as immediate Google content.
- Add basic scoring: city present, image present, service type, freshness, duplicate risk.

### Phase 4: Editorial Scheduler

- Cron chooses next content item.
- Enforces max weekly Google post count.
- Enforces variety.
- Creates drafts instead of posting everything immediately.

### Phase 5: Blog / Field Notes

- Add permanent authority content pages.
- Generate first non-job articles from seasonal/service ideas.
- Link Google Updates to these pages.

### Phase 6: Gemini/Nano Banana Assets

- Add Gemini image generation/editing utility.
- Use for authority/blog/seasonal visuals first.
- Later support generated variants for Google/Zapier posts.

### Phase 7: Zapier Last-Mile Adapter

- Standardize one outbound webhook payload.
- Send approved content to Zapier after Google/direct publishing decision.
- Keep Facebook/Instagram/LinkedIn inside Zapier unless there is a strong reason to revisit direct APIs.

### Phase 8: Telegram Controls

- Add Echo Telegram command endpoint.
- Add admin-only authorization.
- Add `/echo status`, `/echo next`, `/echo drafts`, approve/reject/post commands.
- Add inline approval buttons.
- Add audit logging for Telegram actions.
- Reuse existing Telegram infrastructure patterns where possible.

## MVP Behavior

The first useful version of Echo should do this:

```text
When a job is finished:
1. Create/keep the map job page.
2. Add the job to Echo's content queue.
3. Score it.
4. Draft a Google Update only if it is strong enough.
5. Otherwise keep it as map-only proof.

On scheduled cron:
1. Check posting limits and recent history.
2. Choose the best approved/draftable item.
3. Create or refresh copy.
4. Either schedule it for approval or publish directly if allowed.
5. Log Google and Zapier results.

From Telegram:
1. Charles asks Echo what is ready.
2. Echo summarizes drafts and recommendations.
3. Charles approves, rewrites, schedules, or posts.
4. Echo confirms the exact action.
5. Echo logs the action and result.
```

MVP should not:

- directly integrate Facebook/Instagram/LinkedIn APIs
- auto-generate fake job visuals
- auto-post offers without approval
- publish non-job blog content before the blog layer exists
- let Google failures look like success

## Open Questions

- Should job spotlight posts require approval or can high-score jobs auto-post?
- What exact weekly cadence do we want for Google Updates?
- Should blog/field notes publish automatically or start as drafts?
- Which service areas matter most right now?
- Should Google Updates link to job pages, blog posts, or booking depending on type?
- Do we want separate content calendars for Google vs Facebook/Instagram?
- Should review requests/reviews become another content signal?

## Current Recommendation

Build the content engine around this rule:

```text
Jobs create proof.
Blog/field notes create expertise.
Google Updates broadcast the best item at the best time.
Zapier distributes finished content to annoying platforms.
```
