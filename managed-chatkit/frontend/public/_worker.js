export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return corsResponse();
    }

    if (url.pathname === "/mcp") {
      return handleMcp(request, env);
    }

    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        service: "DevTrend Agent Worker",
        role: "ChatKit session backend and MCP server",
        tools: ["collect_trends", "save_notion_report", "send_email_report"],
        time: new Date().toISOString(),
      });
    }

    if (url.pathname === "/api/create-session") {
      return handleCreateSession(request, env);
    }

    if (url.pathname === "/api/collect-trends") {
      return handleCollectTrends(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};

/**
 * ChatKit session backend.
 * The browser calls this endpoint to create a ChatKit session bound to the
 * Agent Builder workflow id stored in environment variables.
 */
async function handleCreateSession(request, env) {
  if (request.method === "GET") {
    return json({ ok: true, message: "Use POST /api/create-session" });
  }

  if (request.method !== "POST") {
    return json({ error: "Method Not Allowed" }, 405);
  }

  const body = await request.json().catch(() => ({}));

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

  const upstream = await fetch("https://api.openai.com/v1/chatkit/sessions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "OpenAI-Beta": "chatkit_beta=v1",
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      user: body.user || "demo-user",
      workflow: { id: workflowId },
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
        details: payload,
      },
      upstream.status
    );
  }

  const clientSecret =
    typeof payload.client_secret === "string"
      ? payload.client_secret
      : payload.client_secret?.value;

  if (!clientSecret) {
    return json(
      {
        error: "Missing client_secret from OpenAI response",
        details: payload,
      },
      500
    );
  }

  return json({
    client_secret: clientSecret,
    expires_after: payload.expires_after,
  });
}

/**
 * Optional test endpoint for direct source collection.
 * This endpoint does not generate a report and does not send anything.
 */
async function handleCollectTrends(request, env) {
  if (request.method === "GET") {
    return json({
      ok: true,
      message: "Use POST /api/collect-trends",
      sample_body: { query: "AI Agent MCP Workflow automation" },
    });
  }

  if (request.method !== "POST") {
    return json({ error: "Method Not Allowed" }, 405);
  }

  const body = await request.json().catch(() => ({}));
  const query = String(body.query || "AI Agent MCP Workflow automation").trim();
  const result = await collectTrendsTool(query, env);

  return json(result);
}

async function collectTrendsTool(query, env) {
  const collected = await collectTrendSources(query, env);

  return {
    tool_name: "collect_trends",
    query,
    normalized_query: normalizeGenericSearchTerms(query).join(" "),
    generated_at: new Date().toISOString(),
    api_evidence: getApiEvidence(),
    counts: collected.counts,
    source_errors: collected.source_errors,
    sources: collected.sources,
  };
}

async function collectTrendSources(query, env) {
  const [arxiv, github, hackerNews] = await Promise.allSettled([
    searchArxiv(query),
    searchGithub(query, env),
    searchHackerNews(query),
  ]);

  const sources = {
    arxiv: arxiv.status === "fulfilled" ? arxiv.value : [],
    github: github.status === "fulfilled" ? github.value : [],
    hacker_news: hackerNews.status === "fulfilled" ? hackerNews.value : [],
  };

  const source_errors = {
    arxiv: arxiv.status === "rejected" ? String(arxiv.reason) : null,
    github: github.status === "rejected" ? String(github.reason) : null,
    hacker_news:
      hackerNews.status === "rejected" ? String(hackerNews.reason) : null,
  };

  const counts = {
    arxiv: sources.arxiv.length,
    github: sources.github.length,
    hacker_news: sources.hacker_news.length,
  };

  return { sources, source_errors, counts };
}

