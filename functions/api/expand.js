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
