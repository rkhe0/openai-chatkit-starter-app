import { useEffect, useState } from "react";

type DailySettings = {
  topic: string;
  email: string;
  enabled: boolean;
  delivery: {
    email: boolean;
    notion: boolean;
  };
  updated_at: string | null;
};

type RunResult = {
  ok: boolean;
  message?: string;
  result?: {
    topic: string;
    generated_at: string;
    counts: {
      arxiv: number;
      github: number;
      hacker_news: number;
    };
    briefing: string;
  };
  notion?: {
    ok?: boolean;
    skipped?: boolean;
    reason?: string;
    url?: string;
    error?: string;
  };
  email?: {
    ok?: boolean;
    skipped?: boolean;
    reason?: string;
    id?: string;
    error?: string;
  };
};

const defaultSettings: DailySettings = {
  topic: "AI Agent MCP Workflow automation",
  email: "",
  enabled: true,
  delivery: {
    email: true,
    notion: true,
  },
  updated_at: null,
};

export function DailyReportSettings() {
  const [settings, setSettings] = useState<DailySettings>(defaultSettings);
  const [draft, setDraft] = useState<DailySettings>(defaultSettings);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [runResult, setRunResult] = useState<RunResult | null>(null);

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/daily-settings");
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "설정을 불러오지 못했습니다.");
      }

      const loaded = {
        ...defaultSettings,
        ...payload.settings,
        delivery: {
          ...defaultSettings.delivery,
          ...(payload.settings?.delivery || {}),
        },
      };

      setSettings(loaded);
      setDraft(loaded);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  async function saveSettings() {
    setLoading(true);
    setStatus("");
    setError("");

    try {
      const response = await fetch("/api/daily-settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          topic: draft.topic,
          email: draft.email,
          enabled: draft.enabled,
          delivery: draft.delivery,
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "설정 저장에 실패했습니다.");
      }

      const saved = {
        ...defaultSettings,
        ...payload.settings,
        delivery: {
          ...defaultSettings.delivery,
          ...(payload.settings?.delivery || {}),
        },
      };

      setSettings(saved);
      setDraft(saved);
      setStatus("저장됨");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  async function runNow() {
    setRunning(true);
    setStatus("");
    setError("");
    setRunResult(null);

    try {
      const response = await fetch("/api/daily-run-now", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          topic: draft.topic,
          email: draft.email,
          delivery: draft.delivery,
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "보고서 작성에 실패했습니다.");
      }

      setRunResult(payload);
      setStatus("보고서 작성 완료");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="mx-auto w-full max-w-5xl px-6 py-8">
      <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-6 text-neutral-100 shadow-lg">
        <div className="mb-5 flex flex-col gap-2">
          <p className="text-sm text-neutral-400">Daily Report Settings</p>
          <h1 className="text-2xl font-semibold">일일 AI 개발 트렌드 보고서</h1>
          <p className="text-sm text-neutral-400">
            매일 조사할 주제를 저장하고, 필요하면 즉시 보고서를 생성합니다.
          </p>
        </div>

        <div className="mb-5 rounded-xl bg-neutral-900 p-4">
          <p className="text-sm text-neutral-400">현재 저장된 주제</p>
          <p className="mt-1 text-lg font-medium">
            {settings.topic || "저장된 주제 없음"}
          </p>
          {settings.updated_at && (
            <p className="mt-1 text-xs text-neutral-500">
              마지막 수정: {settings.updated_at}
            </p>
          )}
        </div>

        <div className="grid gap-4">
          <label className="grid gap-2">
            <span className="text-sm text-neutral-300">보고서 주제</span>
            <input
              value={draft.topic}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  topic: event.target.value,
                }))
              }
              className="rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-3 text-neutral-100 outline-none focus:border-neutral-400"
              placeholder="예: 최신 AI 이미지 생성 툴 트렌드"
            />
          </label>

          <label className="grid gap-2">
            <span className="text-sm text-neutral-300">이메일 수신 주소</span>
            <input
              value={draft.email}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  email: event.target.value,
                }))
              }
              className="rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-3 text-neutral-100 outline-none focus:border-neutral-400"
              placeholder="example@gmail.com"
            />
          </label>

          <div className="flex flex-wrap gap-4 text-sm text-neutral-300">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(event) =>
                  setDraft((prev) => ({
                    ...prev,
                    enabled: event.target.checked,
                  }))
                }
              />
              매일 자동 작성 활성화
            </label>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={draft.delivery.email}
                onChange={(event) =>
                  setDraft((prev) => ({
                    ...prev,
                    delivery: {
                      ...prev.delivery,
                      email: event.target.checked,
                    },
                  }))
                }
              />
              이메일 발송
            </label>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={draft.delivery.notion}
                onChange={(event) =>
                  setDraft((prev) => ({
                    ...prev,
                    delivery: {
                      ...prev.delivery,
                      notion: event.target.checked,
                    },
                  }))
                }
              />
              Notion 저장
            </label>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={saveSettings}
              disabled={loading || !draft.topic.trim()}
              className="rounded-xl bg-white px-5 py-3 font-medium text-black disabled:opacity-50"
            >
              {loading ? "저장 중..." : "설정 저장"}
            </button>

            <button
              type="button"
              onClick={runNow}
              disabled={running || !draft.topic.trim()}
              className="rounded-xl border border-neutral-600 px-5 py-3 font-medium text-neutral-100 disabled:opacity-50"
            >
              {running ? "보고서 작성 중..." : "지금 보고서 작성"}
            </button>

            <button
              type="button"
              onClick={loadSettings}
              disabled={loading}
              className="rounded-xl border border-neutral-800 px-5 py-3 text-neutral-300 disabled:opacity-50"
            >
              새로고침
            </button>
          </div>

          {status && <p className="text-sm text-green-400">{status}</p>}
          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>

        {runResult?.result && (
          <div className="mt-6 rounded-xl bg-neutral-900 p-4">
            <h2 className="mb-3 text-lg font-semibold">최근 생성 결과</h2>

            <div className="mb-4 grid gap-2 text-sm text-neutral-300">
              <p>주제: {runResult.result.topic}</p>
              <p>생성 시각: {runResult.result.generated_at}</p>
              <p>
                API 수집 결과: arXiv {runResult.result.counts.arxiv}건 / GitHub{" "}
                {runResult.result.counts.github}건 / Hacker News{" "}
                {runResult.result.counts.hacker_news}건
              </p>
              <p>
                Notion:{" "}
                {runResult.notion?.ok
                  ? "저장 성공"
                  : runResult.notion?.skipped
                    ? "건너뜀"
                    : "실패"}
              </p>
              <p>
                Email:{" "}
                {runResult.email?.ok
                  ? "발송 성공"
                  : runResult.email?.skipped
                    ? "건너뜀"
                    : "실패"}
              </p>
              {runResult.notion?.url && (
                <a
                  href={runResult.notion.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-400 underline"
                >
                  Notion 페이지 열기
                </a>
              )}
            </div>

            <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap rounded-xl bg-white p-4 text-sm text-neutral-900">
              {runResult.result.briefing}
            </pre>
          </div>
        )}
      </div>
    </section>
  );
}
