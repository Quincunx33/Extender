const MASTER_SYSTEM_INSTRUCTIONS = `You turn a user's request into a prompt they can give to another AI. Your job is to preserve what the user wants, not to make the request sound more technical or impressive.

Before writing, identify the user's actual goal, the intended result, and any constraints they stated. Keep the user's subject, scope, tone, and concrete details. Improve clarity without changing the idea.

Make the prompt only as detailed as the task needs. A simple request usually needs one to three clear sentences. Add structure or steps only when they materially help a genuinely complex task. Do not add generic sections, checklists, metrics, edge cases, tool requirements, technical stacks, audiences, or deliverables the user did not ask for. Never turn a small coding request into a full application specification.

Use reasonable defaults for minor gaps instead of inventing requirements or asking unnecessary questions. If a missing detail would fundamentally change the result, state one concise question inside the prompt only when needed.

Return only the copy-ready prompt. Make it direct, natural, specific to this request, and no longer than necessary. Do not execute the user's task, explain your process, add a title, or include alternatives unless requested. For attached media, use it as reference and describe only details that are actually visible.`;

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
  let tone = "";
  const files = [];

  const contentType = (request.headers.get("content-type") || "").toLowerCase();

  try {
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      idea = String(formData.get("idea") || "").trim();
      type = String(formData.get("type") || type).slice(0, 40);
      tone = String(formData.get("tone") || tone).slice(0, 100);

      const fileEntries = formData.getAll("files");
      for (const entry of fileEntries) {
        if (entry && typeof entry !== "string" && typeof entry.arrayBuffer === "function") {
          files.push(entry);
        }
      }
    } else {
      const body = await request.json();
      idea = typeof body?.idea === "string" ? body.idea.trim() : "";
      type = typeof body?.type === "string" ? body.type.slice(0, 40) : type;
      tone = typeof body?.tone === "string" ? body.tone.slice(0, 100) : tone;
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

  const promptInstructions = `Optional task-type hint: ${type}. ${tone ? `Requested tone: ${tone}.` : ""} Treat these as hints only; follow the actual request if it points elsewhere.

USER'S ORIGINAL REQUEST:
"""
${idea || "Use the attached media as reference and write a concise prompt that matches the user's likely intent."}
"""

Write the shortest useful, copy-ready prompt that would help another AI deliver what the user actually wants. Preserve their scope and specifics. Do not pad it with generic instructions, technical choices, sections, or requirements they did not request. Return only the prompt.`;

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
            temperature: 0.45,
            maxOutputTokens: 1200
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
