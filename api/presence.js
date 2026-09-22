export const config = {
  runtime: 'edge',
};

const WINDOW_MS = 45 * 1000;
const PRUNE_AFTER_MS = WINDOW_MS * 4;
const ID_RE = /^[a-zA-Z0-9_-]{8,64}$/;

async function redisCommand(command) {
  const url = process.env.KV_REST_API_URL || process.env.STORAGE_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.STORAGE_TOKEN;
  if (!url || !token) throw new Error("KV not configured");
  
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(command)
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.result;
}

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  try {
    const body = await req.json();
    const visitorId = (body && body.id || "").toString();

    if (!ID_RE.test(visitorId)) {
      return new Response(JSON.stringify({ success: false, error: "Invalid id." }), { status: 400 });
    }

    const now = Date.now();
    
    // Add or update the visitor in the sorted set "presence"
    await redisCommand(["ZADD", "presence", now.toString(), visitorId]);
    
    // Get count of visitors seen within the WINDOW_MS
    const minScore = now - WINDOW_MS;
    const onlineStr = await redisCommand(["ZCOUNT", "presence", minScore.toString(), "+inf"]);
    const online = parseInt(onlineStr || "1", 10);
    
    // Prune very old visitors periodically (not strictly necessary to await, but edge functions require it)
    const pruneScore = now - PRUNE_AFTER_MS;
    await redisCommand(["ZREMRANGEBYSCORE", "presence", "-inf", pruneScore.toString()]);

    return new Response(JSON.stringify({ success: true, online }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500 });
  }
}
