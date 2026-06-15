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
        time: new Date().toISOString(),
      });
    }

    if (url.pathname === "/api/create-session") {
      return handleCreateSession(request, env);
    }

    if (url.pathname === "/api/collect-trends") {
      return handleCollectTrends(request, env);
    }

    if (url.pathname === "/api/trends") {
      return handleTrends(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};

/**
 * 1. ChatKit session 생성
 * ChatKit 앱이 /api/create-session을 호출하면,
 * Worker가 OpenAI API key를 이용해 client_secret을 발급합니다.
 */
async function handleCreateSession(request, env) {
  if (request.method === "GET") {
    return json({
      ok: true,
      message: "Use POST /api/create-session",
    });
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
      user: "demo-user",
      workflow: {
        id: workflowId,
      },
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
 * 2. collect_trends 도구용 endpoint
 * Agent Builder에서 tool로 연결하기 좋은 endpoint입니다.
 * OpenAI 요약은 하지 않고, 원천 API 수집 결과만 반환합니다.
 */
async function handleCollectTrends(request, env) {
  if (request.method === "GET") {
    return json({
      ok: true,
      message: "Use POST /api/collect-trends",
      sample_body: {
        query: "AI Agent MCP Workflow automation",
      },
    });
  }

  if (request.method !== "POST") {
    return json({ error: "Method Not Allowed" }, 405);
  }

  const body = await request.json().catch(() => ({}));
  const query = String(body.query || "AI Agent MCP Workflow automation").trim();

  const collected = await collectTrendSources(query, env);

  return json({
    tool_name: "collect_trends",
    query,
    generated_at: new Date().toISOString(),
    api_evidence: getApiEvidence(),
    counts: collected.counts,
    source_errors: collected.source_errors,
    sources: collected.sources,
  });
}

/**
 * 3. /api/trends
 * 직접 API 수집 + OpenAI 브리핑 생성까지 한 번에 수행합니다.
 * 앱 화면 데모용으로 쓰기 좋습니다.
 */
async function handleTrends(request, env) {
  if (request.method === "GET") {
    return json({
      ok: true,
      message: "Use POST /api/trends",
      sample_body: {
        query: "AI Agent MCP Workflow automation",
      },
    });
  }

  if (request.method !== "POST") {
    return json({ error: "Method Not Allowed" }, 405);
  }

  if (!env.OPENAI_API_KEY) {
    return json({ error: "Missing OPENAI_API_KEY" }, 500);
  }

  const body = await request.json().catch(() => ({}));
  const query = String(body.query || "AI Agent MCP Workflow automation").trim();

  const collected = await collectTrendSources(query, env);
  const briefing = await createBriefing(query, collected.sources, env);

  return json({
    query,
    generated_at: new Date().toISOString(),
    api_evidence: getApiEvidence(),
    counts: collected.counts,
    source_errors: collected.source_errors,
    sources: collected.sources,
    briefing,
  });
}

/**
 * arXiv / GitHub / Hacker News API를 병렬 호출합니다.
 */
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

  return {
    sources,
    source_errors,
    counts,
  };
}

/**
 * API endpoint 증거.
 * 발표 화면과 원본 JSON에 그대로 표시됩니다.
 */
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

/**
 * arXiv API 호출
 */
async function searchArxiv(query) {
  const terms = query
    .split(/\s+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 6);

  const termQueries = terms.map((term) => `all:${escapeArxivTerm(term)}`);

  const searchQuery = `(${termQueries.join(
    " OR "
  )}) AND (cat:cs.AI OR cat:cs.LG OR cat:cs.CL OR cat:cs.CV OR cat:cs.SE)`;

  const params = new URLSearchParams({
    search_query: searchQuery,
    start: "0",
    max_results: "5",
    sortBy: "submittedDate",
    sortOrder: "descending",
  });

  const response = await fetch(`https://export.arxiv.org/api/query?${params}`, {
    headers: {
      "User-Agent": "DevTrendAgent/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(`arXiv API failed: ${response.status}`);
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

/**
 * GitHub REST API 호출
 * GITHUB_TOKEN은 선택 사항입니다.
 * 없으면 rate limit이 낮을 수 있습니다.
 */
async function searchGithub(query, env) {
  const params = new URLSearchParams({
    q: `${query} in:name,description,readme`,
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

/**
 * Hacker News Algolia API 호출
 */
async function searchHackerNews(query) {
  const params = new URLSearchParams({
    query,
    tags: "story",
    hitsPerPage: "5",
  });

  const response = await fetch(
    `https://hn.algolia.com/api/v1/search_by_date?${params}`,
    {
      headers: {
        "User-Agent": "DevTrendAgent/1.0",
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Hacker News API failed: ${response.status}`);
  }

  const data = await response.json();

  return (data.hits || []).slice(0, 5).map((item) => ({
    source: "Hacker News",
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
  }));
}

/**
 * OpenAI Responses API로 브리핑 생성
 */
async function createBriefing(query, sources, env) {
  const model = env.OPENAI_MODEL || "gpt-4o-mini";

  const prompt = `
사용자 관심 주제:
${query}

아래 데이터는 Cloudflare Worker가 실제 외부 API를 직접 호출해서 수집한 원천 데이터입니다.

[arXiv 논문 데이터]
${JSON.stringify(sources.arxiv, null, 2)}

[GitHub 저장소 데이터]
${JSON.stringify(sources.github, null, 2)}

[Hacker News 게시글 데이터]
${JSON.stringify(sources.hacker_news, null, 2)}

위 데이터를 근거로 한국어 AI 개발 트렌드 브리핑을 작성하세요.

반드시 아래 형식을 지키세요.

[AI 개발 트렌드 브리핑]

1. 입력 주제

2. API 수집 결과
   - arXiv:
   - GitHub:
   - Hacker News:

3. 실제 호출 API
   - arXiv: https://export.arxiv.org/api/query
   - GitHub: https://api.github.com/search/repositories
   - Hacker News: https://hn.algolia.com/api/v1/search_by_date

4. 오늘의 핵심 요약

5. Top 5 트렌드
   - 트렌드명:
   - 설명:
   - 확인된 출처:
   - 중요도: 높음/중간/낮음
   - 개발자 관점의 의미:

6. 출처별 분석
   - arXiv:
   - GitHub:
   - Hacker News:

7. 개발자 추천 액션

8. 발표용 5줄 요약

주의:
- 제공된 원천 데이터에 없는 사실은 단정하지 마세요.
- 각 트렌드는 어떤 API 결과를 근거로 했는지 표시하세요.
- arXiv는 연구 트렌드, GitHub는 구현 트렌드, Hacker News는 개발자 반응으로 해석하세요.
- URL이 있는 항목은 근거 링크를 포함하세요.
`;

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content:
            "당신은 AI 개발 트렌드 분석 Agent입니다. 실제 API 수집 결과를 근거로만 분석하고, 과장하지 않습니다.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    return `OpenAI briefing generation failed: ${
      data?.error?.message || response.status
    }`;
  }

  return extractOutputText(data);
}

function extractOutputText(data) {
  if (typeof data.output_text === "string") {
    return data.output_text;
  }

  const chunks = [];

  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) {
        chunks.push(content.text);
      } else if (content.text) {
        chunks.push(content.text);
      }
    }
  }

  return chunks.join("\n").trim() || JSON.stringify(data, null, 2);
}

function escapeArxivTerm(term) {
  return String(term || "")
    .replace(/[()"]/g, "")
    .trim();
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

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

function corsResponse() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

async function handleMcp(request, env) {
  const authHeader = request.headers.get("Authorization") || "";
  const xApiKey = request.headers.get("x-api-key") || "";

  if (env.MCP_ACCESS_TOKEN) {
    const expectedBearer = `Bearer ${env.MCP_ACCESS_TOKEN}`;
    const valid =
      authHeader === expectedBearer ||
      xApiKey === env.MCP_ACCESS_TOKEN;

    if (!valid) {
      return mcpJson(
        {
          jsonrpc: "2.0",
          error: {
            code: -32001,
            message: "Unauthorized MCP request",
          },
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
        message: "Use POST /mcp with JSON-RPC MCP messages.",
      },
      id: null,
    });
  }

  if (request.method !== "POST") {
    return mcpJson(
      {
        jsonrpc: "2.0",
        error: {
          code: -32600,
          message: "Method Not Allowed",
        },
        id: null,
      },
      405
    );
  }

  const message = await request.json().catch(() => null);

  if (!message) {
    return mcpJson({
      jsonrpc: "2.0",
      error: {
        code: -32700,
        message: "Parse error",
      },
      id: null,
    });
  }

  // MCP notifications, such as notifications/initialized, do not require a response.
  if (!message.id && message.method?.startsWith("notifications/")) {
    return new Response(null, {
      status: 202,
      headers: mcpHeaders(),
    });
  }

  switch (message.method) {
    case "initialize":
      return mcpJson({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: "devtrend-mcp-server",
            version: "1.0.0",
          },
        },
      });

    case "tools/list":
      return mcpJson({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          tools: [
            {
              name: "collect_trends",
              title: "Collect AI development trends",
              description:
                "Collects AI development trend source data from arXiv, GitHub, and Hacker News APIs. Use this before writing an AI development trend briefing.",
              inputSchema: {
                type: "object",
                properties: {
                  query: {
                    type: "string",
                    description:
                      "AI development trend search query. Example: AI Agent MCP Workflow automation",
                  },
                },
                required: ["query"],
              },
            },
          ],
        },
      });

    case "tools/call":
      return handleMcpToolCall(message, env);

    default:
      return mcpJson({
        jsonrpc: "2.0",
        id: message.id,
        error: {
          code: -32601,
          message: `Method not found: ${message.method}`,
        },
      });
  }
}

async function handleMcpToolCall(message, env) {
  const toolName = message.params?.name;
  const args = message.params?.arguments || {};

  if (toolName !== "collect_trends") {
    return mcpJson({
      jsonrpc: "2.0",
      id: message.id,
      error: {
        code: -32602,
        message: `Unknown tool: ${toolName}`,
      },
    });
  }

  const query = String(args.query || "AI Agent MCP Workflow automation").trim();

  const collected = await collectTrendSources(query, env);

  const result = {
    tool_name: "collect_trends",
    query,
    generated_at: new Date().toISOString(),
    api_evidence: getApiEvidence(),
    counts: collected.counts,
    source_errors: collected.source_errors,
    sources: collected.sources,
  };

  return mcpJson({
    jsonrpc: "2.0",
    id: message.id,
    result: {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
      structuredContent: result,
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
      "Content-Type, Authorization, MCP-Protocol-Version, mcp-session-id",
    "MCP-Protocol-Version": "2025-03-26",
  };
}
