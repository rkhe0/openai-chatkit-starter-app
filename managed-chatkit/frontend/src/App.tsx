import { ReportSettingsPanel } from "./components/ReportSettingsPanel";
import { ChatKitPanel } from "./components/ChatKitPanel";

export default function App() {
  return (
    <main className="min-h-screen bg-black text-white">
      <section className="mx-auto w-full max-w-5xl px-6 py-8">
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