function getApiEvidence() {
  return [
    {
      source: "arXiv",
      method: "GET",
      endpoint: "https://export.arxiv.org/api/query",
      purpose: "AI 연구 논문 수집",
    },
    {
      source: "GitHub",
      method: "GET",
      endpoint: "https://api.github.com/search/repositories",
      purpose: "AI 오픈소스 저장소 수집",
    },
    {
      source: "Hacker News",
      method: "GET",
      endpoint: "https://hn.algolia.com/api/v1/search_by_date",
      purpose: "개발자 커뮤니티 반응 수집",
    },
  ];
}

async function searchArxiv(query) {
  const terms = normalizeGenericSearchTerms(query).slice(0, 8);

  if (terms.length === 0) {
    return [];
  }

  const keywordQuery = terms.map((term) => `all:${term}`).join(" OR ");
  const categoryQuery = [
    "cat:cs.AI",
    "cat:cs.LG",
    "cat:cs.CL",
    "cat:cs.CV",
    "cat:cs.SE",
  ].join(" OR ");

  const params = new URLSearchParams({
    search_query: `(${keywordQuery}) AND (${categoryQuery})`,
    start: "0",
    max_results: "5",
    sortBy: "submittedDate",
    sortOrder: "descending",
  });

  const response = await fetch(`https://export.arxiv.org/api/query?${params}`, {
    headers: { "User-Agent": "DevTrendAgent/1.0" },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `arXiv API failed: ${response.status} ${text.slice(0, 300)}`
    );
  }

  const xml = await response.text();
  const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];

  return entries.slice(0, 5).map((entry) => ({
    source: "arXiv",
    title: cleanXml(getXmlTag(entry, "title")),
    summary: cleanXml(getXmlTag(entry, "summary")).slice(0, 800),
    url: cleanXml(getXmlTag(entry, "id")),
    published: cleanXml(getXmlTag(entry, "published")),
    updated: cleanXml(getXmlTag(entry, "updated")),
    authors: [
      ...entry.matchAll(
        /<author>\s*<name>([\s\S]*?)<\/name>\s*<\/author>/g
      ),
    ]
      .map((m) => cleanXml(m[1]))
      .slice(0, 5),
  }));
}

async function searchGithub(query, env) {
  const terms = normalizeGenericSearchTerms(query);
  const safeQuery = terms.length ? terms.join(" ") : String(query || "").trim();

  if (!safeQuery) {
    return [];
  }

  const params = new URLSearchParams({
    q: `${safeQuery} in:name,description,readme`,
    sort: "updated",
    order: "desc",
    per_page: "5",
  });

  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "DevTrendAgent/1.0",
  };

  if (env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
  }

  const response = await fetch(
    `https://api.github.com/search/repositories?${params}`,
    { headers }
  );

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`GitHub API failed: ${response.status} ${text}`);
  }

  const data = await response.json();

  return (data.items || []).slice(0, 5).map((repo) => ({
    source: "GitHub",
    title: repo.full_name,
    description: repo.description || "",
    url: repo.html_url,
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    language: repo.language,
    updated_at: repo.updated_at,
    created_at: repo.created_at,
    pushed_at: repo.pushed_at,
    topics: repo.topics || [],
  }));
}

async function searchHackerNews(query) {
  const queries = buildHackerNewsQueries(query);
  const allHits = [];

  for (const q of queries) {
    const params = new URLSearchParams({
      query: q,
      tags: "story",
      hitsPerPage: "5",
    });

    const response = await fetch(
      `https://hn.algolia.com/api/v1/search_by_date?${params}`,
      { headers: { "User-Agent": "DevTrendAgent/1.0" } }
    );

    if (!response.ok) {
      throw new Error(`Hacker News API failed: ${response.status}`);
    }

    const data = await response.json();

    for (const item of data.hits || []) {
      allHits.push({
        source: "Hacker News",
        matched_query: q,
        title: item.title || item.story_title || "",
        url:
          item.url ||
          item.story_url ||
          `https://news.ycombinator.com/item?id=${item.objectID}`,
        hn_url: `https://news.ycombinator.com/item?id=${item.objectID}`,
        points: item.points || 0,
        comments: item.num_comments || 0,
        created_at: item.created_at,
        author: item.author,
        objectID: item.objectID,
      });
    }

    if (allHits.length >= 10) {
      break;
    }
  }

  return dedupeByKey(allHits, "objectID")
    .filter((item) => item.title || item.url)
    .sort((a, b) => {
      const aScore = (a.points || 0) + (a.comments || 0) * 2;
      const bScore = (b.points || 0) + (b.comments || 0) * 2;
      return bScore - aScore;
    })
    .slice(0, 5);
}

