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

    if (url.pathname === "/api/daily-briefing") {
      return handleDailyBriefing(request, env);
    }
    if (url.pathname === "/api/daily-settings") {
      return handleDailySettings(request, env);
    }
    if (url.pathname === "/api/daily-run-now") {
      return handleDailyRunNow(request, env);
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
  const safeTerms = normalizeSearchTerms(query).slice(0, 6);

  if (safeTerms.length === 0) {
    return [];
  }

  const textQuery = safeTerms
    .map((term) => `all:${term}`)
    .join("+OR+");

  const categoryQuery = [
    "cat:cs.AI",
    "cat:cs.LG",
    "cat:cs.CL",
    "cat:cs.CV",
    "cat:cs.SE",
  ].join("+OR+");

  const searchQuery = `(${textQuery})+AND+(${categoryQuery})`;

  const url =
    `https://export.arxiv.org/api/query?` +
    `search_query=${searchQuery}` +
    `&start=0` +
    `&max_results=5` +
    `&sortBy=submittedDate` +
    `&sortOrder=descending`;

  const response = await fetch(url, {
    headers: {
      "User-Agent": "DevTrendAgent/1.0",
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`arXiv API failed: ${response.status} ${text.slice(0, 200)}`);
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

  const deduped = dedupeByKey(allHits, "objectID");

  return deduped
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
    return `OpenAI briefing generation failed: ${data?.error?.message || response.status
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
            {
              name: "save_notion_report",
              title: "Save report to Notion",
              description: "Save the final trend briefing report to a Notion database.",
              inputSchema: {
                type: "object",
                properties: {
                  topic: {
                    type: "string",
                    description: "The user's original report topic"
                  },
                  report: {
                    type: "string",
                    description: "The final Korean report body"
                  },
                  search_query: {
                    type: "string",
                    description: "English query used for API collection"
                  }
                },
                required: ["topic", "report"]
              }
            },
            {
              name: "send_email_report",
              title: "Send report by email",
              description: "Send the final trend briefing report by email.",
              inputSchema: {
                type: "object",
                properties: {
                  to: {
                    type: "string",
                    description: "Recipient email address"
                  },
                  subject: {
                    type: "string",
                    description: "Email subject"
                  },
                  report: {
                    type: "string",
                    description: "The final Korean report body"
                  }
                },
                required: ["to", "subject", "report"]
              }
            }
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

function normalizeSearchTerms(query) {
  const stopwords = new Set([
    "or",
    "and",
    "the",
    "a",
    "an",
    "latest",
    "trend",
    "trends",
    "tool",
    "tools",
  ]);

  const phraseMap = [
    ["ai image generation", "image_generation"],
    ["image generation", "image_generation"],
    ["text to image", "text_to_image"],
    ["text-to-image", "text_to_image"],
    ["generative ai", "generative_ai"],
    ["diffusion model", "diffusion"],
    ["diffusion models", "diffusion"],
    ["image editing", "image_editing"],
    ["ai agent", "agent"],
    ["workflow automation", "workflow"],
  ];

  let normalized = String(query || "").toLowerCase();

  normalized = normalized
    .replace(/["'“”‘’]/g, " ")
    .replace(/[()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const terms = [];

  for (const [phrase, replacement] of phraseMap) {
    if (normalized.includes(phrase)) {
      terms.push(replacement);
      normalized = normalized.replaceAll(phrase, " ");
    }
  }

  normalized
    .split(/[^a-z0-9_]+/i)
    .map((x) => x.trim())
    .filter(Boolean)
    .forEach((term) => {
      if (!stopwords.has(term) && term.length >= 2) {
        terms.push(term);
      }
    });

  return [...new Set(terms)].slice(0, 8);
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
async function handleDailyBriefing(request, env) {
  const url = new URL(request.url);

  const tokenFromQuery = url.searchParams.get("token");
  const tokenFromHeader = request.headers.get("x-daily-secret");

  if (env.DAILY_SECRET) {
    const valid =
      tokenFromQuery === env.DAILY_SECRET ||
      tokenFromHeader === env.DAILY_SECRET;

    if (!valid) {
      return json({ error: "Unauthorized daily briefing request" }, 401);
    }
  }

  let body = {};
  if (request.method === "POST") {
    body = await request.json().catch(() => ({}));
  }

  const settings = await getDailySettings(env);

  if (!settings.enabled && !body.force) {
    return json({
      ok: false,
      skipped: true,
      reason: "Daily briefing is disabled by user setting",
    });
  }

  const topic =
    body.topic ||
    url.searchParams.get("topic") ||
    settings.topic ||
    env.DAILY_TOPIC ||
    "AI Agent MCP Workflow automation";

  const emailTo =
    body.email ||
    settings.email ||
    env.EMAIL_TO;

  const collected = await collectTrendSources(topic, env);
  const briefing = await createBriefing(topic, collected.sources, env);

  const result = {
    topic,
    generated_at: new Date().toISOString(),
    counts: collected.counts,
    source_errors: collected.source_errors,
    api_evidence: getApiEvidence(),
    briefing,
  };

  const notionResult = settings.delivery?.notion
    ? await saveBriefingToNotion(result, env)
    : {
      ok: false,
      skipped: true,
      reason: "Notion delivery disabled",
    };

  const emailResult = settings.delivery?.email
    ? await sendBriefingEmail(result, emailTo, env)
    : {
      ok: false,
      skipped: true,
      reason: "Email delivery disabled",
    };

  return json({
    ok: true,
    message: "Daily briefing generated and delivered",
    topic,
    counts: collected.counts,
    notion: notionResult,
    email: emailResult,
  });
}

async function saveBriefingToNotion(result, env) {
  if (!env.NOTION_TOKEN || !env.NOTION_DATABASE_ID) {
    return {
      ok: false,
      skipped: true,
      reason: "Missing NOTION_TOKEN or NOTION_DATABASE_ID",
    };
  }

  const title = `[DevTrend] ${result.topic} - ${formatDateForTitle(
    result.generated_at
  )}`;

  const response = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.NOTION_TOKEN}`,
      "Content-Type": "application/json",
      "Notion-Version": "2022-06-28",
    },
    body: JSON.stringify({
      parent: {
        database_id: env.NOTION_DATABASE_ID,
      },
      properties: {
        Name: {
          title: [
            {
              text: {
                content: title,
              },
            },
          ],
        },
        Topic: {
          rich_text: [
            {
              text: {
                content: result.topic,
              },
            },
          ],
        },
        Date: {
          date: {
            start: result.generated_at,
          },
        },
        arXiv: {
          number: result.counts?.arxiv || 0,
        },
        GitHub: {
          number: result.counts?.github || 0,
        },
        HackerNews: {
          number: result.counts?.hacker_news || 0,
        },
      },
      children: notionBlocksFromBriefing(result),
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

  return {
    ok: true,
    page_id: payload.id,
    url: payload.url,
  };
}

function notionBlocksFromBriefing(result) {
  const lines = String(result.briefing || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 80);

  const blocks = [
    {
      object: "block",
      type: "heading_2",
      heading_2: {
        rich_text: [
          {
            type: "text",
            text: {
              content: "API 수집 결과",
            },
          },
        ],
      },
    },
    paragraphBlock(
      `arXiv: ${result.counts?.arxiv || 0}건 / GitHub: ${result.counts?.github || 0
      }건 / Hacker News: ${result.counts?.hacker_news || 0}건`
    ),
    paragraphBlock(`생성 시각: ${result.generated_at}`),
    {
      object: "block",
      type: "heading_2",
      heading_2: {
        rich_text: [
          {
            type: "text",
            text: {
              content: "AI 브리핑",
            },
          },
        ],
      },
    },
  ];

  for (const line of lines) {
    if (line.startsWith("#")) {
      blocks.push(headingBlock(line.replace(/^#+\s*/, "").slice(0, 180)));
    } else {
      blocks.push(paragraphBlock(line.slice(0, 1900)));
    }
  }

  return blocks;
}

function paragraphBlock(content) {
  return {
    object: "block",
    type: "paragraph",
    paragraph: {
      rich_text: [
        {
          type: "text",
          text: {
            content: content || " ",
          },
        },
      ],
    },
  };
}

function headingBlock(content) {
  return {
    object: "block",
    type: "heading_3",
    heading_3: {
      rich_text: [
        {
          type: "text",
          text: {
            content: content || " ",
          },
        },
      ],
    },
  };
}

async function sendBriefingEmail(result, emailTo, env) {
  if (!env.RESEND_API_KEY) {
    return {
      ok: false,
      skipped: true,
      reason: "Missing RESEND_API_KEY",
    };
  }

  if (!emailTo) {
    return {
      ok: false,
      skipped: true,
      reason: "Missing EMAIL_TO",
    };
  }

  const from = env.EMAIL_FROM || "DevTrend <onboarding@resend.dev>";

  const subject = `[DevTrend] ${result.topic} 브리핑 - ${formatDateForTitle(
    result.generated_at
  )}`;

  const text = `
[DevTrend 일일 AI 개발 트렌드 브리핑]

주제: ${result.topic}
생성 시각: ${result.generated_at}

API 수집 결과
- arXiv: ${result.counts?.arxiv || 0}건
- GitHub: ${result.counts?.github || 0}건
- Hacker News: ${result.counts?.hacker_news || 0}건

${result.briefing}
`.trim();

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6;">
      <h2>DevTrend 일일 AI 개발 트렌드 브리핑</h2>
      <p><b>주제:</b> ${escapeHtml(result.topic)}</p>
      <p><b>생성 시각:</b> ${escapeHtml(result.generated_at)}</p>
      <h3>API 수집 결과</h3>
      <ul>
        <li>arXiv: ${result.counts?.arxiv || 0}건</li>
        <li>GitHub: ${result.counts?.github || 0}건</li>
        <li>Hacker News: ${result.counts?.hacker_news || 0}건</li>
      </ul>
      <h3>브리핑</h3>
      <pre style="white-space: pre-wrap; font-family: Arial, sans-serif;">${escapeHtml(
    result.briefing
  )}</pre>
    </div>
  `;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [emailTo],
      subject,
      text,
      html,
    }),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: payload?.message || payload?.error || "Resend API failed",
      details: payload,
    };
  }

  return {
    ok: true,
    id: payload.id,
  };
}

function formatDateForTitle(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
const DAILY_SETTINGS_KEY = "daily_settings:v1";

async function handleDailySettings(request, env) {
  if (!env.DEVTREND_KV) {
    return json(
      {
        error: "Missing DEVTREND_KV binding",
        message: "Cloudflare Pages에 DEVTREND_KV binding을 추가해야 합니다.",
      },
      500
    );
  }

  if (request.method === "GET") {
    const settings = await getDailySettings(env);
    return json({
      ok: true,
      settings: publicDailySettings(settings),
    });
  }

  if (request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const previous = await getDailySettings(env);

    const topic = String(body.topic || previous.topic || "").trim();
    const email = String(body.email || previous.email || "").trim();

    if (!topic) {
      return json({ error: "topic is required" }, 400);
    }

    if (topic.length > 200) {
      return json({ error: "topic is too long" }, 400);
    }

    const settings = {
      topic,
      email,
      enabled:
        typeof body.enabled === "boolean"
          ? body.enabled
          : previous.enabled ?? true,
      delivery: {
        email:
          typeof body.delivery?.email === "boolean"
            ? body.delivery.email
            : previous.delivery?.email ?? true,
        notion:
          typeof body.delivery?.notion === "boolean"
            ? body.delivery.notion
            : previous.delivery?.notion ?? true,
      },
      updated_at: new Date().toISOString(),
    };

    await env.DEVTREND_KV.put(
      DAILY_SETTINGS_KEY,
      JSON.stringify(settings)
    );

    return json({
      ok: true,
      message: "Daily briefing settings saved",
      settings: publicDailySettings(settings),
    });
  }

  return json({ error: "Method not allowed" }, 405);
}

async function handleDailyRunNow(request, env) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const body = await request.json().catch(() => ({}));
  const settings = await getDailySettings(env);

  const topic = String(body.topic || settings.topic || "").trim();
  const emailTo = String(body.email || settings.email || env.EMAIL_TO || "").trim();

  if (!topic) {
    return json({ error: "No daily report topic configured" }, 400);
  }

  const delivery = {
    email:
      typeof body.delivery?.email === "boolean"
        ? body.delivery.email
        : settings.delivery?.email ?? true,
    notion:
      typeof body.delivery?.notion === "boolean"
        ? body.delivery.notion
        : settings.delivery?.notion ?? true,
  };

  const collected = await collectTrendSources(topic, env);
  const briefing = await createBriefing(topic, collected.sources, env);

  const result = {
    topic,
    generated_at: new Date().toISOString(),
    counts: collected.counts,
    source_errors: collected.source_errors,
    api_evidence: getApiEvidence(),
    briefing,
  };

  const notion = delivery.notion
    ? await saveBriefingToNotion(result, env)
    : {
      ok: false,
      skipped: true,
      reason: "Notion delivery disabled",
    };

  const email = delivery.email
    ? await sendBriefingEmail(result, emailTo, env)
    : {
      ok: false,
      skipped: true,
      reason: "Email delivery disabled",
    };

  return json({
    ok: true,
    message: "Daily report generated manually",
    result,
    notion,
    email,
  });
}

async function getDailySettings(env) {
  const defaults = {
    topic: env.DAILY_TOPIC || "AI Agent MCP Workflow automation",
    email: env.EMAIL_TO || "",
    enabled: true,
    delivery: {
      email: true,
      notion: true,
    },
    updated_at: null,
  };

  if (!env.DEVTREND_KV) {
    return defaults;
  }

  const saved = await env.DEVTREND_KV.get(
    DAILY_SETTINGS_KEY,
    "json"
  ).catch(() => null);

  return {
    ...defaults,
    ...(saved || {}),
    delivery: {
      ...defaults.delivery,
      ...(saved?.delivery || {}),
    },
  };
}

function publicDailySettings(settings) {
  return {
    topic: settings.topic,
    email: settings.email,
    enabled: settings.enabled,
    delivery: settings.delivery,
    updated_at: settings.updated_at,
  };
}
