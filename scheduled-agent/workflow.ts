import { hostedMcpTool, Agent, AgentInputItem, Runner, withTrace } from "@openai/agents";
import { z } from "zod";


// Tool definitions
const mcp = hostedMcpTool({
  serverLabel: "collect_trends",
  allowedTools: [
    "collect_trends"
  ],
  authorization: "devtrend-demo-token-2026",
  requireApproval: "never",
  serverUrl: "https://openai-chatkit-starter-app-99n.pages.dev/mcp"
})
const mcp1 = hostedMcpTool({
  serverLabel: "devtrend_mcp",
  serverUrl: "https://openai-chatkit-starter-app-99n.pages.dev/mcp",
  authorization: "devtrend-demo-token-2026",
  allowedTools: [
    "save_notion_report",
    "send_email_report"
  ],
  requireApproval: "never"
})
const ResultCheckerSchema = z.object({ is_sufficient: z.boolean(), total_count: z.number(), reason: z.string() });
const RetryQueryGeneratorSchema = z.object({ retry_reason: z.string(), retry_query: z.string() });
const RetryMcpCollectorSchema = z.object({ used_query: z.string(), retry_used: z.boolean(), counts: z.object({ arxiv: z.any(), github: z.any(), hacker_news: z.any() }), source_errors: z.object({ arxiv: z.any(), github: z.any(), hacker_news: z.any() }), api_evidence: z.array(z.object({ source: z.string(), method: z.string(), endpoint: z.string(), purpose: z.string() })), sources: z.object({ arxiv: z.array(z.object({})), github: z.array(z.object({})), hacker_news: z.array(z.object({})) }) });
const mcpCollector = new Agent({
  name: "MCP Collector",
  instructions: `이전 단계의 search_query를 사용해 MCP tool collect_trends를 호출한다.
collect_trends의 결과에서 counts와 source_errors를 유지한다.
결과를 요약하지 말고 다음 단계가 판단할 수 있도록 그대로 전달한다.`,
  model: "gpt-5.5",
  tools: [
    mcp
  ],
  modelSettings: {
    reasoning: {
      effort: "low",
      summary: "auto"
    },
    store: true
  }
});

const queryPlanner = new Agent({
  name: "Query Planner",
  instructions: `사용자의 한국어 또는 영어 입력을 AI 개발 트렌드 검색용 영어 키워드로 변환한다.

규칙:
- 검색 쿼리는 반드시 영어 단어로만 작성한다.
- 따옴표, OR, AND, 괄호, 콜론을 사용하지 않는다.
- 검색엔진 문법이 아니라 API 검색에 적합한 일반 키워드 나열 형식으로 만든다.
- 너무 긴 문장은 만들지 않는다.
- 핵심 키워드 4~8개만 사용한다.

좋은 예:
AI image generation diffusion model image editing

나쁜 예:
\"AI image generation\" OR \"text-to-image\" OR \"diffusion models\"

출력은 반드시 JSON으로 한다.

{
  \"original_topic\": \"...\",
  \"english_keywords\": [\"...\", \"...\"],
  \"search_query\": \"...\"
}`,
  model: "gpt-5.5",
  modelSettings: {
    reasoning: {
      effort: "low",
      summary: "auto"
    },
    store: true
  }
});

