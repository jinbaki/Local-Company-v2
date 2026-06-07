import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AppConfig } from "../src/server/config.js";
import { initializeDatabase } from "../src/server/storage/db.js";
import { createCampaign, listCampaigns } from "../src/server/services/campaign-service.js";
import { listDivisions } from "../src/server/services/division-service.js";
import { sendOwnerMessage } from "../src/server/services/conversation-service.js";
import { getCampaignProjection } from "../src/server/services/graph-service.js";
import { createArtifactVersion, getArtifactDetail } from "../src/server/services/artifact-service.js";
import { listQueueItems, runNextQueueItem, syncQueueForCampaign } from "../src/server/services/queue-service.js";
import { approveTeamProposal } from "../src/server/services/team-proposal-service.js";

interface ReviewItem {
  ticket: string;
  label: string;
  passed: boolean;
  evidence: string;
}

function createReviewConfig(): AppConfig {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "local-company-v2-phase5-"));
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

function createReviewArtifact(
  context: ReturnType<typeof initializeDatabase>,
  config: AppConfig,
  campaignId: string,
  input: {
    id: string;
    displayNumber: number;
    title: string;
    content: string;
  }
): string {
  context.db
    .prepare(
      `INSERT INTO artifacts (id, campaign_id, display_number, title, kind, status, linked_task_ids)
       VALUES (?, ?, ?, ?, 'markdown', 'in_review', '[]')`
    )
    .run(input.id, campaignId, input.displayNumber, input.title);

  context.db
    .prepare(
      `INSERT INTO graph_nodes (id, campaign_id, type, title, status, summary)
       VALUES (?, ?, 'artifact', ?, 'in_review', 'PM 리뷰 대기')`
    )
    .run(input.id, campaignId, input.title);

  createArtifactVersion(context.db, config, {
    artifactId: input.id,
    createdBy: "리뷰 스크립트",
    content: input.content,
    review: "PM 리뷰 대기 상태입니다.\n"
  });

  return input.id;
}

function enqueueReview(context: ReturnType<typeof initializeDatabase>, campaignId: string, queueId: string, artifactIds: string[]): void {
  context.db
    .prepare(
      `INSERT INTO queue_items (id, type, status, campaign_id, artifact_ids, max_attempts)
       VALUES (?, 'pm_review', 'queued', ?, ?, 1)`
    )
    .run(queueId, campaignId, JSON.stringify(artifactIds));
}

function approvePendingTeamProposal(context: ReturnType<typeof initializeDatabase>, campaignId: string): void {
  const proposal = getCampaignProjection(context.db, campaignId).teamProposals.find((item) => item.status === "pending");
  if (!proposal) {
    return;
  }

  approveTeamProposal(context.db, proposal.id);
  syncQueueForCampaign(context.db, campaignId);
}

function reviewApprovalFlow(): ReviewItem[] {
  const config = createReviewConfig();
  const context = initializeDatabase(config);
  const campaign = createReviewCampaign(context, config, "Phase 5 승인 리뷰 캠페인");

  sendOwnerMessage(context.db, config, campaign.id, "PM 리뷰 승인 검증용 산출물을 만들어주세요.");
  approvePendingTeamProposal(context, campaign.id);
  const workerRun = runNextQueueItem(context.db, config, campaign.id);
  const reviewRun = runNextQueueItem(context.db, config, campaign.id);
  const projection = getCampaignProjection(context.db, campaign.id);
  const artifact = projection.artifacts[0];
  const detail = getArtifactDetail(context.db, config, artifact.id);
  const hasRevisionQueue = listQueueItems(context.db, campaign.id).some((item) => item.type === "artifact_revision");

  context.db.close();

  return [
    {
      ticket: "V2-5-01",
      label: "PM 리뷰 실행",
      passed: workerRun.queueItem?.type === "worker_run" && reviewRun.queueItem?.type === "pm_review" && detail.review.includes("판정: 승인"),
      evidence: `reviewQueue=${reviewRun.queueItem?.status ?? "none"}, reviewPath=${detail.currentVersion?.reviewPath ?? "none"}`
    },
    {
      ticket: "V2-5-02",
      label: "통과 판정",
      passed: artifact.status === "approved" && !hasRevisionQueue,
      evidence: `artifactStatus=${artifact.status}, revisionQueue=${hasRevisionQueue ? "yes" : "no"}`
    }
  ];
}

