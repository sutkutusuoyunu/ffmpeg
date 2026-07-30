/**
 * Cloudflare Worker — signs Cloudinary uploads and auto-deletes
 * anything older than 30 minutes via a Cron Trigger.
 *
 * Required secrets (set with `wrangler secret put NAME`):
 *   CLOUDINARY_CLOUD_NAME
 *   CLOUDINARY_API_KEY
 *   CLOUDINARY_API_SECRET
 *
 * Required KV binding (wrangler.toml): UPLOADS
 *   Stores { public_id, resource_type, uploaded_at } so the cron job
 *   knows what to delete and when, without listing your whole account.
 */

const TAG = "temp-compress";
const MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

async function sha1Hex(input) {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-1", data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Cloudinary signing: sort params alphabetically, join as k=v&k=v, append secret, SHA-1.
async function signParams(params, apiSecret) {
  const sorted = Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== "")
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return sha1Hex(sorted + apiSecret);
}

async function handleSignRequest(request, env) {
  const body = await request.json().catch(() => ({}));
  const resourceType = body.resource_type === "video" ? "video" : body.resource_type || "auto";

  const timestamp = Math.floor(Date.now() / 1000);
  const public_id = `${TAG}/${crypto.randomUUID()}`;

  // Only these params get signed. Anything else (like the file itself,
  // api_key) is sent unsigned alongside the signature per Cloudinary's spec.
  const paramsToSign = {
    timestamp,
    public_id,
    tags: TAG,
  };

  const signature = await signParams(paramsToSign, env.CLOUDINARY_API_SECRET);

  return {
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    timestamp,
    public_id,
    tags: TAG,
    signature,
    resource_type: resourceType,
  };
}

async function recordUpload(env, { public_id, resource_type }) {
  const key = `${resource_type}:${public_id}`;
  await env.UPLOADS.put(
    key,
    JSON.stringify({ public_id, resource_type, uploaded_at: Date.now() }),
    { expirationTtl: 60 * 60 } // KV entry itself expires in 1hr as a safety net
  );
}

async function cloudinaryAdminAuthHeader(env) {
  const cred = `${env.CLOUDINARY_API_KEY}:${env.CLOUDINARY_API_SECRET}`;
  return "Basic " + btoa(cred);
}

async function deleteAsset(env, public_id, resource_type) {
  const url = `https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/resources/${resource_type}/upload`;
  const auth = await cloudinaryAdminAuthHeader(env);
  const params = new URLSearchParams({ public_ids: public_id });
  await fetch(`${url}?${params.toString()}`, {
    method: "DELETE",
    headers: { Authorization: auth },
  });
}

async function runCleanup(env) {
  const list = await env.UPLOADS.list();
  const now = Date.now();
  for (const entry of list.keys) {
    const raw = await env.UPLOADS.get(entry.name);
    if (!raw) continue;
    const record = JSON.parse(raw);
    if (now - record.uploaded_at >= MAX_AGE_MS) {
      await deleteAsset(env, record.public_id, record.resource_type);
      await env.UPLOADS.delete(entry.name);
    }
  }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    const headers = corsHeaders(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers });
    }

    const url = new URL(request.url);

    if (url.pathname === "/sign" && request.method === "POST") {
      try {
        const payload = await handleSignRequest(request, env);
        return new Response(JSON.stringify(payload), {
          headers: { ...headers, "Content-Type": "application/json" },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { ...headers, "Content-Type": "application/json" },
        });
      }
    }

    if (url.pathname === "/register" && request.method === "POST") {
      try {
        const body = await request.json();
        await recordUpload(env, body);
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...headers, "Content-Type": "application/json" },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { ...headers, "Content-Type": "application/json" },
        });
      }
    }

    // Manual trigger for testing cleanup without waiting for cron
    if (url.pathname === "/cleanup" && request.method === "POST") {
      await runCleanup(env);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    return new Response("Not found", { status: 404, headers });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runCleanup(env));
  },
};
