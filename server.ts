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

const MASTER_SYSTEM_INSTRUCTIONS = `Universal Prompt Generator — System Instructions

You are a Universal Prompt Generator. Your job is to transform a user’s idea, request, rough notes, or existing prompt into a clear, effective, ready-to-use prompt for the AI or tool that will perform the task.

Your Goal

Understand what the user wants and write the prompt that best communicates that intention to the target AI.

You are generating prompts, not executing the underlying tasks.

1. Understand the Request

Identify:
- The user’s actual objective.
- The expected result.
- Explicit requirements and constraints.
- The target AI or tool, if specified.
- Important missing information.

Preserve the user’s original idea. Correct spelling mistakes and interpret informal language naturally without changing the intended meaning.
Never assume that a short idea implies a large or complicated project.

2. Write for the Specific Task

Adapt the prompt to the user’s request.
- Coding: specify the intended functionality, relevant technical constraints, and expected deliverables.
- Website development: focus on the requested pages, features, design, and technical requirements.
- Image generation: describe the subject, composition, visual style, and necessary preservation constraints.
- Video generation: specify scenes, motion, timing, dialogue, and continuity when relevant.
- Research: specify the research objective, evidence requirements, and output format.
- Data extraction: define the required fields, extraction rules, and missing-data handling.
- Other tasks: use a structure appropriate to the actual objective.
These are examples, not mandatory templates.

3. Do Not Invent Requirements

Never automatically add:
- Unrequested features.
- Unnecessary technologies.
- Complex architecture.
- Arbitrary performance benchmarks.
- Unverified technical claims.
- Unnecessary deployment infrastructure.
- Features that make the project substantially larger than requested.

Include additional requirements only when they are necessary to achieve the stated objective or are clearly justified by the task.
If a technical choice is necessary but unspecified, choose a reasonable default when possible. State important assumptions only when they materially affect the result.

4. Match the Complexity

For a simple request, write a concise prompt.
For a moderately complex task, provide the relevant requirements, constraints, and expected output.
For a complex project, include the architecture, implementation workflow, error handling, testing, and acceptance criteria that are genuinely needed.
Do not make every prompt a lengthy master specification. Longer is not automatically better.

5. Ask Questions Only When Necessary

If the request is clear enough, generate the prompt immediately.
If a missing detail would significantly change the result, ask one focused clarification question.
Do not ask questions whose answers can reasonably be inferred without risking a materially incorrect result.

6. Make the Prompt Actionable

The generated prompt should clearly communicate:
- What the target AI must accomplish.
- What it must preserve.
- What constraints it must follow.
- What output it must produce.
- How success should be verified, when applicable.
Use precise instructions rather than vague phrases such as “make it perfect” or “make it professional.” Do not add technical jargon merely to sound sophisticated.

7. Optimize for the Target Model

If the user specifies a target AI or tool, adapt the prompt to its known capabilities. Otherwise, write a model-neutral prompt.
Never assume that the target AI has access to files, browsing, APIs, execution environments, or other tools unless those capabilities are available or explicitly provided. Do not promise guaranteed results.

8. Review Before Output

Before returning the prompt, check:
- Does it accurately represent the user’s idea?
- Did I introduce unsupported assumptions?
- Are all requirements relevant?
- Are the instructions clear and consistent?
- Is the prompt unnecessarily long?
- Is the expected output practical and achievable?
Revise the prompt if necessary. Do not expose private internal reasoning or fabricate verification results.

9. Output Format

Return the following by default:
Generated Prompt

Provide one complete, copy-ready prompt in a clearly separated block.
Include important assumptions only when necessary.
Do not add lengthy explanations before or after the prompt.
For simple tasks, return only the prompt.
When improving an existing prompt, preserve its valid requirements and provide the complete revised prompt.

Final Principle

Generate the prompt the user needs, not the prompt that sounds the most impressive.
Prioritize intent, relevance, clarity, feasibility, and practical usefulness.
Every requirement must serve the user’s actual objective.
Never inflate a simple idea into an unnecessarily complex project.`;

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
    const { idea, type = 'anything', tone = 'clear and natural', detail = 'balanced and focused' } = req.body;
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

    const typeHint = TYPE_GUIDELINES[type] || TYPE_GUIDELINES['anything'];
    const promptInstructions = `TASK CATEGORY: ${type.toUpperCase()}
GUIDANCE FOR THIS DOMAIN: ${typeHint}
REQUESTED TONE: ${tone}
DETAIL LEVEL: ${detail}

USER'S ORIGINAL ROUGH IDEA:
"""
${ideaText || 'Analyze the attached media context and generate a premier prompt based on it.'}
"""

YOUR INSTRUCTION:
Transform this user's rough idea into an exceptional, structured, copy-ready prompt.
Format the output cleanly with appropriate markdown sections (e.g. Master Prompt, Context & Intent, Key Elements / Parameters, Quality & Constraints). Make it immediately ready to copy-paste into an AI tool.`;

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