function buildHackerNewsQueries(query) {
  const terms = normalizeGenericSearchTerms(query);
  const queries = [];

  const original = terms.slice(0, 6).join(" ");
  if (original) queries.push(original);

  for (let i = 0; i < terms.length - 1; i++) {
    queries.push(`${terms[i]} ${terms[i + 1]}`);
  }

  for (const term of terms) {
    if (term.length >= 3) {
      queries.push(term);
    }
  }

  return [...new Set(queries)].slice(0, 10);
}

function dedupeByKey(items, key) {
  const seen = new Set();
  const result = [];

  for (const item of items) {
    const value = item[key] || item.url || item.title;
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(item);
  }

  return result;
}

function normalizeGenericSearchTerms(query) {
  const stopwords = new Set([
    "or",
    "and",
    "not",
    "with",
    "for",
    "from",
    "the",
    "a",
    "an",
    "of",
    "in",
    "on",
    "to",
    "latest",
    "recent",
    "trend",
    "trends",
    "technology",
    "technologies",
    "tool",
    "tools",
    "service",
    "services",
    "related",
    "관련",
    "최신",
    "트렌드",
  ]);

  return String(query || "")
    .toLowerCase()
    .replace(/["'“”‘’]/g, " ")
    .replace(/[(){}\[\]]/g, " ")
    .replace(/[|]/g, " ")
    .replace(/[:;,!?]/g, " ")
    .replace(/-/g, " ")
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean)
    .filter((term) => !stopwords.has(term))
    .filter((term) => /^[a-z0-9]+$/.test(term))
    .filter((term) => term.length >= 2)
    .filter((term, index, arr) => arr.indexOf(term) === index)
    .slice(0, 12);
}

function getXmlTag(xml, tagName) {
  const match = xml.match(
    new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`)
  );
  return match ? match[1] : "";
}

function cleanXml(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[/g, "")
    .replace(/\]\]>/g, "")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function handleMcp(request, env) {
  const authHeader = request.headers.get("Authorization") || "";
  const xApiKey = request.headers.get("x-api-key") || "";

  if (env.MCP_ACCESS_TOKEN) {
    const expectedBearer = `Bearer ${env.MCP_ACCESS_TOKEN}`;
    const valid =
      authHeader === expectedBearer || xApiKey === env.MCP_ACCESS_TOKEN;

    if (!valid) {
      return mcpJson(
        {
          jsonrpc: "2.0",
          error: { code: -32001, message: "Unauthorized MCP request" },
          id: null,
        },
        401
      );
    }
  }

  if (request.method === "GET") {
    return mcpJson({
      jsonrpc: "2.0",
      result: {
        status: "ok",
        server: "devtrend-mcp-server",
        tools: ["collect_trends", "save_notion_report", "send_email_report"],
        message: "Use POST /mcp with JSON-RPC MCP messages.",
      },
      id: null,
    });
  }

  if (request.method !== "POST") {
    return mcpJson(
      {
        jsonrpc: "2.0",
        error: { code: -32600, message: "Method Not Allowed" },
        id: null,
      },
      405
    );
  }

  const message = await request.json().catch(() => null);

  if (!message) {
    return mcpJson({
      jsonrpc: "2.0",
      error: { code: -32700, message: "Parse error" },
      id: null,
    });
  }

  if (!message.id && message.method?.startsWith("notifications/")) {
    return new Response(null, { status: 202, headers: mcpHeaders() });
  }

  switch (message.method) {
    case "initialize":
      return mcpJson({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: { tools: {} },
          serverInfo: { name: "devtrend-mcp-server", version: "1.1.0" },
        },
      });

    case "tools/list":
      return mcpJson({
        jsonrpc: "2.0",
        id: message.id,
        result: { tools: getMcpTools() },
      });

    case "tools/call":
      return handleMcpToolCall(message, env);

    default:
      return mcpJson({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32601, message: `Method not found: ${message.method}` },
      });
  }
}

function getMcpTools() {
  return [
    {
      name: "collect_trends",
      title: "Collect AI development trends",
      description:
        "Collect AI development trend source data from arXiv, GitHub, and Hacker News APIs. Use this before writing a trend report.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "English AI development trend search query. Example: AI Agent MCP Workflow automation",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
    {
      name: "save_notion_report",
      title: "Save report to Notion",
      description: "Save the final trend briefing report to a Notion database.",
      inputSchema: {
        type: "object",
        properties: {
          topic: {
            type: "string",
            description: "The user's original report topic.",
          },
          report: {
            type: "string",
            description: "The final Korean report body.",
          },
          search_query: {
            type: "string",
            description: "The English query used for API collection.",
          },
          counts: {
            type: "object",
            description: "Optional source counts from collect_trends.",
            properties: {
              arxiv: { type: "integer" },
              github: { type: "integer" },
              hacker_news: { type: "integer" },
            },
            additionalProperties: false,
          },
        },
        required: ["topic", "report"],
        additionalProperties: false,
      },
    },
    {
      name: "send_email_report",
      title: "Send report by email",
      description: "Send the final trend briefing report by email via Resend.",
      inputSchema: {
        type: "object",
        properties: {
          to: {
            type: "string",
            description:
              "Recipient email address. For Resend test mode, use the verified test recipient.",
          },
          subject: {
            type: "string",
            description: "Email subject.",
          },
          report: {
            type: "string",
            description: "The final Korean report body.",
          },
        },
        required: ["subject", "report"],
        additionalProperties: false,
      },
    },
  ];
}

async function handleMcpToolCall(message, env) {
  const toolName = message.params?.name;
  const args = message.params?.arguments || {};

  try {
    switch (toolName) {
      case "collect_trends": {
        const query = String(
          args.query || "AI Agent MCP Workflow automation"
        ).trim();
        const result = await collectTrendsTool(query, env);
        return mcpToolResult(message.id, result);
      }

      case "save_notion_report": {
        const result = await saveReportToNotionFromMcp(
          {
            topic: String(args.topic || "AI trend report").trim(),
            report: String(args.report || "").trim(),
            searchQuery: String(args.search_query || "").trim(),
            counts: args.counts || null,
          },
          env
        );
        return mcpToolResult(message.id, result);
      }

      case "send_email_report": {
        const result = await sendReportEmailFromMcp(
          {
            to: String(args.to || "").trim(),
            subject: String(
              args.subject || "[DevTrend] AI 트렌드 보고서"
            ).trim(),
            report: String(args.report || "").trim(),
          },
          env
        );
        return mcpToolResult(message.id, result);
      }

      default:
        return mcpJson({
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32602, message: `Unknown tool: ${toolName}` },
        });
    }
  } catch (error) {
    return mcpJson({
      jsonrpc: "2.0",
      id: message.id,
      error: {
        code: -32000,
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

function mcpToolResult(id, result) {
  return mcpJson({
    jsonrpc: "2.0",
    id,
    result: {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
    },
  });
}

async function saveReportToNotionFromMcp(
  { topic, report, searchQuery, counts },
  env
) {
  if (!env.NOTION_TOKEN || !env.NOTION_DATABASE_ID) {
    return { ok: false, error: "Missing NOTION_TOKEN or NOTION_DATABASE_ID" };
  }

  if (!report) {
    return { ok: false, error: "report is required" };
  }

  const now = new Date().toISOString();
  const title = `[DevTrend] ${topic || "AI 트렌드 보고서"} - ${now.slice(
    0,
    10
  )}`;

  const properties = {
    Name: {
      title: [{ text: { content: title.slice(0, 180) } }],
    },
    Topic: {
      rich_text: [{ text: { content: String(topic || "").slice(0, 180) } }],
    },
    Date: { date: { start: now } },
  };

  if (counts && Number.isInteger(counts.arxiv)) {
    properties.arXiv = { number: counts.arxiv };
  }
  if (counts && Number.isInteger(counts.github)) {
    properties.GitHub = { number: counts.github };
  }
  if (counts && Number.isInteger(counts.hacker_news)) {
    properties.HackerNews = { number: counts.hacker_news };
  }

  const response = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.NOTION_TOKEN}`,
      "Content-Type": "application/json",
      "Notion-Version": "2022-06-28",
    },
    body: JSON.stringify({
      parent: { database_id: env.NOTION_DATABASE_ID },
      properties,
      children: [
        paragraphBlock(`검색 쿼리: ${searchQuery || "N/A"}`),
        ...reportToNotionBlocks(report),
      ],
    }),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: payload?.message || payload?.error || "Notion API failed",
      details: payload,
    };
  }

  return { ok: true, page_id: payload.id, url: payload.url };
}

