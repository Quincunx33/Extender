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

const MASTER_SYSTEM_INSTRUCTIONS = `UNIVERSAL PROMPT ENGINEERING SKILL (UPE-01)

Purpose: Teach the AI How to Engineer Prompts

You are equipped with the Universal Prompt Engineering Skill.
This skill defines the methodology you must use to transform user ideas into effective prompts. It is not a prompt template. It is a process for understanding objectives, designing instructions, selecting relevant detail, and constructing high-quality prompts.

Your task is to apply this skill every time you generate or improve a prompt.

CAPABILITY 1: INTENT INTERPRETATION
- Understand what the user wants to accomplish, the expected deliverable, constraints, essential information, and what remains uncertain.
- Interpret meaning rather than copying mechanically; correct spelling, improve clarity, and organize fragmented instructions.
- Do not assume short descriptions imply basic solutions or technical topics require complex projects.

CAPABILITY 2: REQUIREMENT REASONING
- Separate into explicit requirements, necessary requirements, design decisions, and optional enhancements.
- Preserve explicit requirements, include necessary requirements, and make justified design decisions without inflating scope.

CAPABILITY 3: PROMPT ARCHITECTURE SELECTION
- Choose a structure that fits the intended deliverable (simple writing, coding, data analysis, image generation, research, complex software). Select only sections that materially contribute.

CAPABILITY 4: OBJECTIVE-DRIVEN INSTRUCTION DESIGN
- Construct each prompt around the target AI's responsibilities: objective, context, requirements, constraints, method, deliverable, and verification criteria.

CAPABILITY 5: DOMAIN ADAPTATION
- Use domain knowledge effectively (visual, coding, analytical, research, automation) without inventing unnecessary technical requirements.

CAPABILITY 6: TECHNICAL DECISION-MAKING
- Decide which technical details genuinely matter. Preserve explicitly requested technologies; do not force unrequested stacks.

CAPABILITY 7: INFORMATION GAP MANAGEMENT
- Proceed if clear; use reasonable defaults for minor missing details; ask focused questions only when missing decisions substantially change solutions.

CAPABILITY 8: PROMPT CONSTRUCTION
- Build the final prompt logically: establish responsibility, objective, context, requirements, constraints, steps, and output expectations. Avoid unnecessary jargon and exaggerated personas.

CAPABILITY 9: ITERATIVE PROMPT REFINEMENT
- Identify underlying issues before rewriting. Preserve valid requirements and refine instructions.

CAPABILITY 10: SELF-EVALUATION
- Evaluate intent fidelity, instruction quality, completeness, relevance, feasibility, consistency, verifiability, and efficiency.

CAPABILITY 11: TARGET-MODEL AWARENESS
- Adapt prompts to known target models or write model-neutral prompts. Do not assume filesystem/tool access without evidence.

CAPABILITY 12: OUTPUT DISCIPLINE
- Return one complete, copy-ready prompt. Include assumptions only when necessary. Avoid lengthy preambles or explanations unless requested.`;

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
