import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AppConfig } from "../src/server/config.js";
import { initializeDatabase } from "../src/server/storage/db.js";
import { createCampaign } from "../src/server/services/campaign-service.js";
import { listDivisions } from "../src/server/services/division-service.js";
import { sendOwnerMessage } from "../src/server/services/conversation-service.js";
import { createArtifactVersion, getArtifactDetail } from "../src/server/services/artifact-service.js";
import { getCampaignProjection } from "../src/server/services/graph-service.js";
import { runNextQueueItem } from "../src/server/services/queue-service.js";
import { requestArtifactRevision } from "../src/server/services/revision-service.js";

interface ReviewItem {
  ticket: string;
  label: string;
  passed: boolean;
  evidence: string;
}

function createReviewConfig(): AppConfig {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "local-company-v2-phase7-"));
  const dataDir = path.join(rootDir, "data");

  return {
    rootDir,
    port: 8788,
    dataDir,
    dbPath: path.join(dataDir, "local-company.sqlite"),
    nodeEnv: "review"
  };
}

function createReviewCampaign(context: ReturnType<typeof initializeDatabase>, config: AppConfig, title: string) {
  const division = listDivisions(context.db)[0];
  return createCampaign(context.db, config, {
    divisionId: division.id,
    title
  });
}

function createArtifact(
  context: ReturnType<typeof initializeDatabase>,
  config: AppConfig,
  campaignId: string,
  input: { id: string; displayNumber: number; title: string; content: string }
): string {
  context.db
    .prepare(
      `INSERT INTO artifacts (id, campaign_id, display_number, title, kind, status, linked_task_ids)
       VALUES (?, ?, ?, ?, 'markdown', 'approved', '[]')`
    )
    .run(input.id, campaignId, input.displayNumber, input.title);

  context.db
    .prepare(
      `INSERT INTO graph_nodes (id, campaign_id, type, title, status, summary)
       VALUES (?, ?, 'artifact', ?, 'approved', '검증용 산출물')`
    )
    .run(input.id, campaignId, input.title);

  createArtifactVersion(context.db, config, {
    artifactId: input.id,
    createdBy: "리뷰 스크립트",
    content: input.content,
    review: "검증용 초기 리뷰입니다.\n"
  });

  return input.id;
}

function reviewRevisionRequestAction(): ReviewItem {
  const config = createReviewConfig();
  const context = initializeDatabase(config);
  const campaign = createReviewCampaign(context, config, "Phase 7 자연어 수정 요청 캠페인");
  const artifactId = createArtifact(context, config, campaign.id, {
    id: "artifact-phase7-natural",
    displayNumber: 1,
    title: "자연어 수정 대상",
    content: "# 자연어 수정 대상\n\n초안입니다."
  });

  sendOwnerMessage(context.db, config, campaign.id, "001 산출물을 더 짧고 분명하게 수정해주세요.");

  const projection = getCampaignProjection(context.db, campaign.id);
  const detail = getArtifactDetail(context.db, config, artifactId);
  const workerRunCount = projection.queueItems.filter((item) => item.type === "worker_run").length;
  const revisionQueueCount = projection.queueItems.filter((item) => item.type === "artifact_revision").length;

  context.db.close();

  return {
    ticket: "V2-7-01",
    label: "수정 요청 액션",
    passed:
      detail.revisionRequests.length === 1 &&
      detail.revisionRequests[0].instruction.includes("수정해주세요") &&
      projection.artifacts.length === 1 &&
      workerRunCount === 0 &&
      revisionQueueCount === 1,
    evidence: `revisionRequests=${detail.revisionRequests.length}, workerRuns=${workerRunCount}, revisionQueues=${revisionQueueCount}`
  };
}

