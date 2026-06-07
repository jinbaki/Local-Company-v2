import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AppConfig } from "../src/server/config.js";
import { initializeDatabase } from "../src/server/storage/db.js";
import { createCampaign, updateCampaignStatus } from "../src/server/services/campaign-service.js";
import { listDivisions } from "../src/server/services/division-service.js";
import { createArtifactVersion } from "../src/server/services/artifact-service.js";
import { requestArtifactRevision } from "../src/server/services/revision-service.js";
import { generateCampaignHandoffReport } from "../src/server/services/report-service.js";

interface ReviewItem {
  ticket: string;
  label: string;
  passed: boolean;
  evidence: string;
}

function createReviewConfig(): AppConfig {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "local-company-v2-phase8-"));
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
    title: "Phase 8 인계 보고서 캠페인",
    summary: "사람 TODO와 다음 AI 작업을 분리합니다."
  });
}

function createReviewArtifact(context: ReturnType<typeof initializeDatabase>, config: AppConfig, campaignId: string): string {
  const artifactId = "artifact-phase8-handoff";

  context.db
    .prepare(
      `INSERT INTO artifacts (id, campaign_id, display_number, title, kind, status, linked_task_ids)
       VALUES (?, ?, 1, '외부 사실 확인 산출물', 'markdown', 'in_review', '[]')`
    )
    .run(artifactId, campaignId);

  context.db
    .prepare(
      `INSERT INTO graph_nodes (id, campaign_id, type, title, status, summary)
       VALUES (?, ?, 'artifact', '외부 사실 확인 산출물', 'in_review', 'PM 리뷰 대기')`
    )
    .run(artifactId, campaignId);

  createArtifactVersion(context.db, config, {
    artifactId,
    createdBy: "리뷰 스크립트",
    content: "# 외부 사실 확인 산출물\n\nEXTERNAL_CHECK: 실제 비용 기준 확인 필요.",
    review: "PM 리뷰 대기 상태입니다.\n"
  });

  return artifactId;
}

function createOpenDecision(context: ReturnType<typeof initializeDatabase>, campaignId: string, artifactId: string): void {
  context.db
    .prepare(
      `INSERT INTO decisions (id, campaign_id, title, reason, options, recommended_option, status, blocks)
       VALUES ('decision-phase8-owner', ?, '대표 승인 필요', '예산과 외부 연락 범위 확인 필요', ?, '승인', 'open', ?)`
    )
    .run(campaignId, JSON.stringify(["승인", "보류"]), JSON.stringify([artifactId]));
}

function reviewHandoffReports(): ReviewItem[] {
  const config = createReviewConfig();
  const context = initializeDatabase(config);
  const campaign = createReviewCampaign(context, config);
  const artifactId = createReviewArtifact(context, config, campaign.id);
  createOpenDecision(context, campaign.id, artifactId);
  requestArtifactRevision(context.db, artifactId, {
    instruction: "대표 피드백을 반영해 문장을 더 명확하게 수정해주세요."
  });

  const report = generateCampaignHandoffReport(context.db, config, campaign.id);
  const humanTodoFile = report.files.find((file) => file.kind === "human_todos");
  const campaignStatusFile = report.files.find((file) => file.kind === "campaign_status");
  const ownerBriefFile = report.files.find((file) => file.kind === "owner_brief");
  const humanTodoText = humanTodoFile ? fs.readFileSync(humanTodoFile.path, "utf8") : "";
  const campaignStatusText = campaignStatusFile ? fs.readFileSync(campaignStatusFile.path, "utf8") : "";
  const ownerBriefText = ownerBriefFile ? fs.readFileSync(ownerBriefFile.path, "utf8") : "";
  const appSource = fs.readFileSync(path.join(process.cwd(), "src/client/App.tsx"), "utf8");

  const reviewItems: ReviewItem[] = [
    {
      ticket: "V2-8-01",
      label: "사람 TODO 추출",
      passed:
        report.humanTodoCount >= 2 &&
        Boolean(humanTodoFile && fs.existsSync(humanTodoFile.path)) &&
        humanTodoText.includes("대표 승인 필요") &&
        (humanTodoText.includes("외부 확인 대상") || humanTodoText.includes("외부 사실 확인")),
      evidence: `humanTodos=${report.humanTodoCount}, file=${humanTodoFile?.relativePath ?? "none"}`
    },
    {
      ticket: "V2-8-02",
      label: "다음 AI 작업 추출",
      passed:
        report.nextAiTaskCount >= 1 &&
        report.nextAiTasks.some((item) => item.sourceType === "queue" && item.status === "queued") &&
        campaignStatusText.includes("다음 AI 작업"),
      evidence: `nextAiTasks=${report.nextAiTaskCount}`
    },
    {
      ticket: "V2-8-03",
      label: "종합 보고서",
      passed:
        Boolean(campaignStatusFile && fs.existsSync(campaignStatusFile.path)) &&
        Boolean(ownerBriefFile && fs.existsSync(ownerBriefFile.path)) &&
        campaignStatusText.includes("캠페인 상태") &&
        ownerBriefText.includes("대표 브리프") &&
        appSource.includes("generateHandoffReport") &&
        appSource.includes("인계 보고서"),
      evidence: `files=${report.files.map((file) => file.relativePath).join(", ")}`
    }
  ];

  const done = updateCampaignStatus(context.db, campaign.id, { status: "done" });
  reviewItems.push({
    ticket: "V2-8-04",
    label: "캠페인 완료 처리",
    passed: done.status === "done" && appSource.includes("completeCampaign") && appSource.includes("캠페인 완료"),
    evidence: `done=${done.status}`
  });

  context.db.close();
  return reviewItems;
}

const reviewItems = reviewHandoffReports();

for (const item of reviewItems) {
  const marker = item.passed ? "PASS" : "FAIL";
  console.log(`[${marker}] ${item.ticket} ${item.label}`);
  console.log(`       ${item.evidence}`);
}

const failed = reviewItems.filter((item) => !item.passed);

if (failed.length > 0) {
  console.error(`Phase 8 review failed: ${failed.length} item(s) need attention.`);
  process.exitCode = 1;
} else {
  console.log("Phase 8 review passed.");
}
