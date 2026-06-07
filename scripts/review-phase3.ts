import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AppConfig } from "../src/server/config.js";
import { initializeDatabase } from "../src/server/storage/db.js";
import { createCampaign } from "../src/server/services/campaign-service.js";
import { listDivisions } from "../src/server/services/division-service.js";
import { sendOwnerMessage } from "../src/server/services/conversation-service.js";
import {
  createArtifactVersion,
  getArtifactDetail,
  listArtifacts,
  renderArtifactViewerHtml
} from "../src/server/services/artifact-service.js";

interface ReviewItem {
  ticket: string;
  label: string;
  passed: boolean;
  evidence: string;
}

function createReviewConfig(): AppConfig {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "local-company-v2-phase3-"));
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
  title: "Phase 3 리뷰 캠페인",
  summary: "산출물 저장소와 뷰어를 검증한다."
});

sendOwnerMessage(context.db, config, campaign.id, "산출물 저장소 검증용 실행 계획을 만들어주세요.");
const artifact = listArtifacts(context.db, campaign.id)[0];
const initialDetail = getArtifactDetail(context.db, config, artifact.id);
const manifestPath = path.join(
  config.dataDir,
  "divisions",
  division.id,
  "campaigns",
  campaign.id,
  "artifacts",
  artifact.id,
  "manifest.json"
);
const secondVersion = createArtifactVersion(context.db, config, {
  artifactId: artifact.id,
  createdBy: "리뷰 스크립트",
  content: "# Phase 3 HTML/Markdown 검증\n\n| 항목 | 상태 |\n| --- | --- |\n| Markdown | 통과 |",
  review: "Markdown 표 렌더링을 검증합니다."
});
const updatedDetail = getArtifactDetail(context.db, config, artifact.id);
const viewerHtml = renderArtifactViewerHtml(updatedDetail);
const htmlArtifactId = "artifact-html-review";
context.db
  .prepare(
    `INSERT INTO artifacts (id, campaign_id, display_number, title, kind, status, linked_task_ids)
     VALUES (?, ?, 99, 'HTML 산출물 검증', 'html', 'draft', '[]')`
  )
  .run(htmlArtifactId, campaign.id);
createArtifactVersion(context.db, config, {
  artifactId: htmlArtifactId,
  createdBy: "리뷰 스크립트",
  content: "<main><h1>HTML 산출물 검증</h1></main>",
  review: "HTML 산출물 iframe 뷰어를 검증합니다."
});
const htmlDetail = getArtifactDetail(context.db, config, htmlArtifactId);
const htmlViewer = renderArtifactViewerHtml(htmlDetail);
const artifacts = listArtifacts(context.db, campaign.id);

const reviewItems: ReviewItem[] = [
  {
    ticket: "V2-3-01",
    label: "산출물 manifest 생성",
    passed: fs.existsSync(manifestPath) && JSON.parse(fs.readFileSync(manifestPath, "utf8")).id === artifact.id,
    evidence: manifestPath
  },
  {
    ticket: "V2-3-02",
    label: "산출물 버전 저장",
    passed: initialDetail.currentVersion?.version === "v001" && secondVersion.version === "v002",
    evidence: `versions=${updatedDetail.versions.map((version) => version.version).join(", ")}`
  },
  {
    ticket: "V2-3-03",
    label: "Markdown 뷰어",
    passed: viewerHtml.includes("<article") && viewerHtml.includes("<table>"),
    evidence: "viewer HTML renders Markdown document content"
  },
  {
    ticket: "V2-3-04",
    label: "HTML 산출물 지원",
    passed: htmlViewer.includes("html-frame") && htmlDetail.viewUrl.includes(`/artifacts/${htmlArtifactId}/view`),
    evidence: htmlDetail.viewUrl
  },
  {
    ticket: "V2-3-05",
    label: "산출물 목록 UI",
    passed: artifacts.length >= 2 && artifacts.some((item) => item.id === artifact.id && item.currentVersion === "v002"),
    evidence: `artifacts=${artifacts.length}, currentVersion=${updatedDetail.currentVersion?.version ?? "none"}`
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
  console.error(`Phase 3 review failed: ${failed.length} item(s) need attention.`);
  process.exitCode = 1;
} else {
  console.log("Phase 3 review passed.");
}