const briefingWriter = new Agent({
  name: "Briefing Writer",
  instructions: `당신은 DevTrend Briefing Writer Agent입니다.
역할: MCP Collector가 수집한 arXiv, GitHub, Hacker News 원천 데이터만 근거로 간결한 한국어 트렌드 보고서를 작성합니다.
중요:
원천 데이터에 없는 사실, 도구명, 회사명, 시장 판단을 추가하지 않습니다.
보고서 앞부분에 짧은 요약을 먼저 씁니다.
뒤쪽에는 근거 링크를 보기 쉽게 정리합니다.
전체 보고서는 짧고 실용적으로 작성합니다.
분량 제한:
전체 1,200~1,800자 이내
주요 트렌드는 최대 3개
각 트렌드는 3~4줄 이내
출처 링크는 각 소스별 최대 3개씩만 표시
5번 이후 섹션은 만들지 않음
출력 형식:
[AI 개발 트렌드 브리핑] {입력 주제}
1. 한눈에 보는 요약
핵심 요약 3줄 이내
수집 결과가 제한적이면 제한적이라고 명시
2. 주요 트렌드 Top 3
1) {트렌드명}
요약:
근거:
개발자 관점:
2) {트렌드명}
요약:
근거:
개발자 관점:
3) {트렌드명}
요약:
근거:
개발자 관점:
3. 근거 링크
이 섹션은 반드시 실제 URL을 포함한다. 제목만 쓰면 안 된다. 원천 데이터의 url, hn_url, html_url 중 사용 가능한 링크를 반드시 표시한다.
출력 형식:
arXiv
제목: {논문 제목} URL: {논문 URL} 설명: {한 줄 설명}
GitHub
제목: {저장소명} URL: {저장소 URL} 정보: stars {숫자}, language {언어} 설명: {한 줄 설명}
Hacker News
제목: {게시글 제목} URL: {게시글 URL 또는 hn_url} 정보: points {숫자}, comments {숫자} 설명: {한 줄 설명}
작성 규칙:
URL이 없는 항목은 근거 링크 섹션에 넣지 않는다.
각 소스별 최대 3개만 표시한다.
제목만 쓰고 URL을 생략하는 것은 금지한다.
URL은 반드시 https://... 또는 http://... 원문 형태로 출력한다.
4. 개발자 추천 액션
2~3개 bullet만 작성
작성 규칙:
주요 트렌드 Top 3는 수집 데이터에서 직접 관련성이 높은 항목만 선정합니다.
관련성이 낮은 데이터는 억지로 트렌드화하지 말고 “근거가 제한적”이라고 표시합니다.
GitHub 결과가 스팸성, 비공식 배포성, 주제와 무관해 보이면 핵심 트렌드 근거에서 제외합니다.
Hacker News 반응이 적으면 커뮤니티 반응이 제한적이라고 표현합니다.
## 1. 한눈에 보는 요약 작성 규칙

이 섹션은 수집 과정 요약이 아니라, 최종 트렌드 내용의 executive summary입니다.

반드시 포함할 내용:
- 이번 주제에서 실제로 관찰된 핵심 변화 또는 관심 흐름
- 개발자나 서비스 기획자가 바로 이해할 수 있는 의미
- 가장 중요한 트렌드 2~3개의 압축 요약

절대 쓰지 말 것:
- “수집 결과는 총 n건”
- “직접 관련된 근거는 제한적입니다”
- “arXiv와 GitHub 결과 대부분은 제외했습니다”
- “Hacker News에서는 ~가 확인됩니다”처럼 출처별 수집 과정만 나열하는 문장
- API 오류, 수집 건수, 제외 기준, 데이터 품질 평가

좋은 예:
- AI 이미지 생성은 단순 이미지 출력보다 멀티모달 입력, 편집 가능성, 도메인 특화 생성으로 관심이 이동하고 있습니다.
- 개발자 관점에서는 모델 자체보다 워크플로 자동화, 결과 제어, 서비스 통합 방식이 중요한 구현 포인트로 보입니다.
- 커뮤니티에서는 생성 결과를 코드·3D·영상 등 구조화된 결과물과 연결하려는 실험적 관심이 나타납니다.

나쁜 예:
- 수집 결과는 총 15건이지만 직접 관련된 근거는 제한적입니다.
- arXiv와 GitHub 결과 대부분은 금융 주제와 직접 관련성이 낮아 핵심 근거에서 제외했습니다.
- Hacker News에서는 신용 심사 자동화, 저축 앱, AI 투자 과열 논의가 확인됩니다.`,
  model: "gpt-5.5",
  modelSettings: {
    reasoning: {
      effort: "low",
      summary: "auto"
    },
    store: true
  }
});

