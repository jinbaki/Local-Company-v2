import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AppConfig } from "../src/server/config.js";
import { initializeDatabase } from "../src/server/storage/db.js";
import { createCampaign } from "../src/server/services/campaign-service.js";
import { listDivisions, listWorkers } from "../src/server/services/division-service.js";
import { sendOwnerMessage } from "../src/server/services/conversation-service.js";
import { getCampaignProjection } from "../src/server/services/graph-service.js";
import { getArtifactDetail } from "../src/server/services/artifact-service.js";
import { runNextQueueItem } from "../src/server/services/queue-service.js";
import { assignWorkerToCampaign, createWorker, startWorkerSession } from "../src/server/services/worker-service.js";

interface ReviewItem {
  ticket: string;
  label: string;
  passed: boolean;
  evidence: string;
}

function createReviewConfig(): AppConfig {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "local-company-v2-phase4-"));
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
const customWorker = createWorker(context.db, {
  divisionId: division.id,
  name: "콘텐츠 담당",
  position: "콘텐츠 기획 담당"
});
const campaign = createCampaign(context.db, config, {
  divisionId: division.id,
  title: "Phase 4 리뷰 캠페인",
  summary: "직원과 작업 큐를 검증한다."
});
const assigned = assignWorkerToCampaign(context.db, campaign.id, {
  workerId: customWorker.id,
  role: "콘텐츠 기획"
});
const session = startWorkerSession(context.db, campaign.id, customWorker.id);

sendOwnerMessage(context.db, config, campaign.id, "직원 실행 큐 검증용 산출물을 만들어주세요.");
const beforeRun = getCampaignProjection(context.db, campaign.id);
const run = runNextQueueItem(context.db, config, campaign.id);
const afterRun = getCampaignProjection(context.db, campaign.id);
const artifact = afterRun.artifacts[0];
const detail = getArtifactDetail(context.db, config, artifact.id);
const workers = listWorkers(context.db);

const reviewItems: ReviewItem[] = [
  {
    ticket: "V2-4-01",
    label: "직원 모델 구현",
    passed: workers.length >= 3 && workers.some((worker) => worker.id === customWorker.id),
    evidence: `workers=${workers.length}, created=${customWorker.name}`
  },
  {
    ticket: "V2-4-02",
    label: "캠페인 직원 배정",
    passed: assigned.workerId === customWorker.id && beforeRun.assignedWorkers.length >= 1,
    evidence: `assigned=${assigned.name}, role=${assigned.role}`
  },
  {
    ticket: "V2-4-03",
    label: "직원 세션 시작",
    passed: session.sessionStatus === "ready" && Boolean(session.sessionId),
    evidence: `session=${session.sessionId ?? "none"}`
  },
  {
    ticket: "V2-4-04",
    label: "작업 큐 생성",
    passed: beforeRun.queueItems.some((item) => item.status === "queued" && item.type === "worker_run"),
    evidence: `queueItems=${beforeRun.queueItems.length}`
  },
  {
    ticket: "V2-4-05",
    label: "큐 실행",
    passed: run.queueItem?.status === "done" && detail.currentVersion?.version === "v002" && detail.content.includes("작업 결과"),
    evidence: `queue=${run.queueItem?.id ?? "none"}, artifactVersion=${detail.currentVersion?.version ?? "none"}`
  },
  {
    ticket: "V2-4-06",
    label: "실행 상태판",
    passed:
      afterRun.queueItems.some((item) => item.status === "done") &&
      afterRun.assignedWorkers.some((worker) => worker.sessionStatus === "ready") &&
      afterRun.artifacts.some((item) => item.status === "in_review"),
    evidence: `queue=${afterRun.queueItems[0]?.status ?? "none"}, artifact=${afterRun.artifacts[0]?.status ?? "none"}`
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
  console.error(`Phase 4 review failed: ${failed.length} item(s) need attention.`);
  process.exitCode = 1;
} else {
  console.log("Phase 4 review passed.");
}