function reviewRevisionFlow(): ReviewItem {
  const config = createReviewConfig();
  const context = initializeDatabase(config);
  const campaign = createReviewCampaign(context, config, "Phase 5 재작업 리뷰 캠페인");
  const approvedArtifactId = createReviewArtifact(context, config, campaign.id, {
    id: "artifact-phase5-approved",
    displayNumber: 1,
    title: "승인 대상 산출물",
    content: "# 승인 대상 산출물\n\n목적과 다음 행동이 정리되어 있습니다."
  });
  const revisionArtifactId = createReviewArtifact(context, config, campaign.id, {
    id: "artifact-phase5-revision",
    displayNumber: 2,
    title: "재작업 대상 산출물",
    content: "# 재작업 대상 산출물\n\n[NEEDS_REVISION]\n\n표현을 더 선명하게 다듬어야 합니다."
  });

  enqueueReview(context, campaign.id, "queue-phase5-mixed-review", [approvedArtifactId, revisionArtifactId]);
  runNextQueueItem(context.db, config, campaign.id);
  const afterReview = getCampaignProjection(context.db, campaign.id);
  const revisionQueues = afterReview.queueItems.filter((item) => item.type === "artifact_revision");

  runNextQueueItem(context.db, config, campaign.id);
  runNextQueueItem(context.db, config, campaign.id);
  const finalProjection = getCampaignProjection(context.db, campaign.id);
  const finalDetail = getArtifactDetail(context.db, config, revisionArtifactId);

  const approvedStatus = afterReview.artifacts.find((artifact) => artifact.id === approvedArtifactId)?.status;
  const revisionStatus = finalProjection.artifacts.find((artifact) => artifact.id === revisionArtifactId)?.status;

  context.db.close();

  return {
    ticket: "V2-5-03",
    label: "재작업 큐 생성",
    passed:
      approvedStatus === "approved" &&
      revisionQueues.length === 1 &&
      revisionQueues[0].artifactIds.includes(revisionArtifactId) &&
      revisionStatus === "approved" &&
      finalDetail.currentVersion?.version === "v002",
    evidence: `approved=${approvedStatus}, revisionQueues=${revisionQueues.length}, final=${revisionStatus}, version=${finalDetail.currentVersion?.version ?? "none"}`
  };
}

function reviewRepeatLimitFlow(): ReviewItem {
  const config = createReviewConfig();
  const context = initializeDatabase(config);
  const campaign = createReviewCampaign(context, config, "Phase 5 반복 제한 캠페인");
  const artifactId = createReviewArtifact(context, config, campaign.id, {
    id: "artifact-phase5-repeat-limit",
    displayNumber: 1,
    title: "반복 제한 산출물",
    content: "# 반복 제한 산출물\n\n근거 부족 항목이 남아 있습니다."
  });

  enqueueReview(context, campaign.id, "queue-phase5-repeat-review", [artifactId]);
  runNextQueueItem(context.db, config, campaign.id);
  runNextQueueItem(context.db, config, campaign.id);
  runNextQueueItem(context.db, config, campaign.id);
  runNextQueueItem(context.db, config, campaign.id);
  runNextQueueItem(context.db, config, campaign.id);

  const projection = getCampaignProjection(context.db, campaign.id);
  const revisionQueues = projection.queueItems.filter((item) => item.type === "artifact_revision");
  const blockedRevision = revisionQueues.find((item) => item.status === "blocked");
  const campaignSummary = listCampaigns(context.db).find((item) => item.id === campaign.id);

  context.db.close();

  return {
    ticket: "V2-5-04",
    label: "최대 반복 제한",
    passed:
      Boolean(blockedRevision?.blockedByDecisionId) &&
      revisionQueues.filter((item) => item.status === "queued").length === 0 &&
      projection.decisions.length === 1 &&
      campaignSummary?.health === "needs_owner_decision",
    evidence: `blocked=${blockedRevision?.id ?? "none"}, decisions=${projection.decisions.length}, health=${campaignSummary?.health ?? "none"}`
  };
}

function reviewOwnerDecisionFlow(): ReviewItem {
  const config = createReviewConfig();
  const context = initializeDatabase(config);
  const campaign = createReviewCampaign(context, config, "Phase 5 대표 결정 감지 캠페인");
  const artifactId = createReviewArtifact(context, config, campaign.id, {
    id: "artifact-phase5-owner-decision",
    displayNumber: 1,
    title: "대표 결정 필요 산출물",
    content: "# 대표 결정 필요 산출물\n\n[OWNER_DECISION]\n\n비용 확정 필요 항목이 있습니다."
  });

  enqueueReview(context, campaign.id, "queue-phase5-owner-review", [artifactId]);
  const reviewRun = runNextQueueItem(context.db, config, campaign.id);
  const projection = getCampaignProjection(context.db, campaign.id);
  const artifact = projection.artifacts.find((item) => item.id === artifactId);
  const detail = getArtifactDetail(context.db, config, artifactId);

  context.db.close();

  return {
    ticket: "V2-5-05",
    label: "대표 결정 감지",
    passed:
      reviewRun.queueItem?.status === "blocked" &&
      Boolean(reviewRun.queueItem?.blockedByDecisionId) &&
      artifact?.status === "blocked" &&
      projection.decisions[0]?.blocks.includes(artifactId) &&
      detail.review.includes("판정: 대표 결정 필요"),
    evidence: `queue=${reviewRun.queueItem?.status ?? "none"}, artifact=${artifact?.status ?? "none"}, decisions=${projection.decisions.length}`
  };
}

const reviewItems: ReviewItem[] = [
  ...reviewApprovalFlow(),
  reviewRevisionFlow(),
  reviewRepeatLimitFlow(),
  reviewOwnerDecisionFlow()
];

for (const item of reviewItems) {
  const marker = item.passed ? "PASS" : "FAIL";
  console.log(`[${marker}] ${item.ticket} ${item.label}`);
  console.log(`       ${item.evidence}`);
}

const failed = reviewItems.filter((item) => !item.passed);

if (failed.length > 0) {
  console.error(`Phase 5 review failed: ${failed.length} item(s) need attention.`);
  process.exitCode = 1;
} else {
  console.log("Phase 5 review passed.");
}
