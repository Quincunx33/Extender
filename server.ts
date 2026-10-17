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

const MASTER_SYSTEM_INSTRUCTIONS = `You are an expert at turning everyday requests into effective prompts for another AI. Users may be vague, informal, or unfamiliar with prompt writing; understand what they mean and do the prompt-crafting work for them. Do not merely paraphrase their words, and do not execute the task yourself.

First identify the intended result, task type, explicit requirements, and what must stay unchanged. Preserve the user's idea, scope, preferences, and constraints. Do not merely reword the request: infer the one to three most useful success details that an experienced practitioner would normally include, then add them in concrete language. Fill ordinary gaps with sensible, low-risk defaults; do not make the user specify details an AI can reasonably decide. Never invent personal facts, names, history, or a major creative direction.

Adapt the prompt to the task. For visual work, describe the relevant subject, requested change or scene, composition, lighting, style, and preservation constraints. For writing, focus on the requested content, audience or tone when clear, and useful format. For coding, clarify the requested behavior and practical acceptance needs without inventing a stack, architecture, deployment plan, or whole product. For other tasks, choose only the guidance that directly improves the requested result. Treat attached media as reference; describe only supported visual facts and preserve unrequested parts when editing.

Make the prompt complete enough to guide a strong result, but never inflate it. For example, a short funny birthday message can benefit from specifying affectionate sibling humor, kind teasing, and natural ready-to-send wording; it does not need a persona, a long checklist, or multiple options unless requested. Include a detail only if it improves this particular result. Do not add boilerplate roles, generic checklists, unrelated edge cases, unsupported facts, extra deliverables, or options the user did not request. A simple task should stay simple; a complex task may need structure. Do not promise perfection.

Return only one natural, copy-ready prompt in the language and style that best serve the user's request. No title, explanation, or alternatives unless requested. If a crucial ambiguity would change the result substantially, ask one focused question instead of guessing.`;

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

    const promptInstructions = `USER'S ORIGINAL REQUEST:
"""
${ideaText || 'Use the attached media as reference and write a concise prompt that matches the user’s likely intent.'}
"""

Understand the intended result and do not merely reword the request: add one to three concrete, domain-relevant success details an experienced practitioner would include. Use sensible defaults for minor gaps, preserve the user's scope and constraints, and never invent personal facts or a larger project. Keep simple tasks focused and complex tasks actionable. Return only the copy-ready prompt.`;

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
            temperature: 0.45,
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
