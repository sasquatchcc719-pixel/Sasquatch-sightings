# SMS Bot System Prompt – Logic & Conflict Analysis

## Summary

Review of `src/lib/openai-chat.ts` SYSTEM_PROMPT for conflicting or ambiguous instructions that could confuse the model.

---

## 1. CONFLICT: When can we give a price vs. when do we need name/email/address?

**Current wording:**
- **CUSTOMER INFO (line 64):** "Before quoting or sending the booking link, you MUST collect [name, email, address]"
- **Section 7 (line 283):** "Do not give a full quote or the booking link until we have all three"
- **Script "How much for 5 bedrooms?" (line 237):** Tells the model to give the price ($230) and, for 2 bedrooms, to add the minimum message—no mention of collecting name/email/address first.

**Problem:** The model is told both "don't quote before you have name/email/address" and "when they ask for 5 bedrooms, give $230." So it may either (a) refuse to give a price until it has info, or (b) give the price and ignore the "before quoting" rule, causing inconsistent behavior.

**Resolution:** Define one clear rule:
- **You may give price estimates** (e.g. "$230 for 5 bedrooms") as soon as you have job details (rooms, sizes). You do **not** need name/email/address to state a price.
- **You must have name, email, and address before sending the booking link.** Never send the link without all three.
- **Try to collect name, email, and address early** in the conversation, but do not block giving a price if the customer asks "how much for X rooms?"

This removes the conflict and matches the intended flow: answer pricing questions when we have job details; gate only the **link** on name/email/address.

---

## 2. AMBIGUITY: "$150 minimum" – two different phrasings

**Current wording:**
- **Line 97 (Pricing Guide):** "Only mention the $150 minimum if the job total might be under $150"
- **CRITICAL RULE (lines 208–210):** "If the quoted total is LESS THAN $150 → ALWAYS mention the minimum AND suggest adding more"

**Problem:** "Only mention... if might be under" can sound like "mention it only sometimes." The CRITICAL RULE is correct: when total < $150, **always** mention the minimum and suggest adding more.

**Resolution:** Remove or rephrase line 97 so it does not contradict the CRITICAL RULE. For example: "When the quoted total is under $150, always mention the minimum and suggest adding more (see CRITICAL RULE below)." Or delete line 97 and rely on the CRITICAL RULE.

---

## 3. AMBIGUITY: "Necessary details" in Section 7

**Current wording (line 285):** "Only give pricing AFTER you have the necessary details"

**Problem:** "Necessary details" could mean (a) job details (rooms, sizes) for the quote, or (b) name, email, address. If the model interprets it as (b), it again conflicts with the script that gives a price for "5 bedrooms" without requiring name/email/address first.

**Resolution:** Make "necessary details" explicitly about the **job**: e.g. "Only give pricing after you have enough job details (number of rooms, sizes, etc.). Before sending the booking link, you must have name, email, and address."

---

## 4. CONSISTENCY: Multiple rooms vs. single large space

**Current state:** The prompt clearly states:
- Multiple rooms → price per room/area; never sum sq ft and apply one tier.
- Monster/Jumbo/Massive → single large space only (e.g. one basement).

No conflict here; keep as is.

---

## 5. CONSISTENCY: Scheduling language (no booking in chat)

**Current state:** Goal, "SCHEDULING HAPPENS ONLY ON THE BOOKING LINK," Section 4, and Script "When can you come?" all say: we don't set times in chat; customer picks time at the link; never say "finalize the booking" or "you're all set."

No conflict here; keep as is.

---

## 6. GAP: Deep Restoration for multiple rooms

**Current state:** Deep Restoration tiers (100–200, 201–400 sq ft, etc.) don't say whether they apply per room or to one large space. For standard carpet we explicitly say "per room/area" and "single large space" for Monster/Jumbo.

**Recommendation:** Either add a one-line note that Deep Restoration tiers are for a single area (like Monster/Jumbo), or leave as is and accept that the model may infer from context. Low priority.

---

## Changes applied (in code)

1. **CUSTOMER INFO:** Require name, email, address only **before sending the booking link**. Explicitly allow giving **price estimates** as soon as we have job details; encourage collecting name/email/address early but do not require them to state a price.
2. **Pricing Guide (old line 97):** Replaced "Only mention the $150 minimum if..." with a forward reference to the CRITICAL RULE so the model always mentions the minimum when total < $150 and suggests adding more.
3. **Section 7 CONVERSATION FLOW:** Clarified that "necessary details" for pricing = **job details** (rooms, sizes). Name, email, address are required only before sending the link. Removed "full quote" wording to avoid conflict with giving a price before we have customer info.

This keeps: per-room pricing, $150 minimum + suggest adding more, no scheduling in chat, and link only after name/email/address—without conflicting instructions on when we can give a number like "$230 for 5 bedrooms."
