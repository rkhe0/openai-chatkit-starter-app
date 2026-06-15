import { useEffect, useState } from "react";

type ReportSettings = {
  topic: string;
  enabled: boolean;
  updated_at: string | null;
};

export function ReportSettingsPanel() {
  const [topic, setTopic] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  useEffect(() => {
    async function loadSettings() {
      try {
        const response = await fetch("/api/report-settings");
        const data = await response.json();

        if (data.ok && data.settings) {
          const settings = data.settings as ReportSettings;
          setTopic(settings.topic || "");
          setEnabled(settings.enabled ?? true);
          setUpdatedAt(settings.updated_at || null);
        }
      } catch {
        setStatus("설정을 불러오지 못했습니다.");
      }
    }

    loadSettings();
  }, []);

  async function saveSettings() {
    setStatus("");

    const trimmedTopic = topic.trim();

    if (!trimmedTopic) {
      setStatus("주제를 입력하세요.");
      return;
    }

    try {
      const response = await fetch("/api/report-settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          topic: trimmedTopic,
          enabled,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.ok) {
        setStatus(data.error || "저장 실패");
        return;
      }

      setUpdatedAt(data.settings.updated_at);
      setStatus("저장되었습니다. 다음 GitHub Actions 실행부터 이 주제로 발송됩니다.");
    } catch {
      setStatus("저장 중 오류가 발생했습니다.");
    }
  }

  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-950 p-6 text-white">
      <p className="text-sm text-neutral-400">Daily Report Settings</p>

      <h2 className="mt-2 text-2xl font-semibold">
        매일 받을 트렌드 주제 설정
      </h2>

      <p className="mt-2 text-sm text-neutral-400">
        저장된 주제는 Cloudflare KV에 보관되고, GitHub Actions가 매일 실행될 때
        이 값을 읽어 Agent Builder workflow에 전달합니다.
      </p>

      <div className="mt-5 space-y-3">
        <label className="block text-sm font-medium text-neutral-300">
          보고서 주제
        </label>

        <input
          value={topic}
          onChange={(event) => setTopic(event.target.value)}
          placeholder="예: 최신 AI 이미지 생성 툴 트렌드"
          className="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-3 text-white outline-none focus:border-neutral-400"
        />

        <label className="flex items-center gap-2 text-sm text-neutral-300">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
          />
          매일 자동 발송 활성화
        </label>

        <button
          onClick={saveSettings}
          className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black"
        >
          설정 저장
        </button>

        {status && <p className="text-sm text-neutral-300">{status}</p>}

        {updatedAt && (
          <p className="text-xs text-neutral-500">
            마지막 저장 시각: {updatedAt}
          </p>
        )}
      </div>
    </section>
  );
}
