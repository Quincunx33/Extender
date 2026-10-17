import express from 'express';
import { createServer as createViteServer } from 'vite';
import cors from 'cors';
import multer from 'multer';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024,
    files: 5,
  },
});

const MASTER_SYSTEM_INSTRUCTIONS = `name: prompt-generator
description: Turn casual Bengali, Banglish, or everyday-language requests into clear, copy-ready prompts for ordinary AI tasks such as writing, research, planning, coding, analysis, tutoring, and creative work.

# General-Purpose Prompt Generator

Turn the user's rough request into a useful prompt for the intended AI task. Understand Bengali, Banglish, fragments, and informal wording. Preserve intent, add only helpful structure, and do not make the user learn prompt-engineering terminology. Unless they ask only for advice or an explanation, deliver a copy-ready prompt.

## Workflow

1. **Identify the goal:** What result does the user want the AI to produce or do? Identify the target model/tool or audience if stated.
2. **Extract constraints:** Capture context, inputs or source material, scope, tone, language, length, format, deadline, exclusions, and success criteria that the user actually specified.
3. **Fill gaps carefully:** Add task-relevant guidance that improves reliability, such as requesting verifiable sources for research, tests for code, or clear assumptions for analysis. Do not invent facts, preferences, data, or goals. Use placeholders for missing details when the user can fill them in.
4. **Clarify only when needed:** Ask one focused question only if an ambiguity would materially change the output or make the prompt unusable. Otherwise make a reasonable minimal assumption and label it briefly if useful.
5. **Write the prompt:** Make it direct, specific, self-contained, and easy to paste. Use sections or numbered steps only when they help the task. Specify the expected output format and quality criteria.
6. **Check safety and scope:** Do not turn a benign request into harmful instructions. Preserve the user's intended boundaries and avoid claiming that a prompt guarantees correct results.

## Prompt design principles

- Put the desired outcome and essential context first.
- State the model's role only if it helps, and define the actual task rather than relying on a grandiose persona.
- Separate provided facts from assumptions; tell the model not to fabricate missing information.
- Specify audience, tone, language, level of detail, structure, and constraints when they matter.
- For multi-part work, order the steps and define dependencies. For complex outputs, request a concise final answer plus supporting reasoning or evidence as appropriate; do not demand hidden chain-of-thought.
- For research, ask for credible, current sources and citations when needed, and distinguish confirmed facts from uncertainty.
- For coding, include language, environment, inputs, expected behavior, edge cases, and tests when known; never invent an environment specification.
- For analysis, state the question, data and assumptions, desired method or metrics, and output format; ask the model to flag limitations.
- For writing, specify audience, purpose, voice, length, structure, and any facts or phrases to preserve.
- For creative tasks, specify the core idea, style, constraints, and deliverable while leaving room for creativity.
- Do not pad prompts with generic instructions such as “be an expert,” repetitive “think step by step,” or irrelevant negative constraints.

## Reusable structure

Use and adapt this structure; omit fields that do not apply:

\`\`\`text
Task: [specific outcome]

Context / input:
[relevant background, source text, data, or placeholder]

Requirements:
- [key constraint or preference]
- [scope, exclusions, or success criteria]

Output:
[format, language, audience, length, and organization]

If information is missing, [ask a concise question / state assumptions / use placeholders]. Do not invent facts. Before finalizing, check that the result meets the requirements above.
\`\`\`

## Task-specific adaptation

Use a short plain prompt for straightforward requests. For complex tasks, structure the prompt into context, task, constraints, process, and deliverable. If the user asks to improve an existing prompt, preserve its goal and any useful constraints, remove ambiguity or redundancy, and return the revised version; briefly note major changes only if helpful.

When the task involves image generation/editing, adapt the request with visual details such as subject, change-only/preserve rules, composition, lighting, and style. Treat that as a specialized task type, not the skill's default scope. For an uploaded-image edit, explicitly preserve all unrequested areas; for generation, describe the subject, action, setting, framing, and visual treatment.

## Response format

Briefly explain in Bengali or the user's language what you understood, then provide one copy-ready prompt in a code block. Normally write the prompt in clear English because many AI tools respond reliably to it, but use the user's requested language or target tool language when specified. Do not add a prompt when the user only wants an explanation, and do not bury the deliverable under a long tutorial.

## Quality check

Before responding, ensure the prompt has a clear objective, sufficient context, explicit relevant constraints, a usable output format, no invented details or contradictory directions, and an appropriate level of specificity. Keep it as short as the task permits.`;

const TYPE_GUIDELINES: Record<string, string> = {
  image: "Focus on visual styling, camera optics, composition, lighting, textures, aspect ratio, atmosphere, and high-fidelity rendering parameters.",
  video: "Focus on sequence progression, camera motion (pan/tilt/tracking), scene transitions, atmosphere, visual continuity, and duration/aspect specs.",
  code: "Focus on software architecture, clean patterns, full stack implementation, typescript/modern standards, resilient error handling, and testable code.",
  story: "Focus on tone, character voice, sensory immersion, emotional stakes, thematic depth, and narrative structure.",
  anything: "Classify the domain automatically and construct an authoritative, comprehensive prompt tailored specifically for the user's objective."
};

function normalizeModel(modelStr: string, defaultModel: string): string {
  if (!modelStr) return defaultModel;
  let m = modelStr.trim().toLowerCase().replace(/\s+/g, '-');
  if (m === 'gemini-3.5-flash-light') m = 'gemini-3.5-flash-lite';
  if (m === 'gemini-3.1-flash-light') m = 'gemini-3.1-flash-lite';
  return m;
}

