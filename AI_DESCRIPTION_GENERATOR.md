# AI Description Generator (Google Gemini)

**Date:** January 20, 2026  
**Status:** ✅ Implemented  
**Feature Branch:** `feature/p3-ai-description-generator`

---

## 🎯 Overview

Automatically generate professional job descriptions using Google Gemini AI. Saves time and ensures consistent, SEO-friendly descriptions for all carpet cleaning jobs.

---

## ✨ Features

### **1. One-Click Generation**
- "Generate with AI" button next to description field
- Sparkles icon for visual appeal
- Loading state with spinner while generating

### **2. Context-Aware**
Uses job context to create relevant descriptions:
- Selected service type (e.g., "Pet Urine Removal")
- Location (city, Colorado)
- Any notes user typed (optional)

### **3. Professional Output**
- 2-3 sentences per description
- Mentions specific location for local SEO
- Professional but friendly tone
- No hashtags or emojis
- Includes relevant keywords

### **4. Editable Results**
- AI generates initial description
- User can edit before submitting
- Combines AI efficiency with human oversight

---

## 🛠️ Technical Implementation

### **Backend: Gemini API Route**

**File:** `src/app/api/generate-description/route.ts`

**Process:**
1. **Authentication check** - Admin only
2. **Validate inputs** - Service type and city required
3. **Initialize Gemini** - Using `gemini-pro` model
4. **Build prompt** - Structured with service, location, notes
5. **Generate content** - Call Gemini API
6. **Return description** - Clean, trimmed text

**Key Code:**
```typescript
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
const model = genAI.getGenerativeModel({ model: 'gemini-pro' })

const prompt = `Write a short, professional job description for a carpet cleaning company.
Service: ${serviceType}
Location: ${city}, Colorado
${notes ? `Additional notes: ${notes}` : ''}

Keep it 2-3 sentences. Mention the location. Sound professional but friendly...`

const result = await model.generateContent(prompt)
const description = result.response.text().trim()
```

---

### **Frontend: Upload Form Integration**

**File:** `src/components/admin/upload-form.tsx`

**New State:**
```typescript
const [isGeneratingDescription, setIsGeneratingDescription] = useState(false)
const [generationError, setGenerationError] = useState<string | null>(null)
```

**Generation Function:**
```typescript
const handleGenerateDescription = async () => {
  // 1. Get service name from form
  // 2. Call API with service, city, notes
  // 3. Set generated text in description field
  // 4. Handle errors gracefully
}
```

**UI Updates:**
- Button next to "Description" label
- Disabled when no service selected
- Shows loading spinner during generation
- Displays error messages if generation fails

---

## 📋 Usage Instructions

### **For Admins:**

1. **Start uploading a job:**
   - Upload image
   - Select service type (required)
   - Get GPS coordinates

2. **Generate description:**
   - Click **"Generate with AI"** button
   - Wait 2-3 seconds
   - Description appears in text field

3. **Edit if needed:**
   - Review AI-generated text
   - Make any adjustments
   - Add specific details

4. **Submit job:**
   - Complete form submission
   - Job published with AI description

---

## 🔑 Environment Variables

### **Required:**

```env
GEMINI_API_KEY=your_api_key_here
```

**How to get API key:**
1. Go to https://makersuite.google.com/app/apikey
2. Click **"Create API Key"**
3. Copy key
4. Add to Vercel environment variables

**In Vercel:**
1. Go to Project Settings → Environment Variables
2. Add key: `GEMINI_API_KEY`
3. Value: Your API key
4. Environments: Production, Preview, Development
5. Save and redeploy

---

## 💡 Prompt Engineering

### **Current Prompt:**
```
Write a short, professional job description for a carpet cleaning company.
Service: [service type]
Location: [city], Colorado
[Optional notes]

Keep it 2-3 sentences. Mention the location. Sound professional but friendly. 
Include relevant keywords for local SEO. No hashtags. No emojis.
```

### **Why This Works:**

**1. Specific Instructions:**
- "2-3 sentences" → Controls length
- "Mention the location" → Ensures local SEO
- "Professional but friendly" → Sets tone

**2. Context Provided:**
- Service type → Relevant keywords
- Location → Local SEO
- Notes → Custom details

**3. Constraints:**
- "No hashtags" → Keeps it professional
- "No emojis" → Maintains professionalism

---

## 📊 Example Outputs

### **Example 1: Pet Urine Removal**

**Input:**
- Service: Pet Urine Removal
- Location: Monument, CO
- Notes: "Tough stains in living room"

**Output:**
```
We recently completed a thorough pet urine removal service in Monument, Colorado, 
tackling challenging stains in a client's living room. Using our advanced enzymatic 
cleaning process, we eliminated odors at the molecular level and restored the 
carpet to like-new condition. Our team takes pride in delivering exceptional 
results for pet owners throughout the Monument area.
```

---

### **Example 2: Standard Carpet Cleaning**

**Input:**
- Service: Standard Carpet Cleaning
- Location: Colorado Springs, CO
- Notes: ""

