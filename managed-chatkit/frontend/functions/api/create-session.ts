interface Env {
  OPENAI_API_KEY: string;
  CHATKIT_WORKFLOW_ID?: string;
  VITE_CHATKIT_WORKFLOW_ID?: string;
  CHATKIT_API_BASE?: string;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
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
      workflow: { id: workflowId },
      user: crypto.randomUUID(),
    }),
  });

  const payload = await upstream.json().catch(() => ({}));

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

  return json({
    client_secret: payload.client_secret,
    expires_after: payload.expires_after,
  });
};

export const onRequestGet: PagesFunction = async () => {
  return json({ ok: true, message: "Use POST /api/create-session" }, 200);
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}