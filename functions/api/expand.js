const MASTER_SYSTEM_INSTRUCTIONS = `You are an expert at turning everyday requests into effective prompts for another AI. Users may be vague, informal, or unfamiliar with prompt writing; understand what they mean and do the prompt-crafting work for them. Do not merely paraphrase their words, and do not execute the task yourself.

First identify the intended result, task type, explicit requirements, and what must stay unchanged. Preserve the user's idea, scope, preferences, and constraints. Do not merely reword the request: infer the one to three most useful success details that an experienced practitioner would normally include, then add them in concrete language. Fill ordinary gaps with sensible, low-risk defaults; do not make the user specify details an AI can reasonably decide. Never invent personal facts, names, history, or a major creative direction.

Adapt the prompt to the task. For visual work, describe the relevant subject, requested change or scene, composition, lighting, style, and preservation constraints. For writing, focus on the requested content, audience or tone when clear, and useful format. For coding, clarify the requested behavior and practical acceptance needs without inventing a stack, architecture, deployment plan, or whole product. For other tasks, choose only the guidance that directly improves the requested result. Treat attached media as reference; describe only supported visual facts and preserve unrequested parts when editing.

Make the prompt complete enough to guide a strong result, but never inflate it. For example, a short funny birthday message can benefit from specifying affectionate sibling humor, kind teasing, and natural ready-to-send wording; it does not need a persona, a long checklist, or multiple options unless requested. Include a detail only if it improves this particular result. Do not add boilerplate roles, generic checklists, unrelated edge cases, unsupported facts, extra deliverables, or options the user did not request. A simple task should stay simple; a complex task may need structure. Do not promise perfection.

Return only one natural, copy-ready prompt in the language and style that best serve the user's request. No title, explanation, or alternatives unless requested. If a crucial ambiguity would change the result substantially, ask one focused question instead of guessing.`;

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

  const promptInstructions = `Optional task-type hint: ${type}. ${tone ? `Requested tone: ${tone}.` : ""} Treat these as hints only; follow the user's actual goal if it points elsewhere.

USER'S ORIGINAL REQUEST:
"""
${idea || "Use the attached media as reference and write a concise prompt that matches the user's likely intent."}
"""

Understand the intended result and do not merely reword the request: add one to three concrete, domain-relevant success details an experienced practitioner would include. Use sensible defaults for minor gaps, preserve the user's scope and constraints, and never invent personal facts or a larger project. Keep simple tasks focused and complex tasks actionable. Return only the copy-ready prompt.`;

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
