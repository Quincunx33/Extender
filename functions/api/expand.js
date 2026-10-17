const MASTER_SYSTEM_INSTRUCTIONS = `UNIVERSAL PROMPT ARCHITECT — MASTER SYSTEM INSTRUCTIONS

1. IDENTITY & OBJECTIVE
You are the Universal Prompt Architect, an expert prompt engineering intelligence designed to transform rough, ambiguous, or incomplete human thoughts into ultra-high-performance, execution-ready master prompts for state-of-the-art AI systems (ChatGPT, Claude, Gemini, Midjourney, Stable Diffusion, Runaway, Cursor, Copilot, etc.).

Your goal is NOT to execute the task yourself. Your goal is to engineer the perfect, copy-ready prompt that the user can immediately paste into their chosen AI tool.

2. STRUCTURE OF THE GENERATED PROMPT
Assemble the generated prompt using clear, beautifully styled markdown sections:
- Master Prompt Title
- Target Role & Persona
- Context & Primary Objective
- Detailed Requirements & Technical / Aesthetic Parameters
- Step-by-Step Instructions or Execution Strategy
- Constraints & Edge Cases
- Acceptance Criteria & Verification

3. DOMAIN GUIDELINES
- For Image: Include composition, subject framing, camera lens & angle, atmospheric lighting, color palette, rendering engine details, aspect ratio, and negative prompt cues.
- For Code: Specify language, framework, design patterns, architecture boundaries, error handling, responsiveness, security, and verification steps.
- For Video: Specify scene sequences, camera movement (dolly/pan), temporal pacing, transitions, and audio/visual continuity.
- For Creative / Story: Establish narrative hook, emotional depth, perspective, character voice, sensory pacing, and thematic elements.
- For Universal: Discern intent, eliminate ambiguities, structure constraints, and deliver an actionable prompt.

4. DELIVERABLE
Return the finalized, copy-ready prompt directly. Do not include introductory conversational filler like "Here is your prompt:". Start straight with the architected prompt.`;

const TYPE_GUIDELINES = {
  image: "Focus on visual styling, camera optics, composition, lighting, textures, aspect ratio, atmosphere, and high-fidelity rendering parameters.",
  video: "Focus on sequence progression, camera motion (pan/tilt/tracking), scene transitions, atmosphere, visual continuity, and duration/aspect specs.",
  code: "Focus on software architecture, clean patterns, full stack implementation, typescript/modern standards, resilient error handling, and testable code.",
  story: "Focus on tone, character voice, sensory immersion, emotional stakes, thematic depth, and narrative structure.",
  anything: "Classify the domain automatically and construct an authoritative, comprehensive prompt tailored specifically for the user's objective."
};

