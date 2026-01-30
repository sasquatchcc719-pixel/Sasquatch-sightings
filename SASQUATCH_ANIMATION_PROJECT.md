# Sasquatch Animation Project

**Created:** January 30, 2026  
**Status:** Ready to start

---

## The Vision

Animated Sasquatch walking through misty woods as a video background on customer-facing pages. This will be the signature visual element across the site.

---

## Your Task: Create the Video

### Tool
**Leonardo AI** (or any AI video generator)

### What to Generate
- Sasquatch silhouette walking through a misty forest
- Atmospheric, mysterious vibe
- Subtle movement (slow walk, fog drifting)
- Should loop seamlessly

### Video Specs
| Spec | Value |
|------|-------|
| Resolution | 1920x1080 or 1280x720 |
| Duration | 5-15 seconds (looping) |
| File size | Under 5MB ideal, 10MB max |
| Format | MP4 (H.264 codec) |

### Tips for Best Results
- **Seamless loop:** End should blend back to start
- **Slow movement:** Atmospheric > action
- **Muted colors:** Won't compete with text overlay
- **Fog/mist:** Hides loop points, looks mysterious
- **Silhouette:** Sasquatch doesn't need detail, just shape

---

## Where to Put It

Drop the file here:
```
/public/videos/sasquatch-walk.mp4
```

---

## What Claude Will Build

Once you have the video, Claude will:

1. Add it as a background to the **Vendor Landing Page** (`/location/[partnerId]`)
2. Add dark overlay so text is readable
3. Make it autoplay, loop, and mute (required for mobile)
4. Fallback image for slow connections

### Final Look
```
┌─────────────────────────────────────────┐
│  [Video plays behind, slightly dimmed]  │
│                                         │
│      🦶 Sasquatch Carpet Cleaning       │
│         $20 OFF Your Cleaning           │
│                                         │
│         [ TEXT US NOW ]                 │
│                                         │
└─────────────────────────────────────────┘
```

---

## Future Animation Ideas

Once the video is working, we can expand:

| Animation | Use Case | Format |
|-----------|----------|--------|
| Sasquatch waving | Headers, loading states | Lottie JSON |
| Thumbs up | Success confirmations | Lottie JSON |
| Walking across screen | Page transitions | Lottie JSON |
| Thinking/scratching head | AI processing states | Lottie JSON |

For Lottie animations:
- Create in After Effects
- Export with Bodymovin plugin
- 200-400px, transparent background
- Under 100KB file size

---

## Current Branch Status

**Branch:** `feature/admin-nav-cleanup`

### Pending Changes (not yet pushed)
- Partner portal with 5-tap Easter egg login
- Vendors terminology update
- Preview button with all external pages
- OneSignal error fix
- PIN field for vendor creation

### To Deploy
```bash
git push -u origin feature/admin-nav-cleanup
```

### SQL Already Run
- Partner type column added
- You may need to run: `UPDATE partners SET partner_type = 'location' WHERE created_at > NOW() - INTERVAL '1 day';`

---

## Questions for Tomorrow

1. Which page should get the video first? (Vendor landing page recommended)
2. Do you want the video on the main NFC card page (`/tap`) too?
3. Any specific Sasquatch style? (Realistic, cartoony, silhouette?)

---

Good night! 🌙
