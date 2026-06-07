import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AppConfig } from "../src/server/config.js";
import { initializeDatabase } from "../src/server/storage/db.js";
import { createCampaign, listCampaigns } from "../src/server/services/campaign-service.js";
import { listDivisions, listWorkers } from "../src/server/services/division-service.js";
import { listMessages, sendOwnerMessage } from "../src/server/services/conversation-service.js";

interface ReviewItem {
  ticket: string;
  label: string;
  passed: boolean;
  evidence: string;
}

function createReviewConfig(): AppConfig {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "local-company-v2-phase1-"));
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
const divisions = listDivisions(context.db);
const workers = listWorkers(context.db);
const division = divisions[0];
const campaign = createCampaign(context.db, config, {
  divisionId: division.id,
  title: "Phase 1 리뷰 캠페인",
  summary: "캠페인 생성과 PM 대화 저장을 검증한다."
});
const campaigns = listCampaigns(context.db);
const messages = sendOwnerMessage(context.db, config, campaign.id, "캠페인의 첫 목표를 정리해주세요.");
const conversationPath = path.join(
  config.dataDir,
  "divisions",
  division.id,
  "campaigns",
  campaign.id,
  "conversations",
  "pm",
  "conversation.md"
);

const reviewItems: ReviewItem[] = [
  {
    ticket: "V2-1-01",
    label: "사업부 생성/조회",
    passed: divisions.length >= 1 && workers.length >= 1,
    evidence: `divisions=${divisions.length}, workers=${workers.length}`
  },
  {
    ticket: "V2-1-02",
    label: "캠페인 생성",
    passed: campaigns.some((item) => item.id === campaign.id),
    evidence: campaign.id
  },
  {
    ticket: "V2-1-03",
    label: "PM 생성/배정",
    passed: Boolean(campaign.pmWorkerId && campaign.pmName),
    evidence: `${campaign.pmName ?? "none"} (${campaign.pmWorkerId ?? "none"})`
  },
  {
    ticket: "V2-1-04",
    label: "PM 대화 저장",
    passed: fs.existsSync(conversationPath) && listMessages(context.db, campaign.id).length === 2,
    evidence: conversationPath
  },
  {
    ticket: "V2-1-05",
    label: "PM 답변 실행",
    passed: messages.some((message) => message.role === "pm" && message.content.includes("대표님")),
    evidence: "mock PM response saved"
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
  console.error(`Phase 1 review failed: ${failed.length} item(s) need attention.`);
  process.exitCode = 1;
} else {
  console.log("Phase 1 review passed.");
}
