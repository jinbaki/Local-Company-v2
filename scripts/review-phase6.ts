import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AppConfig } from "../src/server/config.js";
import { initializeDatabase } from "../src/server/storage/db.js";
import { createCampaign, listCampaigns } from "../src/server/services/campaign-service.js";
import { listDivisions } from "../src/server/services/division-service.js";
import { getCampaignProjection } from "../src/server/services/graph-service.js";
import { createArtifactVersion, getArtifactDetail } from "../src/server/services/artifact-service.js";
import { runNextQueueItem } from "../src/server/services/queue-service.js";
import { answerDecision, getDecision, listDecisions } from "../src/server/services/decision-service.js";

interface ReviewItem {
  ticket: string;
  label: string;
  passed: boolean;
  evidence: string;
}

function createReviewConfig(): AppConfig {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "local-company-v2-phase6-"));
  const dataDir = path.join(rootDir, "data");

  return {
    rootDir,
    port: 8788,
    dataDir,
    dbPath: path.join(dataDir, "local-company.sqlite"),
    nodeEnv: "review"
  };
}

function createReviewCampaign(context: ReturnType<typeof initializeDatabase>, config: AppConfig) {
  const division = listDivisions(context.db)[0];
  return createCampaign(context.db, config, {
    divisionId: division.id,
    title: "Phase 6 대표 결정함 캠페인"
  });
}

function createBlockedReviewArtifact(context: ReturnType<typeof initializeDatabase>, config: AppConfig, campaignId: string): string {
  const artifactId = "artifact-phase6-owner-decision";

  context.db
    .prepare(
      `INSERT INTO artifacts (id, campaign_id, display_number, title, kind, status, linked_task_ids)
       VALUES (?, ?, 1, '대표 결정함 검증 산출물', 'markdown', 'in_review', '[]')`
    )
    .run(artifactId, campaignId);

  context.db
    .prepare(
      `INSERT INTO graph_nodes (id, campaign_id, type, title, status, summary)
       VALUES (?, ?, 'artifact', '대표 결정함 검증 산출물', 'in_review', 'PM 리뷰 대기')`
    )
    .run(artifactId, campaignId);

  createArtifactVersion(context.db, config, {
    artifactId,
    createdBy: "리뷰 스크립트",
    content: "# 대표 결정함 검증 산출물\n\n[OWNER_DECISION]\n\n비용 확정 필요 항목이 있습니다.",
    review: "PM 리뷰 대기 상태입니다.\n"
  });

  context.db
    .prepare(
      `INSERT INTO queue_items (id, type, status, campaign_id, artifact_ids, max_attempts)
       VALUES ('queue-phase6-owner-review', 'pm_review', 'queued', ?, ?, 1)`
    )
    .run(campaignId, JSON.stringify([artifactId]));

  return artifactId;
}

function reviewUiWiring(): ReviewItem {
  const appSource = fs.readFileSync(path.join(process.cwd(), "src/client/App.tsx"), "utf8");

  return {
    ticket: "V2-6-02",
    label: "결정함 UI",
    passed:
      appSource.includes("DecisionInboxView") &&
      appSource.includes("onOpenDecision") &&
      appSource.includes("decisions={loadState.appState.decisions}") &&
      appSource.includes("대표 결정함"),
    evidence: "HomeView, CampaignView, DecisionInboxView wiring exists in src/client/App.tsx"
  };
}

function reviewDecisionFlow(): ReviewItem[] {
  const config = createReviewConfig();
  const context = initializeDatabase(config);
  const campaign = createReviewCampaign(context, config);
  const artifactId = createBlockedReviewArtifact(context, config, campaign.id);

  const blockedRun = runNextQueueItem(context.db, config, campaign.id);
  const openDecision = listDecisions(context.db, "open")[0];
  const decisionDetail = getDecision(context.db, openDecision.id);
  const selectedOption = openDecision.options[0];
  const answer = answerDecision(context.db, openDecision.id, {
    selectedOption,
    answer: "대표가 비용 기준을 확인했으니 PM 리뷰를 계속 진행합니다."
  });
  const answeredDecision = getDecision(context.db, openDecision.id);
  const afterAnswer = getCampaignProjection(context.db, campaign.id);
  const resumedQueue = afterAnswer.queueItems.find((item) => item.id === blockedRun.queueItem?.id);
  const campaignSummary = listCampaigns(context.db).find((item) => item.id === campaign.id);
  const rerun = runNextQueueItem(context.db, config, campaign.id);
  const finalProjection = getCampaignProjection(context.db, campaign.id);
  const detail = getArtifactDetail(context.db, config, artifactId);

  const reviewItems: ReviewItem[] = [
    {
      ticket: "V2-6-01",
      label: "결정 모델 구현",
      passed:
        Boolean(decisionDetail) &&
        openDecision.status === "open" &&
        openDecision.options.length >= 2 &&
        openDecision.blocks.includes(artifactId) &&
        openDecision.blockedQueueCount === 1,
      evidence: `decision=${openDecision.id}, options=${openDecision.options.length}, blocks=${openDecision.blocks.length}`
    },
    {
      ticket: "V2-6-03",
      label: "선택지와 추천안",
      passed:
        openDecision.recommendedOption.length > 0 &&
        answeredDecision?.status === "answered" &&
        Boolean(answeredDecision.answer?.includes(selectedOption)) &&
        Boolean(answeredDecision.answer?.includes("비용 기준")),
      evidence: `recommended=${openDecision.recommendedOption}, answered=${answeredDecision?.status ?? "none"}`
    },
    {
      ticket: "V2-6-04",
      label: "결정 반영",
      passed:
        answer.resumedQueueCount === 1 &&
        resumedQueue?.status === "queued" &&
        campaignSummary?.health === "normal" &&
        rerun.queueItem?.status === "done" &&
        finalProjection.artifacts[0]?.status === "approved" &&
        detail.review.includes("대표 결정 답변을 반영했습니다"),
      evidence: `resumed=${answer.resumedQueueCount}, queue=${resumedQueue?.status ?? "none"}, artifact=${finalProjection.artifacts[0]?.status ?? "none"}`
    }
  ];

  context.db.close();
  return reviewItems;
}

const flowItems = reviewDecisionFlow();
const reviewItems: ReviewItem[] = [flowItems[0], reviewUiWiring(), ...flowItems.slice(1)];

for (const item of reviewItems) {
  const marker = item.passed ? "PASS" : "FAIL";
  console.log(`[${marker}] ${item.ticket} ${item.label}`);
  console.log(`       ${item.evidence}`);
}

const failed = reviewItems.filter((item) => !item.passed);

if (failed.length > 0) {
  console.error(`Phase 6 review failed: ${failed.length} item(s) need attention.`);
  process.exitCode = 1;
} else {
  console.log("Phase 6 review passed.");
}
