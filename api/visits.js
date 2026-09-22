export const config = {
  runtime: 'edge',
};

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
    const deviceId = (body && body.id || "").toString();

    if (!ID_RE.test(deviceId)) {
      return new Response(JSON.stringify({ success: false, error: "Invalid id." }), { status: 400 });
    }

    // Get today's date in YYYY-MM-DD (UTC)
    const now = new Date();
    const dateKey = now.toISOString().split("T")[0];
    const setKey = `visits:${dateKey}`;

    // Add deviceId to today's set
    await redisCommand(["SADD", setKey, deviceId]);
    
    // Set an expiration on the key so we don't accumulate data forever (2 days)
    await redisCommand(["EXPIRE", setKey, "172800"]);

    // Get the total count for today
    const visitsStr = await redisCommand(["SCARD", setKey]);
    const visits = parseInt(visitsStr || "1", 10);

    return new Response(JSON.stringify({ success: true, visits }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500 });
  }
}