function reviewRevisionFlow(): ReviewItem[] {
  const config = createReviewConfig();
  const context = initializeDatabase(config);
  const campaign = createReviewCampaign(context, config, "Phase 7 수정 실행 캠페인");
  const artifactId = createArtifact(context, config, campaign.id, {
    id: "artifact-phase7-target",
    displayNumber: 1,
    title: "수정 실행 대상",
    content: "# 수정 실행 대상\n\n초안입니다."
  });
  const relatedArtifactId = createArtifact(context, config, campaign.id, {
    id: "artifact-phase7-related",
    displayNumber: 2,
    title: "관련 산출물",
    content: "# 관련 산출물\n\n표현을 맞출 기준입니다."
  });

  const first = requestArtifactRevision(context.db, artifactId, {
    instruction: "문장을 더 간결하게 고치고 관련 산출물과 표현을 맞춰주세요.",
    relatedArtifactIds: [relatedArtifactId]
  });
  const duplicate = requestArtifactRevision(context.db, artifactId, {
    instruction: "문장을 더 간결하게 고치고 관련 산출물과 표현을 맞춰주세요.",
    relatedArtifactIds: [relatedArtifactId]
  });
  const beforeRunProjection = getCampaignProjection(context.db, campaign.id);
  const beforeDetail = getArtifactDetail(context.db, config, artifactId);
  const revisionRun = runNextQueueItem(context.db, config, campaign.id);
  const reviewRun = runNextQueueItem(context.db, config, campaign.id);
  const afterProjection = getCampaignProjection(context.db, campaign.id);
  const afterDetail = getArtifactDetail(context.db, config, artifactId);
  const requestAfterReview = afterDetail.revisionRequests.find((item) => item.id === first.revisionRequest.id);

  const reviewItems: ReviewItem[] = [
    {
      ticket: "V2-7-02",
      label: "관련 산출물 추적",
      passed:
        beforeRunProjection.edges.some((edge) => edge.fromNodeId === first.revisionRequest.taskId && edge.toNodeId === artifactId && edge.relation === "revises") &&
        beforeRunProjection.edges.some((edge) => edge.fromNodeId === artifactId && edge.toNodeId === relatedArtifactId && edge.relation === "references") &&
        beforeDetail.relations.some((relation) => relation.relation === "revises") &&
        beforeDetail.relations.some((relation) => relation.relation === "references"),
      evidence: `edges=${beforeRunProjection.edges.length}, relations=${beforeDetail.relations.length}`
    },
    {
      ticket: "V2-7-03",
      label: "수정 큐 실행",
      passed:
        revisionRun.queueItem?.type === "artifact_revision" &&
        revisionRun.queueItem.status === "done" &&
        afterDetail.currentVersion?.version === "v002" &&
        afterDetail.content.includes("대표 수정 요청을 반영했습니다"),
      evidence: `queue=${revisionRun.queueItem?.status ?? "none"}, version=${afterDetail.currentVersion?.version ?? "none"}`
    },
    {
      ticket: "V2-7-04",
      label: "수정 후 PM 리뷰",
      passed:
        reviewRun.queueItem?.type === "pm_review" &&
        reviewRun.queueItem.status === "done" &&
        afterProjection.artifacts.find((artifact) => artifact.id === artifactId)?.status === "approved" &&
        requestAfterReview?.status === "approved" &&
        afterDetail.review.includes("판정: 승인"),
      evidence: `review=${reviewRun.queueItem?.status ?? "none"}, artifact=${afterProjection.artifacts.find((artifact) => artifact.id === artifactId)?.status ?? "none"}, request=${requestAfterReview?.status ?? "none"}`
    },
    {
      ticket: "V2-7-05",
      label: "처리된 수정 제외",
      passed:
        first.created &&
        !duplicate.created &&
        duplicate.revisionRequest.id === first.revisionRequest.id &&
        beforeRunProjection.queueItems.filter((item) => item.type === "artifact_revision").length === 1,
      evidence: `firstCreated=${first.created}, duplicateCreated=${duplicate.created}, revisionQueues=${beforeRunProjection.queueItems.filter((item) => item.type === "artifact_revision").length}`
    }
  ];

  context.db.close();
  return reviewItems;
}

const reviewItems: ReviewItem[] = [reviewRevisionRequestAction(), ...reviewRevisionFlow()];

for (const item of reviewItems) {
  const marker = item.passed ? "PASS" : "FAIL";
  console.log(`[${marker}] ${item.ticket} ${item.label}`);
  console.log(`       ${item.evidence}`);
}

const failed = reviewItems.filter((item) => !item.passed);

if (failed.length > 0) {
  console.error(`Phase 7 review failed: ${failed.length} item(s) need attention.`);
  process.exitCode = 1;
} else {
  console.log("Phase 7 review passed.");
}
