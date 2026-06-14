export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/create-session") {
      return handleCreateSession(request, env);
    }

    if (url.pathname === "/api/trends") {
      return handleTrends(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};

async function handleCreateSession(request, env) {
  if (request.method === "GET") {
    return json({ ok: true, message: "Use POST /api/create-session" }, 200);
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
}

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

  const [arxiv, github, hn] = await Promise.allSettled([
    searchArxiv(query),
    searchGithub(query, env),
    searchHackerNews(query),
  ]);

  const sources = {
    arxiv: arxiv.status === "fulfilled" ? arxiv.value : [],
    github: github.status === "fulfilled" ? github.value : [],
    hacker_news: hn.status === "fulfilled" ? hn.value : [],
  };

  const sourceErrors = {
    arxiv: arxiv.status === "rejected" ? String(arxiv.reason) : null,
    github: github.status === "rejected" ? String(github.reason) : null,
    hacker_news: hn.status === "rejected" ? String(hn.reason) : null,
  };

  const briefing = await createBriefing(query, sources, env);

  return json({
    query,
    generated_at: new Date().toISOString(),
    counts: {
      arxiv: sources.arxiv.length,
      github: sources.github.length,
      hacker_news: sources.hacker_news.length,
    },
    source_errors: sourceErrors,
    sources,
    briefing,
  });
}

async function searchArxiv(query) {
  const terms = query
    .split(/\s+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 6);

  const searchQuery =
    terms.map((term) => `all:${term}`).join(" AND ") +
    " AND (cat:cs.AI OR cat:cs.LG OR cat:cs.CL OR cat:cs.CV)";

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

  return entries.map((entry) => ({
    source: "arXiv",
    title: cleanXml(getXmlTag(entry, "title")),
    summary: cleanXml(getXmlTag(entry, "summary")).slice(0, 600),
    url: cleanXml(getXmlTag(entry, "id")),
    published: cleanXml(getXmlTag(entry, "published")),
    authors: [...entry.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>\s*<\/author>/g)]
      .map((m) => cleanXml(m[1]))
      .slice(0, 5),
  }));
}

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
    throw new Error(`GitHub API failed: ${response.status}`);
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
  }));
}

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
    url: item.url || item.story_url || `https://news.ycombinator.com/item?id=${item.objectID}`,
    hn_url: `https://news.ycombinator.com/item?id=${item.objectID}`,
    points: item.points || 0,
    comments: item.num_comments || 0,
    created_at: item.created_at,
  }));
}

async function createBriefing(query, sources, env) {
  const model = env.OPENAI_MODEL || "gpt-4o-mini";

  const prompt = `
사용자 관심 주제: ${query}

아래는 실제 API로 수집한 데이터입니다.

[arXiv 논문 데이터]
${JSON.stringify(sources.arxiv, null, 2)}

[GitHub 저장소 데이터]
${JSON.stringify(sources.github, null, 2)}

[Hacker News 게시글 데이터]
${JSON.stringify(sources.hacker_news, null, 2)}

위 데이터를 바탕으로 한국어 AI 개발 트렌드 브리핑을 작성하세요.

반드시 아래 형식을 지키세요.

[AI 개발 트렌드 브리핑]

1. 입력 주제
2. 데이터 수집 결과
   - arXiv:
   - GitHub:
   - Hacker News:
3. 오늘의 핵심 요약
4. Top 5 트렌드
   - 트렌드명:
   - 설명:
   - 확인된 출처:
   - 중요도: 높음/중간/낮음
   - 개발자 관점의 의미:
5. 출처별 분석
   - arXiv:
   - GitHub:
   - Hacker News:
6. 개발자 추천 액션
7. 발표용 5줄 요약

주의:
- 제공된 데이터에 없는 사실을 단정하지 마세요.
- URL이 있는 항목은 근거 링크를 포함하세요.
- arXiv는 연구 트렌드, GitHub는 구현 트렌드, Hacker News는 개발자 반응으로 해석하세요.
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
      }
      if (content.text) {
        chunks.push(content.text);
      }
    }
  }

  return chunks.join("\n").trim() || JSON.stringify(data, null, 2);
}

function getXmlTag(xml, tagName) {
  const match = xml.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`));
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
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