const evidenceChecker = new Agent({
  name: "Evidence Checker",
  instructions: `당신은 Evidence Checker Agent입니다.
역할: 이전 단계의 보고서를 원천 데이터 기준으로 검토하고, 과장·근거 부족·불필요한 장문을 조용히 수정합니다.
중요:
검토 과정은 출력하지 않습니다.
“검토 결과”라는 섹션을 출력하지 않습니다.
“기존 브리핑에는 문제가 있습니다” 같은 문장을 출력하지 않습니다.
최종 사용자에게는 수정 완료된 최종 보고서만 출력합니다.
최종 출력 형식은 반드시 아래 4개 섹션만 사용합니다.
[AI 개발 트렌드 브리핑] {입력 주제}
1. 한눈에 보는 요약
3줄 이내
2. 주요 트렌드 Top 3
1) {트렌드명}
요약:
근거:
개발자 관점:
2) {트렌드명}
요약:
근거:
개발자 관점:
3) {트렌드명}
요약:
근거:
개발자 관점:
3. 근거 링크
arXiv
{제목} — 한 줄 설명
GitHub
{제목} — 한 줄 설명
Hacker News
{제목} — 한 줄 설명
4. 개발자 추천 액션
2~3개 bullet만 작성
검토 규칙:
원천 데이터에 없는 도구명, 서비스명, 회사명은 삭제합니다.
근거가 약한 시장 판단은 “제한적 신호”로 완화합니다.
관련성이 낮은 GitHub 결과는 핵심 트렌드에서 제외합니다.
전체 길이가 길면 중복 설명을 줄입니다.
1번 “한눈에 보는 요약” 검토 규칙:
- 1번 섹션이 수집 과정, 수집 건수, 제외된 데이터, 근거 부족 설명으로 시작하면 잘못된 출력이다.
- 그런 문장은 1번에서 제거한다.
- 1번에는 최종 트렌드의 내용 요약만 남긴다.
- 수집 한계나 근거 부족 설명은 필요한 경우 3번 근거 링크 또는 4번 추천 액션에 짧게만 반영한다.

잘못된 요약:
“수집 결과는 총 15건이지만, 금융/핀테크와 직접 관련된 근거는 제한적입니다.”

수정된 요약:
“핀테크 영역에서는 신용 심사 자동화, 개인 저축 관리, AI 투자 판단 보조처럼 사용자 금융 의사결정을 자동화하는 흐름이 관찰됩니다.”
근거 링크 검토 규칙:
3. 근거 링크 섹션의 모든 항목에는 반드시 URL이 있어야 한다.
제목과 설명만 있고 URL이 없으면 잘못된 출력이다.
원천 데이터에서 해당 항목의 url, html_url, hn_url 값을 찾아 URL 줄을 추가한다.
URL을 찾을 수 없는 항목은 근거 링크 섹션에서 제거한다.
최종 출력에서는 아래 형식을 반드시 유지한다.
arXiv
제목: {논문 제목} URL: {논문 URL} 설명: {한 줄 설명}
GitHub
제목: {저장소명} URL: {저장소 URL} 정보: stars {숫자}, language {언어} 설명: {한 줄 설명}
Hacker News
제목: {게시글 제목} URL: {게시글 URL 또는 hn_url} 정보: points {숫자}, comments {숫자} 설명: {한 줄 설명}
최종 점검:
URL:이 없는 근거 항목이 있으면 다시 작성한다.
링크를 제목에 숨기지 말고 URL 원문을 별도 줄에 표시한다.`,
  model: "gpt-5.5",
  modelSettings: {
    reasoning: {
      effort: "low",
      summary: "auto"
    },
    store: true
  }
});

const publisher = new Agent({
  name: "Publisher",
  instructions: `당신은 Publisher Agent입니다.
이전 단계의 최종 보고서를 Notion과 Email로 전달합니다.
반드시 수행할 일:
Evidence Checker가 만든 최종 보고서만 사용합니다.
save_notion_report MCP tool을 호출해 Notion에 저장합니다.
send_email_report MCP tool을 호출해 이메일로 전송합니다.
사용자에게는 저장/전송 성공 여부만 간단히 알려줍니다.
주의:
보고서를 다시 작성하지 않습니다.
검토 결과나 중간 분석을 추가하지 않습니다.
Notion과 Email에는 동일한 최종 보고서 본문을 보냅니다.
tool 호출 없이 저장/전송했다고 말하지 않습니다.
최종 응답 형식:
보고서 생성이 완료되었습니다.
Notion 저장: 성공/실패
이메일 전송: 성공/실패
사용된 MCP tools:
collect_trends
save_notion_report
send_email_report`,
  model: "gpt-5.5",
  tools: [
    mcp1
  ],
  modelSettings: {
    reasoning: {
      effort: "low",
      summary: "auto"
    },
    store: true
  }
});

const resultChecker = new Agent({
  name: "Result Checker",
  instructions: `collect_trends 결과를 보고 검색 결과가 충분한지 판단한다.

충분한 조건:
- arXiv + GitHub + Hacker News 전체 수집 건수가 3건 이상
또는
- 하나 이상의 소스에서 3건 이상 수집됨

부족한 조건:
- 전체 수집 건수가 0~2건
또는
- arXiv API 오류가 있고 GitHub/Hacker News 결과도 부족함
또는
- source_errors에 치명적 오류가 있고 대체 소스 결과가 부족함

반드시 JSON 객체만 출력한다.

{
  \"is_sufficient\": true 또는 false,
  \"total_count\": 숫자,
  \"reason\": \"판단 이유\"
}`,
  model: "gpt-5.5",
  outputType: ResultCheckerSchema,
  modelSettings: {
    reasoning: {
      effort: "low",
      summary: "auto"
    },
    store: true
  }
});