function normalizeModel(modelStr, defaultModel) {
  if (!modelStr) return defaultModel;
  let m = String(modelStr).trim().toLowerCase().replace(/\s+/g, '-');
  if (m === 'gemini-3.5-flash-light') m = 'gemini-3.5-flash-lite';
  if (m === 'gemini-3.1-flash-light') m = 'gemini-3.1-flash-lite';
  return m;
}

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export async function onRequestPost({ request, env }) {
  const apiKey = (env.GEMINI_API_KEY || "").trim();
  if (!apiKey) {
    return new Response(JSON.stringify({
      error: "GEMINI_API_KEY is not configured in Cloudflare Pages. Please add GEMINI_API_KEY under Settings > Environment variables.",
      code: "MISSING_API_KEY",
      secretName: "GEMINI_API_KEY"
    }), {
      status: 503,
      headers: { "Content-Type": "application/json; charset=utf-8" }
    });
  }

  let idea = "";
  let type = "anything";
  let tone = "clear and natural";
  let detail = "balanced and focused";
  const files = [];

  const contentType = (request.headers.get("content-type") || "").toLowerCase();

  try {
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      idea = String(formData.get("idea") || "").trim();
      type = String(formData.get("type") || "anything");
      tone = String(formData.get("tone") || tone);
      detail = String(formData.get("detail") || detail);

      const fileEntries = formData.getAll("files");
      for (const entry of fileEntries) {
        if (entry && typeof entry !== "string" && typeof entry.arrayBuffer === "function") {
          files.push(entry);
        }
      }
    } else {
      const body = await request.json();
      idea = typeof body?.idea === "string" ? body.idea.trim() : "";
      type = typeof body?.type === "string" ? body.type : "anything";
      tone = typeof body?.tone === "string" ? body.tone : tone;
      detail = typeof body?.detail === "string" ? body.detail : detail;
    }
  } catch (err) {
    return new Response(JSON.stringify({
      error: "Could not parse request payload.",
      code: "BAD_REQUEST"
    }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  if (!idea && files.length === 0) {
    return new Response(JSON.stringify({
      error: "Please provide an idea or attach an image/video to generate a prompt.",
      code: "EMPTY_INPUT"
    }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const primaryModel = normalizeModel(env.GEMINI_MODEL_PRIMARY, "gemini-3.5-flash-lite");
  const fallbackModel = normalizeModel(env.GEMINI_MODEL_FALLBACK, "gemini-3.1-flash-lite");
  const modelsToTry = [...new Set([primaryModel, fallbackModel])];

  const typeHint = TYPE_GUIDELINES[type] || TYPE_GUIDELINES["anything"];
  const promptInstructions = `TASK CATEGORY: ${type.toUpperCase()}
GUIDANCE FOR THIS DOMAIN: ${typeHint}
REQUESTED TONE: ${tone}
DETAIL LEVEL: ${detail}

USER'S ORIGINAL ROUGH IDEA:
"""
${idea || "Analyze the attached media context and generate a premier prompt based on it."}
"""

YOUR INSTRUCTION:
Transform this user's rough idea into an exceptional, structured, copy-ready prompt.
Format the output cleanly with appropriate markdown sections (e.g. Master Prompt, Context & Intent, Key Elements / Parameters, Quality & Constraints). Make it immediately ready to copy-paste into an AI tool.`;

  const parts = [];

  // Add attached media if present
  for (const file of files) {
    const mime = (file.type || "").toLowerCase();
    if (mime.startsWith("image/")) {
      const buf = await file.arrayBuffer();
      parts.push({
        inlineData: {
          mimeType: mime,
          data: toBase64(buf)
        }
      });
    }
  }

  parts.push({ text: promptInstructions });

  let finalResult = null;
  let lastError = null;
  let modelUsed = "";

  for (const model of modelsToTry) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: MASTER_SYSTEM_INSTRUCTIONS }] },
          contents: [{ role: "user", parts }],
          generationConfig: {
            temperature: 0.7
          }
        })
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        lastError = { status: response.status, data };
        if (response.status === 401 || response.status === 403) {
          break; // Key invalid, fallback won't help
        }
        continue;
      }

      const generated = (data?.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("\n").trim();
      if (generated) {
        finalResult = generated;
        modelUsed = model;
        break;
      }
    } catch (e) {
      lastError = { status: 502, data: { error: { message: e.message } } };
    }
  }

  if (!finalResult) {
    const status = lastError?.status || 500;
    const msg = lastError?.data?.error?.message || "Generation failed";

    if (status === 401 || status === 400 && msg.includes("API_KEY_INVALID")) {
      return new Response(JSON.stringify({
        error: "GEMINI_API_KEY is invalid. Please check Cloudflare Pages environment variables.",
        code: "INVALID_API_KEY",
        secretName: "GEMINI_API_KEY"
      }), { status: 401, headers: { "Content-Type": "application/json" } });
    }

    if (status === 429) {
      return new Response(JSON.stringify({
        error: "Rate limit reached with Gemini API. Please wait a moment and try again.",
        code: "RATE_LIMITED",
        retryAfter: 5
      }), { status: 429, headers: { "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({
      error: `Prompt generation error: ${msg}`,
      code: "GENERATION_FAILED"
    }), { status: 502, headers: { "Content-Type": "application/json" } });
  }

  return new Response(JSON.stringify({
    prompt: finalResult,
    modelUsed,
    success: true
  }), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}
