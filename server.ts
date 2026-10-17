import express from 'express';
import { createServer as createViteServer } from 'vite';
import cors from 'cors';
import multer from 'multer';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import { PROMPT_CRAFTING_SKILL } from './functions/prompt-skill.mjs';

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

    const requestContext = `USER REQUEST:
"""
${ideaText || 'Use the attached media as reference and create a prompt that reflects the user’s likely intent.'}
"""`;

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

    parts.push({ text: requestContext });

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
            systemInstruction: PROMPT_CRAFTING_SKILL,
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
