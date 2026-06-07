import path from "node:path";
import type { AppConfig } from "../src/server/config.js";
import { initializeDatabase } from "../src/server/storage/db.js";
import { createCampaign, listCampaigns } from "../src/server/services/campaign-service.js";
import { sendOwnerMessage } from "../src/server/services/conversation-service.js";
import { listDivisions } from "../src/server/services/division-service.js";
import { getCampaignProjection } from "../src/server/services/graph-service.js";
import { requestArtifactRevision } from "../src/server/services/revision-service.js";
import { runNextQueueItem, syncQueueForCampaign } from "../src/server/services/queue-service.js";
import { generateCampaignHandoffReport } from "../src/server/services/report-service.js";
import { createId } from "../src/server/services/ids.js";
import { approveTeamProposal } from "../src/server/services/team-proposal-service.js";

const demoTitle = "데모: 콘텐츠 제작 캠페인";

function readArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }

  return null;
}

function createConfig(): AppConfig {
  const rootDir = process.cwd();
  const dataDir = path.resolve(readArg("--data-dir") ?? process.env.DATA_DIR ?? path.join(rootDir, "data-sample"));

  return {
    rootDir,
    port: Number.parseInt(process.env.PORT ?? "8788", 10),
    dataDir,
    dbPath: path.join(dataDir, "local-company.sqlite"),
    nodeEnv: "demo"
  };
}

function hasDecision(context: ReturnType<typeof initializeDatabase>, campaignId: string, title: string): boolean {
  const row = context.db
    .prepare("SELECT id FROM decisions WHERE campaign_id = ? AND title = ?")
    .get(campaignId, title);

  return Boolean(row);
}

function insertDemoDecision(context: ReturnType<typeof initializeDatabase>, campaignId: string, artifactId: string): void {
  const title = "데모 예산 승인 필요";
  if (hasDecision(context, campaignId, title)) {
    return;
  }

  const decisionId = createId("decision");
  const reason = "콘텐츠를 공개하기 전에 예산과 외부 공개 범위를 대표가 확인해야 합니다.";

  context.db
    .prepare(
      `INSERT INTO decisions (
        id,
        campaign_id,
        title,
        reason,
        options,
        recommended_option,
        status,
        blocks
      )
      VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`
    )
    .run(
      decisionId,
      campaignId,
      title,
      reason,
      JSON.stringify(["예산 30만원 안에서 진행", "외부 공개 전 한 번 더 검토"]),
      "외부 공개 전 한 번 더 검토",
      JSON.stringify([artifactId])
    );

  context.db
    .prepare(
      `INSERT INTO graph_nodes (id, campaign_id, type, title, status, summary)
       VALUES (?, ?, 'decision', ?, 'open', ?)`
    )
    .run(decisionId, campaignId, title, reason);

  context.db
    .prepare(
      `INSERT INTO graph_edges (id, campaign_id, from_node_id, to_node_id, relation)
       VALUES (?, ?, ?, ?, 'blocks')`
    )
    .run(createId("edge"), campaignId, decisionId, artifactId);
}

function runQueuedWork(context: ReturnType<typeof initializeDatabase>, config: AppConfig, campaignId: string, maxRuns = 4): void {
  for (let index = 0; index < maxRuns; index += 1) {
    const projection = getCampaignProjection(context.db, campaignId);
    if (!projection.queueItems.some((item) => item.status === "queued")) {
      return;
    }

    runNextQueueItem(context.db, config, campaignId);
  }
}

function approveDemoTeamProposal(context: ReturnType<typeof initializeDatabase>, campaignId: string): void {
  const proposal = getCampaignProjection(context.db, campaignId).teamProposals.find((item) => item.status === "pending");
  if (!proposal) {
    return;
  }

  approveTeamProposal(context.db, proposal.id);
  syncQueueForCampaign(context.db, campaignId);
}

function ensureDemoCampaign(context: ReturnType<typeof initializeDatabase>, config: AppConfig): string {
  const existing = listCampaigns(context.db).find((campaign) => campaign.title === demoTitle);
  if (existing) {
    return existing.id;
  }

  const division = listDivisions(context.db)[0];
  const campaign = createCampaign(context.db, config, {
    divisionId: division.id,
    title: demoTitle,
    summary: "개인정보 없는 샘플 캠페인입니다. PM 대화, 작업 큐, 산출물, 결정함, 인계 보고서를 확인할 수 있습니다."
  });

  sendOwnerMessage(
    context.db,
    config,
    campaign.id,
    "개인정보가 없는 콘텐츠 제작 캠페인을 목표, 작업, 산출물로 나누고 첫 실행 계획을 만들어주세요."
  );

  approveDemoTeamProposal(context, campaign.id);
  runQueuedWork(context, config, campaign.id, 2);

  const projection = getCampaignProjection(context.db, campaign.id);
  const firstArtifact = projection.artifacts[0];
  if (firstArtifact) {
    requestArtifactRevision(context.db, firstArtifact.id, {
      instruction: "데모 사용자가 흐름을 이해하기 쉽도록 문장을 더 짧고 명확하게 다듬어주세요."
    });
    runQueuedWork(context, config, campaign.id, 2);
    insertDemoDecision(context, campaign.id, firstArtifact.id);
  }

  return campaign.id;
}

const config = createConfig();
const context = initializeDatabase(config);

try {
  const campaignId = ensureDemoCampaign(context, config);
  const report = generateCampaignHandoffReport(context.db, config, campaignId);
  const projection = getCampaignProjection(context.db, campaignId);

  console.log("Demo data is ready.");
  console.log(`DATA_DIR=${config.dataDir}`);
  console.log(`Campaign=${campaignId}`);
  console.log(`Artifacts=${projection.artifacts.length}`);
  console.log(`Open decisions=${projection.decisions.filter((decision) => decision.status === "open").length}`);
  console.log(`Reports=${report.files.map((file) => file.relativePath).join(", ")}`);
} finally {
  context.db.close();
}
