import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AppConfig } from "../src/server/config.js";
import { initializeDatabase } from "../src/server/storage/db.js";
import { createCampaign } from "../src/server/services/campaign-service.js";
import { listDivisions } from "../src/server/services/division-service.js";
import { sendOwnerMessage } from "../src/server/services/conversation-service.js";
import { getCampaignProjection } from "../src/server/services/graph-service.js";
import { extractPmActions, validatePmActions } from "../src/server/services/pm-action-service.js";

interface ReviewItem {
  ticket: string;
  label: string;
  passed: boolean;
  evidence: string;
}

function createReviewConfig(): AppConfig {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "local-company-v2-phase2-"));
  const dataDir = path.join(rootDir, "data");

  return {
    rootDir,
    port: 8788,
    dataDir,
    dbPath: path.join(dataDir, "local-company.sqlite"),
    nodeEnv: "review"
  };
}

const config = createReviewConfig();
const context = initializeDatabase(config);
const division = listDivisions(context.db)[0];
const campaign = createCampaign(context.db, config, {
  divisionId: division.id,
  title: "Phase 2 리뷰 캠페인",
  summary: "PM 액션과 업무 그래프 반영을 검증한다."
});
const extracted = extractPmActions({
  campaign,
  ownerMessage: "콘텐츠 제작 목표를 업무와 산출물로 쪼개주세요.",
  pmReply: "목표, 태스크, 산출물 요청으로 정리하겠습니다."
});
const validation = validatePmActions(context.db, campaign.id, extracted.actions);
sendOwnerMessage(context.db, config, campaign.id, "콘텐츠 제작 목표를 업무와 산출물로 쪼개주세요.");
const projection = getCampaignProjection(context.db, campaign.id);
const eventRows = context.db
  .prepare("SELECT type FROM events WHERE campaign_id = ? ORDER BY created_at ASC, rowid ASC")
  .all(campaign.id) as unknown as { type: string }[];
const riskyValidation = validatePmActions(context.db, campaign.id, [
  {
    type: "enqueue_work",
    taskId: "task-missing",
    reason: "대표 확인 없이 자동 실행하지 않음"
  }
]);

const reviewItems: ReviewItem[] = [
  {
    ticket: "V2-2-01",
    label: "PM 액션 스키마 정의",
    passed: extracted.actions.length >= 4 && validation.accepted.length >= 4,
    evidence: `actions=${extracted.actions.map((action) => action.type).join(", ")}`
  },
  {
    ticket: "V2-2-02",
    label: "서기 액션 추출",
    passed: extracted.rawOutput.includes("create_goal") && eventRows.some((row) => row.type === "pm_actions_extracted"),
    evidence: "mock scribe output stored in events"
  },
  {
    ticket: "V2-2-03",
    label: "액션 검증",
    passed: riskyValidation.rejected.length === 1 && riskyValidation.rejected[0].approvalRequired,
    evidence: riskyValidation.rejected[0]?.reason ?? "none"
  },
  {
    ticket: "V2-2-04",
    label: "그래프 노드/엣지 저장",
    passed:
      projection.goals.length >= 1 &&
      projection.tasks.length >= 1 &&
      projection.artifacts.length >= 1 &&
      projection.edges.length >= 2,
    evidence: `goals=${projection.goals.length}, tasks=${projection.tasks.length}, artifacts=${projection.artifacts.length}, edges=${projection.edges.length}`
  },
  {
    ticket: "V2-2-05",
    label: "운영판 projection",
    passed:
      projection.goals[0].title.length > 0 &&
      ["ready", "queued", "running", "done"].includes(projection.tasks[0].status),
    evidence: `firstGoal=${projection.goals[0]?.title ?? "none"}`
  }
];

context.db.close();

for (const item of reviewItems) {
  const marker = item.passed ? "PASS" : "FAIL";
  console.log(`[${marker}] ${item.ticket} ${item.label}`);
  console.log(`       ${item.evidence}`);
}

const failed = reviewItems.filter((item) => !item.passed);

if (failed.length > 0) {
  console.error(`Phase 2 review failed: ${failed.length} item(s) need attention.`);
  process.exitCode = 1;
} else {
  console.log("Phase 2 review passed.");
}