function reportToNotionBlocks(report) {
  return String(report || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 95)
    .map((line) => {
      if (/^#+\s/.test(line)) {
        return headingBlock(line.replace(/^#+\s*/, "").slice(0, 180));
      }

      if (/^\d+\.\s/.test(line)) {
        return headingBlock(line.slice(0, 180));
      }

      return paragraphBlock(line.slice(0, 1900));
    });
}

function paragraphBlock(content) {
  return {
    object: "block",
    type: "paragraph",
    paragraph: {
      rich_text: [{ type: "text", text: { content: content || " " } }],
    },
  };
}

function headingBlock(content) {
  return {
    object: "block",
    type: "heading_3",
    heading_3: {
      rich_text: [{ type: "text", text: { content: content || " " } }],
    },
  };
}

async function sendReportEmailFromMcp({ to, subject, report }, env) {
  if (!env.RESEND_API_KEY) {
    return { ok: false, error: "Missing RESEND_API_KEY" };
  }

  if (!report) {
    return { ok: false, error: "report is required" };
  }

  const requestedTo = String(to || "").trim();
  const safeTo = env.EMAIL_TO || requestedTo || "chan924@tukorea.ac.kr";
  const from = env.EMAIL_FROM || "DevTrend <onboarding@resend.dev>";
  const safeSubject = subject || "[DevTrend] AI 트렌드 보고서";

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [safeTo],
      subject: safeSubject,
      text: report,
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6;">
          <h2>${escapeHtml(safeSubject)}</h2>
          <pre style="white-space: pre-wrap; font-family: Arial, sans-serif;">${escapeHtml(
            report
          )}</pre>
        </div>
      `,
    }),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: payload?.message || payload?.error || "Resend API failed",
      requested_to: requestedTo || null,
      sent_to: safeTo,
      details: payload,
    };
  }

  return {
    ok: true,
    id: payload.id,
    requested_to: requestedTo || null,
    sent_to: safeTo,
  };
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
    },
  });
}

function corsResponse() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization, x-api-key, MCP-Protocol-Version, mcp-session-id",
    },
  });
}

function mcpJson(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: mcpHeaders(),
  });
}

function mcpHeaders() {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, x-api-key, MCP-Protocol-Version, mcp-session-id",
    "MCP-Protocol-Version": "2025-03-26",
  };
}
