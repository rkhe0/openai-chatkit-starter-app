import { ChatKitPanel } from "./components/ChatKitPanel";
import { ReportSettingsPanel } from "./components/ReportSettingsPanel";

export default function App() {
  return (
    <main className="min-h-screen bg-black text-white">
      <section className="mx-auto w-full max-w-5xl px-6 py-8">
        <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-6 shadow-lg">
          <p className="text-sm text-neutral-400">DevTrend Agent</p>

          <h1 className="mt-2 text-3xl font-bold">
            AI 개발 트렌드 브리핑 앱
          </h1>

          <p className="mt-3 text-neutral-300">
            Agent Builder Workflow와 MCP 서버를 사용하여 arXiv, GitHub,
            Hacker News API를 호출하고, 최종 보고서를 Notion과 Email로 전송합니다.
          </p>

          <div className="mt-6 rounded-xl bg-neutral-900 p-4">
            <p className="mb-2 text-sm font-semibold text-neutral-300">
              사용 방법
            </p>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-neutral-400">
              <li>아래에서 매일 받을 보고서 주제를 저장합니다.</li>
              <li>GitHub Actions가 매일 저장된 주제를 읽어 자동 실행합니다.</li>
              <li>즉시 테스트할 때는 아래 ChatKit 채팅창에 직접 주제를 입력합니다.</li>
              <li>최종 결과는 Notion 저장 및 Email 전송까지 이어집니다.</li>
            </ol>
          </div>

          <div className="mt-4 rounded-xl bg-neutral-900 p-4">
            <p className="mb-2 text-sm font-semibold text-neutral-300">
              테스트용 예시 프롬프트
            </p>
            <ul className="space-y-2 text-sm text-neutral-400">
              <li>
                - 최신 AI 이미지 생성 툴 트렌드 보고서를 작성하고 Notion과 이메일로 보내줘.
              </li>
              <li>
                - AI Agent MCP Workflow automation 주제로 일일 브리핑을 작성해줘.
              </li>
              <li>
                - 최근 멀티모달 AI 개발 트렌드를 조사하고 보고서를 작성해줘.
              </li>
            </ul>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-5xl px-6 pb-8">
        <ReportSettingsPanel />
      </section>

      <section className="mx-auto w-full max-w-5xl px-6 pb-10">
        <div className="rounded-2xl border border-neutral-800 bg-white text-black">
          <ChatKitPanel />
        </div>
      </section>
    </main>
  );
}
