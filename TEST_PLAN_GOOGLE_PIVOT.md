# TEST PLAN: feature/google-pivot-v1

## 🎯 OBJECTIVE
Verify that the Google My Business integration branch works correctly and doesn't break existing functionality.

---

## ⚙️ SETUP

### 1. Check Current Branch
```bash
git branch --show-current
# Should show: feature/google-pivot-v1
```

### 2. Install Dependencies
```bash
npm install
# Verify googleapis@170.1.0 is installed
```

### 3. Check Environment Variables
```bash
# Check if Google credentials exist (optional for Phase 1)
cat .env.local | grep GOOGLE
```

---

## 📝 PHASE 1: CORE FUNCTIONALITY (No Google Credentials)

**Goal:** Verify app works WITHOUT Google credentials (graceful degradation)

### Test 1.1: Development Server Starts
- [ ] Run `npm run dev`
- [ ] Server starts without errors
- [ ] No crashes related to missing Google credentials
- [ ] Navigate to http://localhost:3000

**Expected:** App loads normally

---

### Test 1.2: Homepage Loads
- [ ] Visit http://localhost:3000
- [ ] Map displays correctly
- [ ] Existing sightings/jobs show on map
- [ ] No console errors

**Expected:** Homepage works as before

---

### Test 1.3: Contest Form Loads (Simplified UI)
- [ ] Visit http://localhost:3000/sightings
- [ ] Form displays correctly
- [ ] **VERIFY:** Social media fields (Facebook/Instagram) are GONE
- [ ] Form has: Photo, Name, Phone, Email, Zip Code
- [ ] "Use Current Location" button visible

**Expected:** Simplified form without social media fields

---

### Test 1.4: Submit Contest Entry (Without Google Credentials)
- [ ] Fill out contest form with test data:
  - Photo: Any image
  - Name: "Test User"
  - Phone: "1234567890"
  - Email: "test@example.com"
  - Zip: "80202"
- [ ] Click "Submit Sighting"
- [ ] Watch browser console and terminal logs

**Expected Results:**
- ✅ Form submits successfully
- ✅ Coupon code generated and displayed
- ✅ Entry saved to database
- ⚠️ Console shows: "Failed to post to Google Business Profile" (EXPECTED - no credentials)
- ✅ User still sees success message
- ✅ No app crash

**CRITICAL:** Google posting failure should NOT prevent submission success

---

### Test 1.5: Admin View Shows New Entry
- [ ] Login to admin at http://localhost:3000/protected/sightings
- [ ] New test entry appears in list
- [ ] Entry shows correct data
- [ ] Coupon code displayed
- [ ] Contest eligible = TRUE (all entries now eligible)

**Expected:** Entry saved successfully despite Google posting failure

---

### Test 1.6: Database Check
- [ ] Open Supabase dashboard
- [ ] Check `sightings` table
- [ ] Find your test entry
- [ ] Verify fields:
  - `contest_eligible` = TRUE
  - `social_platform` = NULL (removed)
  - `social_link` = NULL (removed)
  - All other fields populated

**Expected:** Database record correct

---

## 📝 PHASE 2: GOOGLE INTEGRATION (With Credentials)

**Goal:** Test Google Business Profile posting

### Prerequisites
You need to set up Google OAuth first. Run these scripts:

```bash
# Step 1: Get your Google Client ID and Secret
node scripts/get-google-ids.js

# Step 2: Get refresh token (opens browser for OAuth)
node scripts/get-google-tokens.js
```

Then add to `.env.local`:
```bash
GOOGLE_CLIENT_ID=your-client-id-here
GOOGLE_CLIENT_SECRET=your-client-secret-here
GOOGLE_REFRESH_TOKEN=your-refresh-token-here
```

---

### Test 2.1: Restart Server with Credentials
- [ ] Stop dev server (Ctrl+C)
- [ ] Add Google credentials to `.env.local`
- [ ] Restart: `npm run dev`
- [ ] Check terminal for any Google API errors

**Expected:** Server starts normally

---

### Test 2.2: Submit Entry with Google Posting
- [ ] Visit http://localhost:3000/sightings
- [ ] Submit a new test entry
- [ ] Watch terminal logs closely

**Expected Terminal Output:**
```
Triggering Google Business Post...
Creating post for Account: [accountId], Location: [locationId]
Successfully created Google Post: [result object]
```

**Expected Results:**
- ✅ Entry submits successfully
- ✅ Google post created (check terminal logs)
- ✅ User sees success message
- ✅ Coupon code displayed

---

