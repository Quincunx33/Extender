# Meaw Genarator (Extender) 🐾
> Turn rough ideas into high-performance, copy-ready AI master prompts with feline charm.

GitHub Repository: [https://github.com/Quincunx33/Extender](https://github.com/Quincunx33/Extender)

---

## 🚀 Features
- 🐾 **Universal Prompt Architect:** Transforms quick thoughts or attached reference images into structured master prompts for Image, Code, Video, Story, or Universal domains.
- ⚡ **Instant Reset & Generation:** Automatically clears old buffers and generates clean, crisp, beautifully styled prompts.
- 🐱 **Interactive Cat Mascot & Meow Sound:** Tap the animated vector cat mascot for a meow, and hear a cheerful celebratory meow whenever a prompt finishes generating.
- ☁️ **Cloudflare Pages & Local Dev Ready:** Works seamlessly both locally on Node.js/Vite and in production on Cloudflare Pages Edge Functions.
- 🔒 **Server-Side Security:** Credentials live safely server-side without exposing API keys to the client browser.

---

## 🛠️ Environment Variables Configuration

Create a `.env` file in the root folder (see `.env.example`):

```env
# Required: Google Gemini API Key from Google AI Studio
GEMINI_API_KEY=your_gemini_api_key_here

# Model Selection (defaults)
GEMINI_MODEL_PRIMARY=gemini-3.5-flash-lite
GEMINI_MODEL_FALLBACK=gemini-3.1-flash-lite

# Port
PORT=3000
```

> Get your free Gemini API key at [Google AI Studio](https://aistudio.google.com/app/apikey).

---

## 💻 Local Development

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the dev server:
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000` in your browser.

3. Build production bundle:
   ```bash
   npm run build
   ```

---

## ☁️ How to Deploy to Cloudflare Pages (from GitHub)

This project is fully pre-configured for **Cloudflare Pages** with serverless Edge Functions in `/functions/api`.

### Step 1: Push your code to GitHub
Push your local code to your GitHub repository:
```bash
git add .
git commit -m "feat: Meaw Genarator ready for Cloudflare Pages"
git remote add origin https://github.com/Quincunx33/Extender.git
git branch -M main
git push -u origin main
```

### Step 2: Connect to Cloudflare Pages
1. Log into your [Cloudflare Dashboard](https://dash.cloudflare.com/).
2. Navigate to **Workers & Pages** > **Create application** > **Pages** > **Connect to Git**.
3. Select your repository: `Quincunx33/Extender`.
4. Configure the build settings:
   - **Framework preset:** `Vite`
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`

### Step 3: Add Environment Variables in Cloudflare Pages
In your Cloudflare Pages project:
1. Go to **Settings** > **Environment variables**.
2. Add your production variable:
   - **Variable name:** `GEMINI_API_KEY`
   - **Value:** Your actual Gemini API key (e.g. `AIzaSy...`)
3. (Optional) Set primary & fallback models:
   - `GEMINI_MODEL_PRIMARY`: `gemini-3.5-flash-lite`
   - `GEMINI_MODEL_FALLBACK`: `gemini-3.1-flash-lite`

### Step 4: Deploy!
Click **Save and Deploy**. Cloudflare Pages will build the static frontend into `dist/` and automatically route `/api/expand` to Cloudflare's global edge network via `functions/api/expand.js`!
