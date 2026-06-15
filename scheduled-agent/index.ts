import { runWorkflow } from "./workflow";

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

requireEnv("OPENAI_API_KEY");
requireEnv("MCP_SERVER_URL");
requireEnv("MCP_ACCESS_TOKEN");

const topic =
  process.env.DAILY_TOPIC?.trim() ||
  "최신 AI 이미지 생성 툴 트렌드";

const prompt = `
${topic} 보고서를 작성하고 Notion과 이메일로 보내줘.

요구사항:
- 핵심 트렌드 요약을 먼저 작성한다.
- 요약은 수집 과정 요약이 아니라 트렌드 내용 요약으로 작성한다.
- 주요 트렌드는 Top 3까지만 작성한다.
- 근거 링크를 보기 좋게 정리한다.
- 보고서 작성 후 save_notion_report MCP tool로 Notion에 저장한다.
- 보고서 작성 후 send_email_report MCP tool로 이메일을 전송한다.
- Publisher Agent는 저장/전송 성공 여부만 간단히 보고한다.
`.trim();

console.log("=== DevTrend scheduled agent run ===");
console.log(`Topic: ${topic}`);

const result = await runWorkflow({
  input_as_text: prompt,
});

console.log("=== FINAL OUTPUT ===");
console.log(result.output_text ?? result);