### Test 2.3: Verify Google Business Profile
- [ ] Open Google Business Profile dashboard
- [ ] Navigate to your business profile
- [ ] Check "Updates" or "Posts" section
- [ ] Look for the new post with:
  - Photo from submission
  - Text: "Check out this Sasquatch Sighting! 📸 spotted by [Name]."
  - "Learn More" button linking to sasquatchcarpet.com

**Expected:** Post appears on Google Business Profile

---

### Test 2.4: Multiple Submissions
- [ ] Submit 2-3 more test entries
- [ ] Each should trigger a Google post
- [ ] Check Google Business Profile for all posts

**Expected:** All posts appear (may take a few minutes)

---

## 📝 PHASE 3: REGRESSION TESTING

**Goal:** Ensure nothing broke

### Test 3.1: Job Upload Still Works
- [ ] Login to admin: http://localhost:3000/protected
- [ ] Upload a job (carpet cleaning work photo)
- [ ] Verify job appears on map
- [ ] Check job detail page works

**Expected:** Job system unaffected

---

### Test 3.2: Map Display
- [ ] Visit homepage
- [ ] Verify both jobs (green pins) and sightings (different color) show
- [ ] Click on sighting pin
- [ ] Popup shows correct info

**Expected:** Map works for both types

---

### Test 3.3: Share Pages
- [ ] Visit a sighting share page: http://localhost:3000/sightings/share/[id]
- [ ] Page loads correctly
- [ ] Image displays
- [ ] Social meta tags present (view source)

**Expected:** Share pages work

---

### Test 3.4: Admin Sightings List
- [ ] Visit http://localhost:3000/protected/sightings
- [ ] All test entries visible
- [ ] Search works
- [ ] Filter works (All / Eligible / Coupon Only)
- [ ] Export CSV works
- [ ] Coupon redeemed toggle works

**Expected:** Admin features work

---

## 🚨 KNOWN ISSUES TO WATCH FOR

### Issue 1: Google API Rate Limits
**Symptom:** "429 Too Many Requests" error  
**Cause:** Too many test submissions  
**Solution:** Wait 1 hour or use production sparingly

### Issue 2: Invalid Google Credentials
**Symptom:** "401 Unauthorized" or "Invalid credentials"  
**Cause:** Wrong Client ID/Secret or expired refresh token  
**Solution:** Re-run `scripts/get-google-tokens.js`

### Issue 3: Missing Google Business Profile
**Symptom:** "No location found for this account"  
**Cause:** Google account doesn't have a Business Profile  
**Solution:** Create one at business.google.com

### Issue 4: Image URL Not Accessible
**Symptom:** Google post created but no image shows  
**Cause:** Supabase storage URL not publicly accessible  
**Solution:** Verify `sighting-images` bucket is public

---

## ✅ PASS CRITERIA

This branch is **SAFE TO MERGE** if:

- [x] Phase 1 tests pass (app works without Google credentials)
- [x] Google posting failure doesn't break submissions
- [x] Social media fields removed from form
- [x] All entries marked as contest eligible
- [x] Existing features (jobs, map, admin) still work
- [ ] Phase 2 tests pass (Google posting works with credentials) - OPTIONAL
- [ ] No console errors unrelated to Google API
- [ ] No TypeScript errors: `npm run type-check`
- [ ] No linter errors: `npm run lint`

---

## 🔄 ROLLBACK PLAN

If tests fail critically:

```bash
# Return to main branch
git checkout main

# Stash any changes
git stash

# Report issues
```

---

## 📊 TEST RESULTS

### Date: _______________
### Tester: _______________

**Phase 1 Results:**
- Test 1.1: ⬜ Pass / ⬜ Fail
- Test 1.2: ⬜ Pass / ⬜ Fail
- Test 1.3: ⬜ Pass / ⬜ Fail
- Test 1.4: ⬜ Pass / ⬜ Fail
- Test 1.5: ⬜ Pass / ⬜ Fail
- Test 1.6: ⬜ Pass / ⬜ Fail

**Phase 2 Results (Optional):**
- Test 2.1: ⬜ Pass / ⬜ Fail / ⬜ Skipped
- Test 2.2: ⬜ Pass / ⬜ Fail / ⬜ Skipped
- Test 2.3: ⬜ Pass / ⬜ Fail / ⬜ Skipped
- Test 2.4: ⬜ Pass / ⬜ Fail / ⬜ Skipped

**Phase 3 Results:**
- Test 3.1: ⬜ Pass / ⬜ Fail
- Test 3.2: ⬜ Pass / ⬜ Fail
- Test 3.3: ⬜ Pass / ⬜ Fail
- Test 3.4: ⬜ Pass / ⬜ Fail

**Overall Status:** ⬜ SAFE TO MERGE / ⬜ NEEDS FIXES

**Notes:**
_______________________________________________
_______________________________________________
_______________________________________________