const PRIMARY_MODEL = normalizeModel(process.env.GEMINI_MODEL_PRIMARY || '', 'gemini-3.5-flash-lite');
const FALLBACK_MODEL = normalizeModel(process.env.GEMINI_MODEL_FALLBACK || '', 'gemini-3.1-flash-lite');

function getAiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;
  return new GoogleGenAI({ apiKey });
}

// System configuration & health endpoint
app.get('/api/system/status', (_req, res) => {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  res.json({
    configured: Boolean(apiKey && apiKey.length > 5),
    secretName: 'GEMINI_API_KEY',
    primaryModel: PRIMARY_MODEL,
    fallbackModel: FALLBACK_MODEL,
    status: apiKey ? 'ready' : 'missing_key',
    message: apiKey
      ? 'GEMINI_API_KEY is configured and ready.'
      : 'GEMINI_API_KEY is not set in environment. Please add it to your .env file.',
  });
});

// Prompt Generation Endpoint
app.post('/api/expand', upload.any(), async (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return res.status(503).json({
      error: 'GEMINI_API_KEY is not configured in the environment. Please add GEMINI_API_KEY=your_key to your .env file.',
      code: 'MISSING_API_KEY',
      secretName: 'GEMINI_API_KEY',
      hint: 'Create a .env file based on .env.example with your Google AI Studio key: https://aistudio.google.com/app/apikey'
    });
  }

  try {
    const { idea } = req.body;
    const files = (req.files as Express.Multer.File[]) || [];

    const ideaText = typeof idea === 'string' ? idea.trim() : '';

    if (!ideaText && files.length === 0) {
      return res.status(400).json({
        error: 'Please provide an idea or attach an image/video to generate a prompt.',
        code: 'EMPTY_INPUT',
      });
    }

    if (ideaText.length > 4000) {
      return res.status(400).json({
        error: 'Your starting idea is too long. Please keep it under 4,000 characters.',
        code: 'INPUT_TOO_LONG',
      });
    }

    const ai = getAiClient();
    if (!ai) {
      return res.status(503).json({
        error: 'Unable to initialize Gemini client. Check GEMINI_API_KEY format.',
        code: 'CLIENT_INIT_FAILED',
      });
    }

    const promptInstructions = `USER'S ORIGINAL ROUGH IDEA OR REQUEST:
"""
${ideaText || 'Analyze the attached media context and generate a premier prompt based on it.'}
"""

Apply the Universal Prompt Engineering Skill (UPE-01) methodology to analyze this request, determine its domain (coding, writing, image, video, analysis, etc.) and tone automatically, and construct an exceptional, copy-ready prompt. Return the finalized prompt directly.`;

    // Prepare contents
    const parts: any[] = [];

    // Add attached media if present
    for (const file of files) {
      if (file.mimetype.startsWith('image/')) {
        parts.push({
          inlineData: {
            mimeType: file.mimetype,
            data: file.buffer.toString('base64'),
          },
        });
      }
    }

    parts.push({ text: promptInstructions });

    // Attempt generation with primary model, then fallback
    const modelsToTry = [PRIMARY_MODEL, FALLBACK_MODEL];
    let lastError: any = null;
    let generatedText = '';
    let usedModel = '';

    for (const modelName of modelsToTry) {
      try {
        const response = await ai.models.generateContent({
          model: modelName,
          contents: [{ role: 'user', parts }],
          config: {
            systemInstruction: MASTER_SYSTEM_INSTRUCTIONS,
            temperature: 0.7,
          },
        });

        const text = response.text?.trim();
        if (text) {
          generatedText = text;
          usedModel = modelName;
          break;
        }
      } catch (err: any) {
        console.warn(`Model ${modelName} failed:`, err?.message || err);
        lastError = err;
        const errMsg = String(err?.message || '').toLowerCase();
        if (errMsg.includes('api_key_invalid') || errMsg.includes('api key not valid')) {
          break;
        }
      }
    }

    if (!generatedText) {
      const errMessage = lastError?.message || 'Unknown generation failure';
      const status = lastError?.status || 500;

      const lowerErr = errMessage.toLowerCase();
      if (lowerErr.includes('api_key_invalid') || lowerErr.includes('api key not valid')) {
        return res.status(401).json({
          error: 'The GEMINI_API_KEY is not valid or has expired. Please check your .env file or project secrets.',
          code: 'INVALID_API_KEY',
          secretName: 'GEMINI_API_KEY',
          hint: 'Create or update your .env file with GEMINI_API_KEY=AIzaSy... from Google AI Studio.'
        });
      }

      if (status === 429 || lowerErr.includes('resource_exhausted')) {
        return res.status(429).json({
          error: 'Rate limit or quota exceeded with Gemini API. Please wait a few seconds and try again.',
          code: 'RATE_LIMITED',
          retryAfter: 5,
        });
      }

      return res.status(502).json({
        error: `Prompt generation encountered an issue: ${errMessage}`,
        code: 'GENERATION_FAILED',
        hint: 'Check your starting idea or try another prompt category.',
      });
    }

    return res.json({
      prompt: generatedText,
      modelUsed: usedModel,
      success: true,
    });
  } catch (error: any) {
    console.error('API /expand error:', error);
    return res.status(500).json({
      error: error?.message || 'An internal server error occurred while expanding your prompt.',
      code: 'SERVER_ERROR',
    });
  }
});

async function startServer() {
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });

  app.use(vite.middlewares);

  app.listen(3000, '0.0.0.0', () => {
    console.log('Meaw Genarator server running on http://0.0.0.0:3000');
  });
}

startServer();
