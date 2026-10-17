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
