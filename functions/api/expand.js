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
  const files = [];

  const contentType = (request.headers.get("content-type") || "").toLowerCase();

  try {
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      idea = String(formData.get("idea") || "").trim();

      const fileEntries = formData.getAll("files");
      for (const entry of fileEntries) {
        if (entry && typeof entry !== "string" && typeof entry.arrayBuffer === "function") {
          files.push(entry);
        }
      }
    } else {
      const body = await request.json();
      idea = typeof body?.idea === "string" ? body.idea.trim() : "";
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

  const promptInstructions = `USER'S ORIGINAL ROUGH IDEA OR REQUEST:
"""
${idea || "Analyze the attached media context and generate a premier prompt based on it."}
"""

Apply the Universal Prompt Engineering Skill (UPE-01) methodology to analyze this request, determine its domain (coding, writing, image, video, analysis, etc.) and tone automatically, and construct an exceptional, copy-ready prompt. Return the finalized prompt directly.`;

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
