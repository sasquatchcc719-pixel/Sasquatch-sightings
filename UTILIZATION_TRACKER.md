# Utilization Tracker Feature

## Overview
Manual revenue and efficiency tracking added to job entry flow with dashboard analytics.

## Setup

### 1. Run Database Migration
```sql
-- In Supabase SQL Editor, run:
migrations/add_utilization_tracking.sql
```

This adds:
- `invoice_amount` and `hours_worked` columns to `jobs` table
- `settings` table for user goals (defaults: $150k annual, 40 hrs/week, 48 weeks/year)

### 2. Deploy Feature Branch
```bash
# Currently on feature/utilization-tracker
git push origin feature/utilization-tracker
```

### 3. Test in Preview
- Vercel will create preview deployment
- Test job entry with new fields
- View stats dashboard at `/admin/stats`

### 4. Merge to Main (when ready)
```bash
git checkout main
git merge feature/utilization-tracker
git push origin main
```

## Features

### Job Entry (Enhanced)
**Location:** Job Editor (`/admin/jobs/[id]`)

Two new optional fields:
- **Invoice Amount** - Total revenue for the job ($)
- **Hours Worked** - Time spent (decimal, e.g., 2.5 hours)

Both fields:
- Optional (existing jobs without data won't break)
- Saved with description
- Used for stats calculations

### Stats Dashboard
**Location:** `/admin/stats` (new tab in admin nav)

**This Week:**
- Jobs completed
- Revenue
- Hours worked
- Revenue per hour
- Average ticket

**Year to Date:**
- Total jobs
- Total revenue
- Total hours
- Average $/hour
- Utilization % (hours worked ÷ available hours)

**Pace to Goal:**
- Annual revenue goal ($150k default)
- Weekly target needed
- Current weekly average
- Projected annual revenue
- On pace / behind pace status
- Progress bar

### Calculations

```javascript
// Weekly target
weeklyTarget = annualGoal / workWeeksPerYear

// Revenue per hour
revenuePerHour = totalRevenue / totalHours

// Utilization
availableHoursYTD = weeksElapsed * hoursPerWeek
utilization = (totalHoursWorked / availableHoursYTD) * 100

// Projected annual
weeklyAverage = totalRevenueYTD / weeksElapsed
projectedAnnual = weeklyAverage * workWeeksPerYear

// On pace check
onPace = projectedAnnual >= annualGoal
```

## What's NOT Included (Yet)

- Settings page (uses defaults for now)
- Editing invoice/hours after initial entry
- Historical charts/graphs
- Export to CSV
- Mobile app data entry

## Defaults

Settings table defaults (can be changed later with Settings page):
- Annual Revenue Goal: $150,000
- Available Hours per Week: 40
- Work Weeks per Year: 48

## Testing

1. **Run migration** in Supabase
2. **Complete a job** with invoice amount and hours
3. **View Stats** at `/admin/stats`
4. **Check calculations** match expectations
5. **Try without fields** - shouldn't break
6. **Mobile test** - cards should stack nicely

## Future Enhancements

- Settings page for goal customization
- Edit revenue/hours after job completion
- Weekly/monthly trend charts
- CSV export
- Push notifications when behind pace
- Integration with accounting software
