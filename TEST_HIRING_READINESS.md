# 🧪 Hiring Readiness Feature - Testing Guide

## Overview
You're testing the Hiring Readiness tracker on the `feature/hiring-readiness` branch.

---

## Step 1: Apply Database Migration

### Option A: Supabase Dashboard (Recommended ⭐)

1. **Open Supabase Dashboard**
   - Go to https://supabase.com/dashboard
   - Select your "Sasquatch Sightings" project

2. **Open SQL Editor**
   - Click on "SQL Editor" in the left sidebar
   - Click "New Query"

3. **Run the Migration**
   - Copy the entire contents of `migrations/add_hiring_readiness.sql`
   - Paste into the SQL editor
   - Click "Run" or press `Cmd + Enter` (Mac) / `Ctrl + Enter` (Windows)

4. **Verify Success**
   - You should see: "Success. No rows returned"
   - Check the Tables section - you should see a new `weekly_revenue` table

### Option B: Quick Helper Script

```bash
node apply-hiring-migration.js
```

This will display the SQL and instructions.

---

## Step 2: Start Dev Server

```bash
pnpm dev
# or
npm run dev
```

Wait for the server to start (usually at http://localhost:3000)

---

## Step 3: Navigate to Stats Page

1. Open your browser to: http://localhost:3000
2. Sign in to your admin account
3. Navigate to: **Admin > Stats** (or `/admin/stats`)

You should see the new **"Hiring Readiness"** section at the bottom of the page.

---

## Step 4: Test the Feature

### Test Case 1: Fresh Start (No Revenue Data)
**Expected:**
- Current Week: $0
- Consecutive Weeks: 0 of 4
- Status: "NOT YET" (gray background)
- Recent Weeks: All showing $0

### Test Case 2: Add Some Revenue Entries

Use the "Quick Entry" form at the top of the page:

1. **Add Job #1 - This Week**
   - Invoice Amount: $1,500
   - Hours Worked: 10
   - Click "Add Entry"

2. **Refresh the page** - Check Hiring Readiness section:
   - Current Week: $1,500
   - Circle should be gray (below $4,000 threshold)
   - Status: "NOT YET"

3. **Add Job #2 - This Week**
   - Invoice Amount: $2,800
   - Hours Worked: 15
   - Click "Add Entry"

4. **Refresh the page**:
   - Current Week: $4,300 ($1,500 + $2,800)
   - Circle should be **GREEN** (above threshold!)
   - Status might still say "NOT YET" or "GETTING CLOSE" depending on previous weeks

### Test Case 3: Build a Streak

To properly test consecutive weeks, you'll need to add jobs for previous weeks:

1. **Go to the Jobs page** (`/admin/jobs`)
2. Add jobs with dates from last week
3. Return to Stats page and refresh

OR use the database directly to insert backdated revenue entries.

### Test Case 4: Customize Settings

1. Click the **Settings icon** (⚙️) at the top of the Stats page
2. Scroll to "Hiring Readiness Settings"
3. Change:
   - Weekly Threshold to $3,000 (easier to test)
   - Consecutive Weeks to 2 (faster to reach)
4. Click "Save Goals"
5. Refresh and check if your status changed

---

## Step 5: Visual Checks

### Things to Verify:

#### Layout
- [ ] All cards are properly aligned
- [ ] Responsive design works (try resizing browser)
- [ ] Dark theme looks good
- [ ] Icons display correctly

#### Current Week Card
- [ ] Shows correct dollar amount
- [ ] "(in progress)" label is visible
- [ ] Circle indicator is correct color
- [ ] Background color changes based on threshold

#### Consecutive Weeks Card
- [ ] Shows "X of 4" correctly
- [ ] Progress bar fills correctly
- [ ] Progress bar color matches status:
  - Gray for 0-1 weeks
  - Yellow for 2-3 weeks
  - Green for 4+ weeks

#### Status Card
- [ ] Background color is correct:
  - Gray for "NOT YET"
  - Yellow/Amber for "GETTING CLOSE"
  - Green for "START_RECRUITING"
- [ ] Status message is appropriate
- [ ] Text color is readable

#### Recent Weeks List
- [ ] Shows last 4 weeks
- [ ] Week labels are correct ("This Week", "Last Week", etc.)
- [ ] "(in progress)" badge only on current week
- [ ] Revenue amounts are accurate
- [ ] Job counts are correct
- [ ] Circle colors match threshold status

---

## Step 6: Edge Case Testing

### Test Streak Breaking
1. Build up 2-3 consecutive weeks above threshold
2. Add a week with revenue below threshold
3. Verify the consecutive counter resets to 0

### Test Current Week In Progress
1. The current week should always show "(in progress)"
2. It should count toward the streak if above threshold
3. But the message should indicate it's not finalized

### Test Settings Changes
1. Change threshold from $4,000 to $2,000
2. See how many of your weeks now meet the threshold
3. Watch the status change in real-time

---

## Expected Behaviors

### Status Transitions

| Consecutive Weeks | Status | Background | Message |
|-------------------|--------|------------|---------|
| 0-1 | NOT YET | Dark Gray | "Keep building momentum" |
| 2-3 | GETTING CLOSE | Yellow/Amber | "X more weeks to go" |
| 4+ | START RECRUITING | Green | "Start recruiting now" |

### Threshold Indicators

| Revenue vs Threshold | Circle Color | Text Color |
|---------------------|--------------|------------|
| Below $4,000 | Gray ⚪ | Gray |
| At or Above $4,000 | Green 🟢 | Green |

---

## Troubleshooting

### "weekly_revenue table doesn't exist"
- Migration didn't run successfully
- Re-run the migration SQL in Supabase dashboard

### "hiring_threshold is null" or similar
- Settings table needs the new columns
- Make sure you ran the ALTER TABLE statements

### Revenue not calculating correctly
- Check that jobs have `invoice_amount` filled in
- Verify job dates are within the weeks you're testing
- Check browser console for errors

### UI not updating
- Try a hard refresh (Cmd/Ctrl + Shift + R)
- Check Network tab for failed API calls
- Look for console errors

---

## Success Criteria ✅

The feature is working correctly if:

1. ✅ Migration applied without errors
2. ✅ Stats page loads without errors
3. ✅ Hiring Readiness section is visible
4. ✅ Revenue calculations are accurate
5. ✅ Consecutive week counter works correctly
6. ✅ Status changes appropriately
7. ✅ Settings can be customized
8. ✅ All UI elements render properly
9. ✅ Dark theme looks good
10. ✅ Responsive design works on mobile

---

## Need Help?

### Check the Console
Open browser Developer Tools (F12) and look for:
- Red errors in Console tab
- Failed network requests in Network tab

### Check the Database
Go to Supabase Dashboard > Table Editor:
- Verify `weekly_revenue` table exists
- Check `settings` table has new columns
- Inspect actual data

### Common Issues
- **OneSignal Error**: That's unrelated to this feature (it's about the domain)
- **Slow loading**: Normal on first load, should be faster after
- **Missing data**: Make sure you have jobs with `invoice_amount` in the database

---

## Next Steps After Testing

Once you've verified everything works:

1. **Merge to main** (if satisfied):
   ```bash
   git checkout main
   git merge feature/hiring-readiness
   git push origin main
   ```

2. **Deploy to production**:
   - Push to Vercel
   - Run migration on production database

3. **Monitor in production**:
   - Check that real jobs populate correctly
   - Verify calculations with actual business data

---

**Happy Testing! 🚀**
