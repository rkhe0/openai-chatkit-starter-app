interface Env {
  OPENAI_API_KEY: string;
  CHATKIT_WORKFLOW_ID?: string;
  VITE_CHATKIT_WORKFLOW_ID?: string;
  CHATKIT_API_BASE?: string;
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method === "GET") {
    return json({ ok: true, message: "Use POST /api/create-session" }, 200);
  }

  if (request.method !== "POST") {
    return json({ error: "Method Not Allowed" }, 405);
  }

  const body = await request.json().catch(() => ({} as any));

  const workflowId =
    body?.workflow?.id ||
    body?.workflowId ||
    env.CHATKIT_WORKFLOW_ID ||
    env.VITE_CHATKIT_WORKFLOW_ID;

  if (!env.OPENAI_API_KEY) {
    return json({ error: "Missing OPENAI_API_KEY" }, 500);
  }

  if (!workflowId) {
    return json({ error: "Missing workflow id" }, 400);
  }

  const apiBase = env.CHATKIT_API_BASE || "https://api.openai.com";

  const upstream = await fetch(`${apiBase}/v1/chatkit/sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "OpenAI-Beta": "chatkit_beta=v1",
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      user: "demo-user",
      workflow: { id: workflowId },
    }),
  });

  const payload = await upstream.json().catch(() => ({} as any));

  if (!upstream.ok) {
    return json(
      {
        error:
          payload?.error?.message ||
          payload?.error ||
          "Failed to create ChatKit session",
      },
      upstream.status
    );
  }

  const clientSecret =
    typeof payload.client_secret === "string"
      ? payload.client_secret
      : payload.client_secret?.value;

  if (!clientSecret) {
    return json({ error: "Missing client_secret from OpenAI response" }, 500);
  }

  return json({
    client_secret: clientSecret,
    expires_after: payload.expires_after,
  });
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}