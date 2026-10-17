export async function onRequestGet({ env }) {
  const apiKey = (env.GEMINI_API_KEY || "").trim();
  const primary = (env.GEMINI_MODEL_PRIMARY || "gemini-3.5-flash-lite").trim();
  const fallback = (env.GEMINI_MODEL_FALLBACK || "gemini-3.1-flash-lite").trim();

  return new Response(JSON.stringify({
    configured: Boolean(apiKey && apiKey.length > 5),
    secretName: "GEMINI_API_KEY",
    primaryModel: primary,
    fallbackModel: fallback,
    status: apiKey ? "ready" : "missing_key",
    message: apiKey
      ? "GEMINI_API_KEY is configured on Cloudflare Pages."
      : "GEMINI_API_KEY is not set. Add it in Cloudflare Pages Dashboard under Settings > Environment variables."
  }), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}
