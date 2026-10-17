<div align="center">

# Meaw Generator

**Small idea. Sharper prompts. A little more meow.**

Turn a rough thought into a clear, copy-ready prompt for your favorite AI.

[Try it live](https://meawpromt.pages.dev) · [Report an issue](https://github.com/Quincunx33/Extender/issues)

</div>

![Meaw Generator turning a habit-tracker idea into a ready-to-use prompt](docs/prompt-example.webp)

![Meaw Generator turning a cinematic cat idea into a ready-to-use prompt](docs/cinematic-cat.webp)

## What it does

- Shapes ideas into detailed prompts for code, images, stories, and more.
- Supports reference media, prompt history, and one-click copying.
- Adds a playful cat mascot and meow sounds.
- Keeps Gemini API credentials on the server side.

## Run locally

```bash
npm install
cp .env.example .env
# Add your GEMINI_API_KEY to .env
npm run dev
```

Open the local URL printed by the dev server. To create a production build, run `npm run build`.

## Deploy

Deploy as a Cloudflare Pages project with build command `npm run build`, output directory `dist`, and `GEMINI_API_KEY` configured as a Pages environment secret.

---

<div align="center">Made with curiosity, prompts, and paws. 🐾</div>