const retryQueryGenerator = new Agent({
  name: "Retry Query Generator",
  instructions: `사용자의 원래 주제와 실패 원인을 바탕으로 더 넓고 일반적인 영어 검색 쿼리를 만든다.

규칙:
- 반드시 영어 단어만 사용한다.
- 따옴표, OR, AND, 괄호, 콜론을 사용하지 않는다.
- 너무 구체적인 제품명만 쓰지 말고 상위 개념을 포함한다.
- 검색 범위를 넓히기 위해 동의어와 관련 기술어를 포함한다.
- 4~8개 단어로 제한한다.

예:
원래 주제: 최신 AI 이미지 생성 툴 트렌드
1차 쿼리: AI image generation diffusion editing
재검색 쿼리: generative AI image model diffusion multimodal creative tools

출력은 반드시 JSON으로 한다.

{
  \"retry_reason\": \"...\",
  \"retry_query\": \"...\"
}`,
  model: "gpt-5.5",
  outputType: RetryQueryGeneratorSchema,
  modelSettings: {
    reasoning: {
      effort: "low",
      summary: "auto"
    },
    store: true
  }
});

const retryMcpCollector = new Agent({
  name: "Retry MCP Collector",
  instructions: `당신은 Retry MCP Collector Agent입니다.

역할:
이전 단계인 Retry Query Generator가 생성한 retry_query를 사용하여 MCP tool collect_trends를 다시 호출합니다.

반드시 수행할 일:
1. 이전 단계의 retry_query 값을 확인합니다.
2. retry_query가 있으면 그 값을 collect_trends tool의 query 인자로 전달합니다.
3. retry_query가 비어 있거나 부적절하면 original_topic 또는 search_query를 기반으로 영어 핵심 키워드 4~8개를 만들어 collect_trends를 호출합니다.
4. collect_trends 도구 호출 결과의 counts, source_errors, api_evidence, sources 필드를 유지합니다.
5. 결과를 요약하거나 임의로 삭제하지 말고 다음 Agent가 사용할 수 있도록 구조화해서 전달합니다.

주의:
- 반드시 collect_trends MCP tool을 호출해야 합니다.
- 브리핑을 작성하지 않습니다.
- 트렌드 점수화를 하지 않습니다.
- 원천 데이터에 없는 내용을 추가하지 않습니다.
- 검색어는 영어 단어 중심으로만 사용합니다.
- 따옴표, OR, AND, 괄호, 콜론을 사용하지 않습니다.

출력 형식:

{
  \"used_query\": \"실제로 collect_trends에 사용한 검색어\",
  \"retry_used\": true,
  \"counts\": {
    \"arxiv\": 0,
    \"github\": 0,
    \"hacker_news\": 0
  },
  \"source_errors\": {
    \"arxiv\": null,
    \"github\": null,
    \"hacker_news\": null
  },
  \"api_evidence\": [],
  \"sources\": {
    \"arxiv\": [],
    \"github\": [],
    \"hacker_news\": []
  }
}`,
  model: "gpt-5.5",
  outputType: RetryMcpCollectorSchema,
  modelSettings: {
    reasoning: {
      effort: "low",
      summary: "auto"
    },
    store: true
  }
});

type WorkflowInput = { input_as_text: string };


