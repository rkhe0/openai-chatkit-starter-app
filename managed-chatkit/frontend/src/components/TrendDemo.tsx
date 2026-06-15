import { useState } from "react";

type TrendResult = {
  query: string;
  generated_at: string;
  counts: {
    arxiv: number;
    github: number;
    hacker_news: number;
  };
  briefing: string;
};

export function TrendDemo() {
  const [query, setQuery] = useState("AI Agent MCP Workflow automation");
  const [result, setResult] = useState<TrendResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function runTrendBriefing() {
    setLoading(true);
    setError("");
    setResult(null);

    try {
      const response = await fetch("/api/trends", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Trend briefing failed");
      }

      setResult(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section style={{ padding: "24px", maxWidth: "960px", margin: "0 auto" }}>
      <h1>DevTrend Agent</h1>
      <p>
        arXiv, GitHub, Hacker News API를 직접 호출하여 AI 개발 트렌드를 분석합니다.
      </p>

      <div style={{ display: "flex", gap: "8px", marginTop: "16px" }}>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          style={{ flex: 1, padding: "12px" }}
          placeholder="예: AI Agent MCP Workflow automation"
        />
        <button onClick={runTrendBriefing} disabled={loading}>
          {loading ? "분석 중..." : "트렌드 브리핑 생성"}
        </button>
      </div>

      {error && (
        <pre style={{ color: "crimson", whiteSpace: "pre-wrap" }}>{error}</pre>
      )}

      {result && (
        <div style={{ marginTop: "24px" }}>
          <h2>API 수집 결과</h2>
          <ul>
            <li>arXiv: {result.counts.arxiv}건</li>
            <li>GitHub: {result.counts.github}건</li>
            <li>Hacker News: {result.counts.hacker_news}건</li>
          </ul>

          <h2>AI 브리핑</h2>
          <pre
            style={{
              whiteSpace: "pre-wrap",
              background: "#f6f6f6",
              padding: "16px",
              borderRadius: "8px",
            }}
          >
            {result.briefing}
          </pre>
        </div>
      )}
    </section>
  );
}