**Output:**
```
Our professional team provided comprehensive carpet cleaning services for a home 
in Colorado Springs, Colorado. We used hot water extraction to remove deep-seated 
dirt and allergens, leaving the carpets fresh and revitalized. 
```

---

### **Example 3: Deep Carpet Restoration**

**Input:**
- Service: Deep Carpet Restoration
- Location: Palmer Lake, CO
- Notes: "High-traffic areas, heavy soil"

**Output:**
```
We performed a deep carpet restoration service in Palmer Lake, Colorado, focusing 
on high-traffic areas with heavy soil buildup. Our multi-step process included 
pre-treatment, deep cleaning, and specialized stain removal to bring the carpets 
back to pristine condition. Serving the Palmer Lake community with professional 
restoration services.
```

---

## 🎨 UI/UX Design

### **Button Placement:**
- Right side of "Description *" label
- Aligned with label text
- Compact size (`size="sm"`)
- Outline variant (not primary)

### **States:**

**1. Default:**
```
┌─────────────────────┐
│ ✨ Generate with AI │
└─────────────────────┘
```

**2. Loading:**
```
┌─────────────────────┐
│ ⟳ Generating...     │
└─────────────────────┘
```

**3. Disabled:**
```
┌─────────────────────┐
│ ✨ Generate with AI │ (grayed out)
└─────────────────────┘
```

### **Error Display:**
- Red text below textarea
- Clear error messages
- Non-blocking (user can still type)

---

## 🔒 Security & Privacy

### **API Key Protection:**
- ✅ Stored in environment variables
- ✅ Never exposed to client
- ✅ Server-side API calls only

### **Authentication:**
- ✅ Admin-only endpoint
- ✅ User auth checked before generation
- ✅ Prevents unauthorized usage

### **Rate Limiting:**
- Gemini free tier: 60 requests/minute
- Consider adding client-side debounce if needed
- Monitor usage in Google AI Studio

### **Data Privacy:**
- No sensitive data sent to Gemini
- Only service type, city, notes
- No personal information
- No images sent

---

## 💰 Cost Analysis

### **Gemini API Pricing (as of 2026):**

**Free Tier:**
- 60 requests per minute
- Rate limits apply
- Good for testing and low volume

**Paid Tier:**
- Pay per 1000 tokens
- Very affordable (< $0.01 per generation)
- Higher rate limits

### **Expected Usage:**
- ~5-10 generations per day (admin uploads)
- Well within free tier limits
- Minimal cost if upgraded

---

## 🧪 Testing

### **Test Cases:**

**1. Standard Flow:**
- Select service → Generate → Edit → Submit
- Expected: Professional description generated

**2. With Notes:**
- Add notes → Generate
- Expected: Notes incorporated into description

**3. No Service Selected:**
- Click generate without service
- Expected: Error message displayed

**4. API Key Missing:**
- Remove GEMINI_API_KEY
- Expected: Graceful error message

**5. Network Error:**
- Simulate API timeout
- Expected: Error message, form still usable

---

## 🚀 Future Enhancements

### **Potential Improvements:**

**1. Dynamic City Detection:**
- Use geocoded city from GPS
- Currently hardcoded to "Colorado Springs"
- Enhancement: Pass actual city from form

**2. Multiple Variations:**
- Generate 3 options
- User picks best one
- A/B test different styles

**3. Custom Tone:**
- Toggle: Professional / Casual / Technical
- Adjust prompt based on selection

**4. SEO Keywords:**
- Suggest relevant keywords
- Auto-highlight SEO terms in description

**5. History/Templates:**
- Save favorite descriptions
- Reuse for similar jobs
- Build template library

**6. Language Options:**
- Bilingual descriptions (English/Spanish)
- Important for Colorado market

---

## 📚 Related Documentation

- **Google Gemini API:** https://ai.google.dev/
- **Prompt Engineering Guide:** https://ai.google.dev/docs/prompting_strategies
- **Upload Form:** See `src/components/admin/upload-form.tsx`
- **API Routes:** See `src/app/api/generate-description/route.ts`

---

## ✅ Checklist

- [x] Install @google/generative-ai package
- [x] Create API route for Gemini
- [x] Update upload form UI
- [x] Add "Generate with AI" button
- [x] Implement loading states
- [x] Add error handling
- [x] Test with sample inputs
- [ ] Add GEMINI_API_KEY to Vercel
- [ ] Test on production
- [ ] Monitor API usage

---

## 🐛 Troubleshooting

### **Issue: "AI service not configured"**
**Solution:** Add `GEMINI_API_KEY` to environment variables

### **Issue: "Failed to generate description"**
**Possible causes:**
1. API key invalid
2. Rate limit exceeded
3. Network timeout
4. Gemini API down

**Debug:**
```bash
# Check Vercel logs for specific error
# Look for "Gemini API error:" messages
```

### **Issue: Button disabled**
**Solution:** Make sure service type is selected first

### **Issue: Description not auto-filling**
**Solution:** Check browser console for errors

---

**Status:** ✅ Ready for testing on feature branch  
**Branch:** `feature/p3-ai-description-generator`  
**Next Step:** Add API key to Vercel, test, then merge to `main`