// Main code entrypoint
export const runWorkflow = async (workflow: WorkflowInput) => {
  return await withTrace("2020156023Team10", async () => {
    const state = {

    };
    const conversationHistory: AgentInputItem[] = [
      { role: "user", content: [{ type: "input_text", text: workflow.input_as_text }] }
    ];
    const runner = new Runner({
      traceMetadata: {
        __trace_source__: "agent-builder",
        workflow_id: "wf_6a2eccff5828819084dd5e86392f6be3033ac0e500e6c0e1"
      }
    });
    const queryPlannerResultTemp = await runner.run(
      queryPlanner,
      [
        ...conversationHistory
      ]
    );
    conversationHistory.push(...queryPlannerResultTemp.newItems.map((item) => item.rawItem));

    if (!queryPlannerResultTemp.finalOutput) {
        throw new Error("Agent result is undefined");
    }

    const queryPlannerResult = {
      output_text: queryPlannerResultTemp.finalOutput ?? ""
    };
    const mcpCollectorResultTemp = await runner.run(
      mcpCollector,
      [
        ...conversationHistory
      ]
    );
    conversationHistory.push(...mcpCollectorResultTemp.newItems.map((item) => item.rawItem));

    if (!mcpCollectorResultTemp.finalOutput) {
        throw new Error("Agent result is undefined");
    }

    const mcpCollectorResult = {
      output_text: mcpCollectorResultTemp.finalOutput ?? ""
    };
    const resultCheckerResultTemp = await runner.run(
      resultChecker,
      [
        ...conversationHistory
      ]
    );
    conversationHistory.push(...resultCheckerResultTemp.newItems.map((item) => item.rawItem));

    if (!resultCheckerResultTemp.finalOutput) {
        throw new Error("Agent result is undefined");
    }

    const resultCheckerResult = {
      output_text: JSON.stringify(resultCheckerResultTemp.finalOutput),
      output_parsed: resultCheckerResultTemp.finalOutput
    };
    if (resultCheckerResult.output_parsed.is_sufficient == true) {
      const briefingWriterResultTemp = await runner.run(
        briefingWriter,
        [
          ...conversationHistory
        ]
      );
      conversationHistory.push(...briefingWriterResultTemp.newItems.map((item) => item.rawItem));

      if (!briefingWriterResultTemp.finalOutput) {
          throw new Error("Agent result is undefined");
      }

      const briefingWriterResult = {
        output_text: briefingWriterResultTemp.finalOutput ?? ""
      };
      const evidenceCheckerResultTemp = await runner.run(
        evidenceChecker,
        [
          ...conversationHistory
        ]
      );
      conversationHistory.push(...evidenceCheckerResultTemp.newItems.map((item) => item.rawItem));

      if (!evidenceCheckerResultTemp.finalOutput) {
          throw new Error("Agent result is undefined");
      }

      const evidenceCheckerResult = {
        output_text: evidenceCheckerResultTemp.finalOutput ?? ""
      };
      const publisherResultTemp = await runner.run(
        publisher,
        [
          ...conversationHistory
        ]
      );
      conversationHistory.push(...publisherResultTemp.newItems.map((item) => item.rawItem));

      if (!publisherResultTemp.finalOutput) {
          throw new Error("Agent result is undefined");
      }

      const publisherResult = {
        output_text: publisherResultTemp.finalOutput ?? ""
      };
      return publisherResult;
    } else {
      const retryQueryGeneratorResultTemp = await runner.run(
        retryQueryGenerator,
        [
          ...conversationHistory
        ]
      );
      conversationHistory.push(...retryQueryGeneratorResultTemp.newItems.map((item) => item.rawItem));

      if (!retryQueryGeneratorResultTemp.finalOutput) {
          throw new Error("Agent result is undefined");
      }

      const retryQueryGeneratorResult = {
        output_text: JSON.stringify(retryQueryGeneratorResultTemp.finalOutput),
        output_parsed: retryQueryGeneratorResultTemp.finalOutput
      };
      const retryMcpCollectorResultTemp = await runner.run(
        retryMcpCollector,
        [
          ...conversationHistory
        ]
      );
      conversationHistory.push(...retryMcpCollectorResultTemp.newItems.map((item) => item.rawItem));

      if (!retryMcpCollectorResultTemp.finalOutput) {
          throw new Error("Agent result is undefined");
      }

      const retryMcpCollectorResult = {
        output_text: JSON.stringify(retryMcpCollectorResultTemp.finalOutput),
        output_parsed: retryMcpCollectorResultTemp.finalOutput
      };
      const briefingWriterResultTemp = await runner.run(
        briefingWriter,
        [
          ...conversationHistory
        ]
      );
      conversationHistory.push(...briefingWriterResultTemp.newItems.map((item) => item.rawItem));

      if (!briefingWriterResultTemp.finalOutput) {
          throw new Error("Agent result is undefined");
      }

      const briefingWriterResult = {
        output_text: briefingWriterResultTemp.finalOutput ?? ""
      };
      const evidenceCheckerResultTemp = await runner.run(
        evidenceChecker,
        [
          ...conversationHistory
        ]
      );
      conversationHistory.push(...evidenceCheckerResultTemp.newItems.map((item) => item.rawItem));

      if (!evidenceCheckerResultTemp.finalOutput) {
          throw new Error("Agent result is undefined");
      }

      const evidenceCheckerResult = {
        output_text: evidenceCheckerResultTemp.finalOutput ?? ""
      };
      const publisherResultTemp = await runner.run(
        publisher,
        [
          ...conversationHistory
        ]
      );
      conversationHistory.push(...publisherResultTemp.newItems.map((item) => item.rawItem));

      if (!publisherResultTemp.finalOutput) {
          throw new Error("Agent result is undefined");
      }

      const publisherResult = {
        output_text: publisherResultTemp.finalOutput ?? ""
      };
      return publisherResult;
    }
  });
}
