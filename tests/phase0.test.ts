import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AppConfig } from "../src/server/config.js";
import { ensureCampaignFolders, ensureDataRoot, ensureDivisionFolders } from "../src/server/storage/file-store.js";
import { getDatabaseSummary, initializeDatabase } from "../src/server/storage/db.js";
import { createCampaign, listCampaigns, updateCampaignStatus } from "../src/server/services/campaign-service.js";
import { createDivision, listDivisions, listWorkers, updateDivision } from "../src/server/services/division-service.js";
import { deleteCampaign, deleteDivision } from "../src/server/services/delete-service.js";
import { listMessages, sendOwnerMessage } from "../src/server/services/conversation-service.js";
import { getCampaignProjection } from "../src/server/services/graph-service.js";
import { validatePmActions } from "../src/server/services/pm-action-service.js";
import { createArtifactVersion, getArtifactDetail, listArtifacts, renderArtifactViewerHtml } from "../src/server/services/artifact-service.js";
import { listQueueItems, runNextQueueItem, syncQueueForCampaign } from "../src/server/services/queue-service.js";
import { assignWorkerToCampaign, createWorker, startWorkerSession } from "../src/server/services/worker-service.js";
import { answerDecision, getDecision, listDecisions } from "../src/server/services/decision-service.js";
import { requestArtifactRevision } from "../src/server/services/revision-service.js";
import { generateCampaignHandoffReport } from "../src/server/services/report-service.js";
import { createPmReply, createWorkerArtifactContent, reviewArtifactWithPm } from "../src/server/services/agent-runner.js";
import { approveTeamProposal } from "../src/server/services/team-proposal-service.js";
import { createCampaignReference, listCampaignReferences, renderReferenceContext } from "../src/server/services/reference-service.js";
import { checkCodexConnection } from "../src/server/services/runner-settings-service.js";

function createTestConfig(): AppConfig {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "local-company-v2-"));
  const dataDir = path.join(rootDir, "data");

  return {
    rootDir,
    port: 8788,
    dataDir,
    dbPath: path.join(dataDir, "local-company.sqlite"),
    nodeEnv: "test"
  };
}

function createFakeCodexCommand(rootDir: string, response: string): string {
  const scriptPath = path.join(rootDir, "fake-codex.js");
  fs.writeFileSync(
    scriptPath,
    [
      "const fs = require('node:fs');",
      "const args = process.argv.slice(2);",
      "const response = " + JSON.stringify(response) + ";",
      "const outputIndex = args.findIndex((arg) => arg === '--output-last-message' || arg === '-o');",
      "if (outputIndex >= 0 && args[outputIndex + 1]) {",
      "  fs.writeFileSync(args[outputIndex + 1], response, 'utf8');",
      "} else {",
      "  process.stdout.write(response);",
      "}"
    ].join("\n"),
    "utf8"
  );

  if (process.platform === "win32") {
    const commandPath = path.join(rootDir, "fake-codex.cmd");
    fs.writeFileSync(commandPath, `@echo off\r\n"${process.execPath}" "%~dp0fake-codex.js" %*\r\n`, "utf8");
    return commandPath;
  }

  const commandPath = path.join(rootDir, "fake-codex");
  fs.writeFileSync(commandPath, `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/fake-codex.js" "$@"\n`, "utf8");
  fs.chmodSync(commandPath, 0o755);
  return commandPath;
}

function createFakeCodexStatusCommand(rootDir: string): string {
  const scriptPath = path.join(rootDir, "fake-codex-status.js");
  fs.writeFileSync(
    scriptPath,
    [
      "const args = process.argv.slice(2);",
      "if (args.includes('--version')) {",
      "  process.stdout.write('codex-cli 0.135.0');",
      "  process.exit(0);",
      "}",
      "if (args[0] === 'login' && args[1] === 'status') {",
      "  process.stdout.write('Logged in using ChatGPT');",
      "  process.exit(0);",
      "}",
      "if (args[0] === 'doctor' && args.includes('--json')) {",
      "  process.stdout.write(JSON.stringify({ checks: { 'auth.credentials': { status: 'ok', summary: 'auth is configured' }, 'network.websocket_reachability': { status: 'ok', summary: 'Responses WebSocket handshake succeeded' } } }));",
      "  process.exit(0);",
      "}",
      "process.stdout.write('ok');"
    ].join("\n"),
    "utf8"
  );

  if (process.platform === "win32") {
    const commandPath = path.join(rootDir, "fake-codex-status.cmd");
    fs.writeFileSync(commandPath, `@echo off\r\n"${process.execPath}" "%~dp0fake-codex-status.js" %*\r\n`, "utf8");
    return commandPath;
  }

  const commandPath = path.join(rootDir, "fake-codex-status");
  fs.writeFileSync(commandPath, `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/fake-codex-status.js" "$@"\n`, "utf8");
  fs.chmodSync(commandPath, 0o755);
  return commandPath;
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
    createdBy: "테스트",
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
  expect(proposal).toBeTruthy();
  approveTeamProposal(context.db, proposal?.id ?? "");
  syncQueueForCampaign(context.db, campaignId);
}

describe("Phase 0 foundation", () => {
  it("creates the data root folders", () => {
    const config = createTestConfig();
    const folders = ensureDataRoot(config);

    expect(folders.every((folder) => folder.exists)).toBe(true);
    expect(fs.existsSync(path.join(config.dataDir, "divisions"))).toBe(true);
    expect(fs.existsSync(path.join(config.dataDir, "system"))).toBe(true);
  });

  it("creates division and campaign folder structures", () => {
    const config = createTestConfig();
    const divisionFolders = ensureDivisionFolders(config, "division-test");
    const campaignFolders = ensureCampaignFolders(config, "division-test", "campaign-test");

    expect(divisionFolders.every((folder) => folder.exists)).toBe(true);
    expect(campaignFolders.every((folder) => folder.exists)).toBe(true);
    expect(
      fs.existsSync(
        path.join(config.dataDir, "divisions", "division-test", "campaigns", "campaign-test", "artifacts")
      )
    ).toBe(true);
  });

  it("creates selectable business divisions with their own PM lead", () => {
    const config = createTestConfig();
    const context = initializeDatabase(config);
    const division = createDivision(context.db, config, {
      name: "공개버전 사업부",
      folderName: "public-division",
      description: "공개버전 검증용 사업부",
      leadWorkerName: "공개 PM"
    });
    const campaign = createCampaign(context.db, config, {
      divisionId: division.id,
      title: "사업부별 캠페인"
    });
    const divisions = listDivisions(context.db);

    expect(divisions.some((item) => item.id === division.id)).toBe(true);
    expect(division.folderName).toBe("public-division");
    expect(division.leadWorkerName).toBe("공개 PM");
    expect(campaign.divisionId).toBe(division.id);
    expect(campaign.pmName).toBe("공개 PM");
    expect(fs.existsSync(path.join(config.dataDir, "divisions", "public-division"))).toBe(true);

    context.db.close();
  });

  it("updates business division display information and PM lead name", () => {
    const config = createTestConfig();
    const context = initializeDatabase(config);
    const division = createDivision(context.db, config, {
      name: "수정 전 사업부",
      folderName: "editable-division",
      description: "수정 전 설명",
      leadWorkerName: "수정 전 PM"
    });
    const updated = updateDivision(context.db, division.id, {
      name: "수정 후 사업부",
      description: "수정 후 설명",
      leadWorkerName: "수정 후 PM"
    });
    const campaign = createCampaign(context.db, config, {
      divisionId: division.id,
      title: "수정 확인 캠페인"
    });

    expect(updated.name).toBe("수정 후 사업부");
    expect(updated.description).toBe("수정 후 설명");
    expect(updated.leadWorkerName).toBe("수정 후 PM");
    expect(updated.folderName).toBe("editable-division");
    expect(campaign.pmName).toBe("수정 후 PM");

    context.db.close();
  });

  it("uses Korean-style names for the default division workers", () => {
    const config = createTestConfig();
    const context = initializeDatabase(config);
    const workers = listWorkers(context.db);

    expect(workers.some((worker) => worker.id === "worker-default-pm" && worker.name === "김하늘")).toBe(true);
    expect(workers.some((worker) => worker.id === "worker-default-execution" && worker.name === "박도현")).toBe(true);

    context.db.close();
  });

  it("deletes a campaign with its local folder and related records", () => {
    const config = createTestConfig();
    const context = initializeDatabase(config);
    const division = listDivisions(context.db)[0];
    const campaign = createCampaign(context.db, config, {
      divisionId: division.id,
      title: "삭제 확인 캠페인"
    });
    const campaignFolder = path.join(config.dataDir, "divisions", division.id, "campaigns", campaign.id);

    expect(fs.existsSync(campaignFolder)).toBe(true);

    const deleted = deleteCampaign(context.db, config, campaign.id);

    expect(deleted.campaignId).toBe(campaign.id);
    expect(listCampaigns(context.db).some((item) => item.id === campaign.id)).toBe(false);
    expect(fs.existsSync(campaignFolder)).toBe(false);

    context.db.close();
  });

  it("deletes a non-default division with campaigns, workers, and local folder", () => {
    const config = createTestConfig();
    const context = initializeDatabase(config);
    const division = createDivision(context.db, config, {
      name: "삭제 확인 사업부",
      folderName: "delete-division",
      leadWorkerName: "한지민"
    });
    const campaign = createCampaign(context.db, config, {
      divisionId: division.id,
      title: "사업부 삭제 포함 캠페인"
    });
    const divisionFolder = path.join(config.dataDir, "divisions", division.id);

    expect(fs.existsSync(divisionFolder)).toBe(true);

    const deleted = deleteDivision(context.db, config, division.id);

    expect(deleted.divisionId).toBe(division.id);
    expect(deleted.deletedCampaignCount).toBe(1);
    expect(listDivisions(context.db).some((item) => item.id === division.id)).toBe(false);
    expect(listCampaigns(context.db).some((item) => item.id === campaign.id)).toBe(false);
    expect(listWorkers(context.db).some((worker) => worker.divisionId === division.id)).toBe(false);
    expect(fs.existsSync(divisionFolder)).toBe(false);

    context.db.close();
  });

  it("keeps the default division from being deleted", () => {
    const config = createTestConfig();
    const context = initializeDatabase(config);

    expect(() => deleteDivision(context.db, config, "division-default")).toThrow("기본 사업부는 삭제할 수 없습니다.");

    context.db.close();
  });

  it("initializes SQLite with the base schema", () => {
    const config = createTestConfig();
    const context = initializeDatabase(config);
    const summary = getDatabaseSummary(context.db);

    expect(fs.existsSync(config.dbPath)).toBe(true);
    expect(summary.migrations).toContain("001_initial_schema");
    expect(summary.tableCount).toBeGreaterThanOrEqual(16);

    context.db.close();
  });

  it("supports the Phase 1 campaign and PM chat flow", () => {
    const config = createTestConfig();
    const context = initializeDatabase(config);
    const division = listDivisions(context.db)[0];
    const workers = listWorkers(context.db);
    const campaign = createCampaign(context.db, config, {
      divisionId: division.id,
      title: "테스트 캠페인",
      summary: "PM 대화 저장 흐름을 검증한다."
    });

    const messages = sendOwnerMessage(context.db, config, campaign.id, "목표를 실행 가능한 업무로 정리해주세요.");
    const campaigns = listCampaigns(context.db);

    expect(workers.length).toBeGreaterThanOrEqual(1);
    expect(campaigns.some((item) => item.id === campaign.id)).toBe(true);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("owner");
    expect(messages[1].role).toBe("pm");
    expect(listMessages(context.db, campaign.id)).toHaveLength(2);
    expect(
      fs.existsSync(
        path.join(
          config.dataDir,
          "divisions",
          division.id,
          "campaigns",
          campaign.id,
          "conversations",
          "pm",
          "conversation.md"
        )
      )
    ).toBe(true);

    context.db.close();
  });

  it("stores campaign references for PM context", () => {
    const config = createTestConfig();
    const context = initializeDatabase(config);
    const division = listDivisions(context.db)[0];
    const campaign = createCampaign(context.db, config, {
      divisionId: division.id,
      title: "참고자료 테스트"
    });

    const response = createCampaignReference(context.db, config, campaign.id, {
      title: "제품 소개 핵심 메모",
      kind: "note",
      content: "PM은 이 캠페인에서 쉬운 설명과 첫 초안을 우선해야 한다."
    });
    const references = listCampaignReferences(context.db, campaign.id);
    const referenceContext = renderReferenceContext(context.db, campaign.id);

    expect(response.reference.title).toBe("제품 소개 핵심 메모");
    expect(references).toHaveLength(1);
    expect(fs.existsSync(response.reference.filePath)).toBe(true);
    expect(referenceContext).toContain("제품 소개 핵심 메모");
    expect(referenceContext).toContain("쉬운 설명");

    context.db.close();
  });

  it("uploads campaign reference files into source materials", () => {
    const config = createTestConfig();
    const context = initializeDatabase(config);
    const division = listDivisions(context.db)[0];
    const campaign = createCampaign(context.db, config, {
      divisionId: division.id,
      title: "참고자료 파일 테스트"
    });
    const fileContent = "업로드한 파일의 핵심 참고 내용입니다.";

    const response = createCampaignReference(context.db, config, campaign.id, {
      title: "업로드 참고 파일",
      kind: "file",
      fileName: "reference-note.txt",
      fileMimeType: "text/plain",
      fileBase64: Buffer.from(fileContent, "utf8").toString("base64")
    });

    expect(response.reference.source).toContain("source-materials");
    expect(response.reference.source).toContain("reference-note.txt");
    expect(fs.readFileSync(response.reference.source, "utf8")).toBe(fileContent);
    expect(response.reference.content).toContain("업로드한 파일");
    expect(renderReferenceContext(context.db, campaign.id)).toContain("업로드 참고 파일");

    context.db.close();
  });

  it("extracts safe PM actions into the work graph projection", () => {
    const config = createTestConfig();
    const context = initializeDatabase(config);
    const division = listDivisions(context.db)[0];
    const campaign = createCampaign(context.db, config, {
      divisionId: division.id,
      title: "업무 그래프 테스트",
      summary: "PM 액션 반영을 검증한다."
    });

    sendOwnerMessage(context.db, config, campaign.id, "콘텐츠 제작 목표를 업무와 산출물로 쪼개주세요.");
    const projection = getCampaignProjection(context.db, campaign.id);

    expect(projection.goals.length).toBeGreaterThanOrEqual(1);
    expect(projection.tasks.length).toBeGreaterThanOrEqual(1);
    expect(projection.artifacts.length).toBeGreaterThanOrEqual(1);
    expect(projection.edges.some((edge) => edge.relation === "contains")).toBe(true);
    expect(projection.edges.some((edge) => edge.relation === "produces")).toBe(true);

    context.db.close();
  });

  it("stores PM team proposals and approves them into campaign workers", () => {
    const config = createTestConfig();
    const context = initializeDatabase(config);
    const division = listDivisions(context.db)[0];
    const campaign = createCampaign(context.db, config, {
      divisionId: division.id,
      title: "PM 팀 제안 테스트"
    });

    sendOwnerMessage(context.db, config, campaign.id, "PM이 필요한 팀을 제안하고 산출물 초안을 진행해주세요.");

    const beforeApproval = getCampaignProjection(context.db, campaign.id);
    const pendingProposal = beforeApproval.teamProposals.find((proposal) => proposal.status === "pending");

    expect(pendingProposal).toBeTruthy();
    expect(pendingProposal?.members.length).toBeGreaterThanOrEqual(1);
    expect(beforeApproval.queueItems.filter((item) => item.type === "worker_run")).toHaveLength(0);

    const approval = approveTeamProposal(context.db, pendingProposal?.id ?? "");
    syncQueueForCampaign(context.db, campaign.id);
    const afterApproval = getCampaignProjection(context.db, campaign.id);

    expect(approval.proposal.status).toBe("approved");
    expect(afterApproval.teamProposals[0].status).toBe("approved");
    expect(afterApproval.assignedWorkers.length).toBeGreaterThan(pendingProposal?.members.length ?? 0);
    expect(afterApproval.queueItems.some((item) => item.type === "worker_run" && item.status === "queued")).toBe(true);

    context.db.close();
  });

  it("separates PM actions that require owner approval", () => {
    const config = createTestConfig();
    const context = initializeDatabase(config);
    const division = listDivisions(context.db)[0];
    const campaign = createCampaign(context.db, config, {
      divisionId: division.id,
      title: "승인 필요 액션 테스트"
    });
    const validation = validatePmActions(context.db, campaign.id, [
      {
        type: "enqueue_work",
        taskId: "task-missing",
        reason: "자동 실행은 대표 확인 이후 진행"
      }
    ]);

    expect(validation.accepted).toHaveLength(0);
    expect(validation.rejected[0].approvalRequired).toBe(true);

    context.db.close();
  });

  it("stores artifact manifests, versions, and viewer content", () => {
    const config = createTestConfig();
    const context = initializeDatabase(config);
    const division = listDivisions(context.db)[0];
    const campaign = createCampaign(context.db, config, {
      divisionId: division.id,
      title: "산출물 저장소 테스트"
    });

    sendOwnerMessage(context.db, config, campaign.id, "산출물 저장소 테스트용 계획을 만들어주세요.");
    const artifact = listArtifacts(context.db, campaign.id)[0];
    const detail = getArtifactDetail(context.db, config, artifact.id);
    const html = renderArtifactViewerHtml(detail);
    const secondVersion = createArtifactVersion(context.db, config, {
      artifactId: artifact.id,
      createdBy: "테스트",
      content: "# 두 번째 버전\n\n본문입니다.",
      review: "두 번째 버전 리뷰입니다."
    });
    const htmlArtifactId = "artifact-html-test";
    context.db
      .prepare(
        `INSERT INTO artifacts (id, campaign_id, display_number, title, kind, status, linked_task_ids)
         VALUES (?, ?, 99, 'HTML 산출물', 'html', 'draft', '[]')`
      )
      .run(htmlArtifactId, campaign.id);
    createArtifactVersion(context.db, config, {
      artifactId: htmlArtifactId,
      createdBy: "테스트",
      content: "<main><h1>HTML 산출물</h1></main>",
      review: "HTML 산출물 리뷰입니다."
    });
    const htmlDetail = getArtifactDetail(context.db, config, htmlArtifactId);
    const htmlViewer = renderArtifactViewerHtml(htmlDetail);
    const updatedDetail = getArtifactDetail(context.db, config, artifact.id);

    expect(fs.existsSync(path.join(config.dataDir, "divisions", division.id, "campaigns", campaign.id, "artifacts", artifact.id, "manifest.json"))).toBe(
      true
    );
    expect(detail.currentVersion?.version).toBe("v001");
    expect(detail.content).toContain("산출물 요청");
    expect(html).toContain("<article");
    expect(htmlViewer).toContain("html-frame");
    expect(secondVersion.version).toBe("v002");
    expect(updatedDetail.currentVersion?.version).toBe("v002");

    context.db.close();
  });

  it("assigns a worker, creates a queue item, and runs the mock worker", () => {
    const config = createTestConfig();
    const context = initializeDatabase(config);
    const division = listDivisions(context.db)[0];
    const worker = createWorker(context.db, {
      divisionId: division.id,
      name: "콘텐츠 담당",
      position: "콘텐츠 기획 담당"
    });
    const campaign = createCampaign(context.db, config, {
      divisionId: division.id,
      title: "작업 큐 테스트"
    });

    const assigned = assignWorkerToCampaign(context.db, campaign.id, {
      workerId: worker.id,
      role: "콘텐츠 기획"
    });
    const session = startWorkerSession(context.db, campaign.id, worker.id);

    expect(assigned.workerId).toBe(worker.id);
    expect(session.sessionStatus).toBe("ready");

    sendOwnerMessage(context.db, config, campaign.id, "직원 실행 큐 테스트용 산출물을 만들어주세요.");
    const beforeRun = getCampaignProjection(context.db, campaign.id);

    expect(beforeRun.assignedWorkers.length).toBeGreaterThanOrEqual(1);
    expect(beforeRun.queueItems.some((item) => item.status === "queued")).toBe(true);

    const run = runNextQueueItem(context.db, config, campaign.id);
    const afterRun = getCampaignProjection(context.db, campaign.id);
    const artifact = afterRun.artifacts[0];
    const detail = getArtifactDetail(context.db, config, artifact.id);

    expect(run.queueItem?.status).toBe("done");
    expect(afterRun.queueItems.some((item) => item.status === "done")).toBe(true);
    expect(afterRun.tasks[0].status).toBe("done");
    expect(artifact.status).toBe("in_review");
    expect(detail.currentVersion?.version).toBe("v002");
    expect(detail.content).toContain("작업 결과");

    context.db.close();
  });
});

describe("Codex CLI runner", () => {
  it("reports Codex CLI connection status", () => {
    const config = createTestConfig();
    const commandPath = createFakeCodexStatusCommand(config.rootDir);
    const status = checkCodexConnection({
      ...config,
      codexRunner: "codex-cli",
      codexCliBin: commandPath
    });

    expect(status.state).toBe("connected");
    expect(status.version).toBe("codex-cli 0.135.0");
    expect(status.authStatus).toBe("Logged in using ChatGPT");
  });

  it("uses codex exec for PM replies, worker output, and PM review when enabled", () => {
    const config = createTestConfig();
    const context = initializeDatabase(config);
    const campaign = createReviewCampaign(context, config, "Codex CLI runner test");
    const commandPath = createFakeCodexCommand(
      config.rootDir,
      JSON.stringify({
        result: "needs_revision",
        summary: "Codex review summary",
        review: "# Codex review\n\nNeeds revision."
      })
    );
    const cliConfig: AppConfig = {
      ...config,
      codexRunner: "codex-cli",
      codexCliBin: commandPath,
      codexPmModel: "test-pm-model",
      codexWorkerModel: "test-worker-model",
      codexScribeModel: "test-scribe-model",
      codexTimeoutMs: 30000
    };
    const artifactId = createReviewArtifact(context, config, campaign.id, {
      id: "artifact-codex-review",
      displayNumber: 1,
      title: "Codex review artifact",
      content: "# Draft\n\nBody"
    });
    const detail = getArtifactDetail(context.db, config, artifactId);

    const pmReply = createPmReply(cliConfig, campaign, "Please make a plan.");
    const workerContent = createWorkerArtifactContent(
      cliConfig,
      {
        title: "Worker task",
        description: "Create a draft",
        instructions: "Use the PM direction",
        acceptanceCriteria: "A markdown draft exists"
      },
      "AI worker"
    );
    const review = reviewArtifactWithPm(cliConfig, detail);

    expect(pmReply).toContain("Codex review summary");
    expect(workerContent).toContain("Codex review summary");
    expect(review.result).toBe("needs_revision");
    expect(review.summary).toBe("Codex review summary");

    context.db.close();
  });
});

describe("Phase 5 PM review and automatic rework", () => {
  it("reviews a worker artifact and saves an approval review file", () => {
    const config = createTestConfig();
    const context = initializeDatabase(config);
    const division = listDivisions(context.db)[0];
    const campaign = createCampaign(context.db, config, {
      divisionId: division.id,
      title: "PM 리뷰 승인 테스트"
    });

    sendOwnerMessage(context.db, config, campaign.id, "PM 리뷰 승인 검증용 산출물을 만들어주세요.");
    approvePendingTeamProposal(context, campaign.id);
    const workerRun = runNextQueueItem(context.db, config, campaign.id);
    const reviewRun = runNextQueueItem(context.db, config, campaign.id);
    const projection = getCampaignProjection(context.db, campaign.id);
    const artifact = projection.artifacts[0];
    const detail = getArtifactDetail(context.db, config, artifact.id);

    expect(workerRun.queueItem?.type).toBe("worker_run");
    expect(reviewRun.queueItem?.type).toBe("pm_review");
    expect(reviewRun.queueItem?.status).toBe("done");
    expect(artifact.status).toBe("approved");
    expect(detail.review).toContain("판정: 승인");
    expect(fs.existsSync(detail.currentVersion?.reviewPath ?? "")).toBe(true);
    expect(listQueueItems(context.db, campaign.id).some((item) => item.type === "artifact_revision")).toBe(false);

    context.db.close();
  });

  it("creates a revision queue only for artifacts that fail PM review", () => {
    const config = createTestConfig();
    const context = initializeDatabase(config);
    const campaign = createReviewCampaign(context, config, "PM 리뷰 재작업 테스트");
    const approvedArtifactId = createReviewArtifact(context, config, campaign.id, {
      id: "artifact-approved",
      displayNumber: 1,
      title: "승인 대상 산출물",
      content: "# 승인 대상 산출물\n\n목적과 다음 행동이 정리되어 있습니다."
    });
    const revisionArtifactId = createReviewArtifact(context, config, campaign.id, {
      id: "artifact-revision",
      displayNumber: 2,
      title: "재작업 대상 산출물",
      content: "# 재작업 대상 산출물\n\n[NEEDS_REVISION]\n\n표현을 더 선명하게 다듬어야 합니다."
    });

    enqueueReview(context, campaign.id, "queue-review-mixed", [approvedArtifactId, revisionArtifactId]);
    const reviewRun = runNextQueueItem(context.db, config, campaign.id);
    const afterReview = getCampaignProjection(context.db, campaign.id);
    const revisionQueues = afterReview.queueItems.filter((item) => item.type === "artifact_revision");

    expect(reviewRun.queueItem?.status).toBe("done");
    expect(afterReview.artifacts.find((artifact) => artifact.id === approvedArtifactId)?.status).toBe("approved");
    expect(afterReview.artifacts.find((artifact) => artifact.id === revisionArtifactId)?.status).toBe("needs_revision");
    expect(revisionQueues).toHaveLength(1);
    expect(revisionQueues[0].artifactIds).toEqual([revisionArtifactId]);

    const revisionRun = runNextQueueItem(context.db, config, campaign.id);
    const finalReviewRun = runNextQueueItem(context.db, config, campaign.id);
    const finalProjection = getCampaignProjection(context.db, campaign.id);
    const finalDetail = getArtifactDetail(context.db, config, revisionArtifactId);

    expect(revisionRun.queueItem?.type).toBe("artifact_revision");
    expect(finalReviewRun.queueItem?.type).toBe("pm_review");
    expect(finalProjection.artifacts.find((artifact) => artifact.id === revisionArtifactId)?.status).toBe("approved");
    expect(finalDetail.currentVersion?.version).toBe("v002");
    expect(finalDetail.review).toContain("판정: 승인");

    context.db.close();
  });

  it("stops repeated revision loops at the maximum repeat limit", () => {
    const config = createTestConfig();
    const context = initializeDatabase(config);
    const campaign = createReviewCampaign(context, config, "PM 리뷰 반복 제한 테스트");
    const artifactId = createReviewArtifact(context, config, campaign.id, {
      id: "artifact-repeat-limit",
      displayNumber: 1,
      title: "반복 제한 산출물",
      content: "# 반복 제한 산출물\n\n근거 부족 항목이 남아 있습니다."
    });

    enqueueReview(context, campaign.id, "queue-review-repeat-1", [artifactId]);
    runNextQueueItem(context.db, config, campaign.id);
    runNextQueueItem(context.db, config, campaign.id);
    runNextQueueItem(context.db, config, campaign.id);
    runNextQueueItem(context.db, config, campaign.id);
    const finalReviewRun = runNextQueueItem(context.db, config, campaign.id);
    const projection = getCampaignProjection(context.db, campaign.id);
    const revisionQueues = projection.queueItems.filter((item) => item.type === "artifact_revision");
    const blockedRevision = revisionQueues.find((item) => item.status === "blocked");
    const campaignSummary = listCampaigns(context.db).find((item) => item.id === campaign.id);

    expect(finalReviewRun.queueItem?.type).toBe("pm_review");
    expect(blockedRevision).toBeTruthy();
    expect(blockedRevision?.blockedByDecisionId).toBeTruthy();
    expect(revisionQueues.filter((item) => item.status === "queued")).toHaveLength(0);
    expect(projection.decisions).toHaveLength(1);
    expect(campaignSummary?.health).toBe("needs_owner_decision");

    context.db.close();
  });

  it("blocks automation when PM review detects an owner decision", () => {
    const config = createTestConfig();
    const context = initializeDatabase(config);
    const campaign = createReviewCampaign(context, config, "대표 결정 감지 테스트");
    const artifactId = createReviewArtifact(context, config, campaign.id, {
      id: "artifact-owner-decision",
      displayNumber: 1,
      title: "대표 결정 필요 산출물",
      content: "# 대표 결정 필요 산출물\n\n[OWNER_DECISION]\n\n비용 확정 필요 항목이 있습니다."
    });

    enqueueReview(context, campaign.id, "queue-review-owner-decision", [artifactId]);
    const reviewRun = runNextQueueItem(context.db, config, campaign.id);
    const projection = getCampaignProjection(context.db, campaign.id);
    const artifact = projection.artifacts.find((item) => item.id === artifactId);
    const detail = getArtifactDetail(context.db, config, artifactId);

    expect(reviewRun.queueItem?.type).toBe("pm_review");
    expect(reviewRun.queueItem?.status).toBe("blocked");
    expect(reviewRun.queueItem?.blockedByDecisionId).toBeTruthy();
    expect(artifact?.status).toBe("blocked");
    expect(projection.decisions[0]?.blocks).toContain(artifactId);
    expect(detail.review).toContain("판정: 대표 결정 필요");

    context.db.close();
  });
});

describe("Phase 6 owner decision inbox", () => {
  it("stores an answer, resumes the blocked queue, and lets PM review continue", () => {
    const config = createTestConfig();
    const context = initializeDatabase(config);
    const campaign = createReviewCampaign(context, config, "대표 결정함 테스트");
    const artifactId = createReviewArtifact(context, config, campaign.id, {
      id: "artifact-decision-inbox",
      displayNumber: 1,
      title: "대표 결정함 산출물",
      content: "# 대표 결정함 산출물\n\n[OWNER_DECISION]\n\n비용 확정 필요 항목이 있습니다."
    });

    enqueueReview(context, campaign.id, "queue-decision-inbox-review", [artifactId]);
    const blockedRun = runNextQueueItem(context.db, config, campaign.id);
    const openDecision = listDecisions(context.db, "open")[0];

    expect(blockedRun.queueItem?.status).toBe("blocked");
    expect(openDecision.campaignId).toBe(campaign.id);
    expect(openDecision.blockTitles).toContain("대표 결정함 산출물");
    expect(openDecision.blockedQueueCount).toBe(1);

    const answer = answerDecision(context.db, openDecision.id, {
      selectedOption: openDecision.options[0],
      answer: "대표가 기준을 확인했으니 PM 리뷰를 계속 진행합니다."
    });
    const answeredDecision = getDecision(context.db, openDecision.id);
    const afterAnswer = getCampaignProjection(context.db, campaign.id);
    const resumedQueue = afterAnswer.queueItems.find((item) => item.id === blockedRun.queueItem?.id);
    const campaignSummary = listCampaigns(context.db).find((item) => item.id === campaign.id);

    expect(answer.resumedQueueCount).toBe(1);
    expect(answeredDecision?.status).toBe("answered");
    expect(answeredDecision?.answer).toContain("대표가 기준을 확인");
    expect(resumedQueue?.status).toBe("queued");
    expect(resumedQueue?.blockedByDecisionId).toBe(openDecision.id);
    expect(afterAnswer.artifacts[0].status).toBe("in_review");
    expect(campaignSummary?.health).toBe("normal");

    const rerun = runNextQueueItem(context.db, config, campaign.id);
    const finalProjection = getCampaignProjection(context.db, campaign.id);
    const detail = getArtifactDetail(context.db, config, artifactId);

    expect(rerun.queueItem?.status).toBe("done");
    expect(finalProjection.artifacts[0].status).toBe("approved");
    expect(detail.review).toContain("대표 결정 답변을 반영했습니다");

    context.db.close();
  });
});

describe("Phase 7 artifact revision flow", () => {
  it("creates a revision request, tracks graph relations, and deduplicates the same request", () => {
    const config = createTestConfig();
    const context = initializeDatabase(config);
    const campaign = createReviewCampaign(context, config, "산출물 수정 요청 테스트");
    const artifactId = createReviewArtifact(context, config, campaign.id, {
      id: "artifact-revision-target",
      displayNumber: 1,
      title: "수정 대상 산출물",
      content: "# 수정 대상 산출물\n\n초안 본문입니다."
    });
    const relatedArtifactId = createReviewArtifact(context, config, campaign.id, {
      id: "artifact-revision-related",
      displayNumber: 2,
      title: "관련 산출물",
      content: "# 관련 산출물\n\n참조할 내용입니다."
    });

    const first = requestArtifactRevision(context.db, artifactId, {
      instruction: "톤을 더 간결하게 수정하고 관련 산출물과 표현을 맞춰주세요.",
      relatedArtifactIds: [relatedArtifactId]
    });
    const duplicate = requestArtifactRevision(context.db, artifactId, {
      instruction: "톤을 더 간결하게 수정하고 관련 산출물과 표현을 맞춰주세요.",
      relatedArtifactIds: [relatedArtifactId]
    });
    const projection = getCampaignProjection(context.db, campaign.id);
    const detail = getArtifactDetail(context.db, config, artifactId);
    const revisionQueues = projection.queueItems.filter((item) => item.type === "artifact_revision");

    expect(first.created).toBe(true);
    expect(duplicate.created).toBe(false);
    expect(duplicate.revisionRequest.id).toBe(first.revisionRequest.id);
    expect(revisionQueues).toHaveLength(1);
    expect(revisionQueues[0].artifactIds).toEqual([artifactId]);
    expect(projection.edges.some((edge) => edge.fromNodeId === first.revisionRequest.taskId && edge.toNodeId === artifactId && edge.relation === "revises")).toBe(
      true
    );
    expect(projection.edges.some((edge) => edge.fromNodeId === artifactId && edge.toNodeId === relatedArtifactId && edge.relation === "references")).toBe(true);
    expect(detail.revisionRequests).toHaveLength(1);
    expect(detail.relations.some((relation) => relation.relation === "revises")).toBe(true);
    expect(detail.relations.some((relation) => relation.relation === "references")).toBe(true);

    context.db.close();
  });

  it("runs a requested revision, creates a new version, and passes PM review", () => {
    const config = createTestConfig();
    const context = initializeDatabase(config);
    const campaign = createReviewCampaign(context, config, "산출물 수정 실행 테스트");
    const artifactId = createReviewArtifact(context, config, campaign.id, {
      id: "artifact-revision-run",
      displayNumber: 1,
      title: "수정 실행 산출물",
      content: "# 수정 실행 산출물\n\n초안 본문입니다."
    });

    const request = requestArtifactRevision(context.db, artifactId, {
      instruction: "대표 수정 요청 문구를 반영해 더 명확하게 다듬어주세요."
    });
    const revisionRun = runNextQueueItem(context.db, config, campaign.id);
    const reviewRun = runNextQueueItem(context.db, config, campaign.id);
    const projection = getCampaignProjection(context.db, campaign.id);
    const detail = getArtifactDetail(context.db, config, artifactId);
    const revisionRequest = detail.revisionRequests.find((item) => item.id === request.revisionRequest.id);

    expect(revisionRun.queueItem?.type).toBe("artifact_revision");
    expect(reviewRun.queueItem?.type).toBe("pm_review");
    expect(detail.currentVersion?.version).toBe("v002");
    expect(detail.content).toContain("대표 수정 요청을 반영했습니다");
    expect(projection.artifacts.find((artifact) => artifact.id === artifactId)?.status).toBe("approved");
    expect(revisionRequest?.status).toBe("approved");
    expect(detail.review).toContain("판정: 승인");

    context.db.close();
  });

  it("extracts a natural-language PM revision request without creating duplicate worker work", () => {
    const config = createTestConfig();
    const context = initializeDatabase(config);
    const campaign = createReviewCampaign(context, config, "PM 대화 수정 요청 테스트");
    const artifactId = createReviewArtifact(context, config, campaign.id, {
      id: "artifact-pm-revision",
      displayNumber: 1,
      title: "PM 대화 수정 대상",
      content: "# PM 대화 수정 대상\n\n초안 본문입니다."
    });

    sendOwnerMessage(context.db, config, campaign.id, "001 산출물을 더 짧고 분명하게 수정해주세요.");
    const projection = getCampaignProjection(context.db, campaign.id);
    const detail = getArtifactDetail(context.db, config, artifactId);

    expect(detail.revisionRequests).toHaveLength(1);
    expect(detail.revisionRequests[0].instruction).toContain("수정해주세요");
    expect(projection.artifacts).toHaveLength(1);
    expect(projection.queueItems.filter((item) => item.type === "artifact_revision")).toHaveLength(1);
    expect(projection.queueItems.filter((item) => item.type === "worker_run")).toHaveLength(0);

    context.db.close();
  });
});

describe("Phase 8 handoff reports", () => {
  it("generates handoff report files with human todos and next AI work", () => {
    const config = createTestConfig();
    const context = initializeDatabase(config);
    const campaign = createReviewCampaign(context, config, "인계 보고서 테스트");
    const artifactId = createReviewArtifact(context, config, campaign.id, {
      id: "artifact-handoff-human-check",
      displayNumber: 1,
      title: "외부 확인 대상 산출물",
      content: "# 외부 확인 대상 산출물\n\nEXTERNAL_CHECK: 외부 사실 확인 필요 항목입니다."
    });

    context.db
      .prepare(
        `INSERT INTO decisions (id, campaign_id, title, reason, options, recommended_option, status, blocks)
         VALUES ('decision-handoff-open', ?, '대표 승인 필요', '비용 기준 확인 필요', ?, '승인', 'open', ?)`
      )
      .run(campaign.id, JSON.stringify(["승인", "보류"]), JSON.stringify([artifactId]));

    requestArtifactRevision(context.db, artifactId, {
      instruction: "대표 요청에 따라 문장을 더 명확하게 수정해주세요."
    });

    const report = generateCampaignHandoffReport(context.db, config, campaign.id);
    const humanTodos = fs.readFileSync(report.files.find((file) => file.kind === "human_todos")?.path ?? "", "utf8");
    const campaignStatus = fs.readFileSync(report.files.find((file) => file.kind === "campaign_status")?.path ?? "", "utf8");
    const ownerBrief = fs.readFileSync(report.files.find((file) => file.kind === "owner_brief")?.path ?? "", "utf8");

    expect(report.files.every((file) => fs.existsSync(file.path))).toBe(true);
    expect(report.humanTodoCount).toBeGreaterThanOrEqual(2);
    expect(report.nextAiTaskCount).toBeGreaterThanOrEqual(1);
    expect(report.humanTodos.some((item) => item.sourceType === "decision" && item.title === "대표 승인 필요")).toBe(true);
    expect(report.nextAiTasks.some((item) => item.sourceType === "queue" && item.status === "queued")).toBe(true);
    expect(humanTodos).toContain("사람 TODO");
    expect(campaignStatus).toContain("다음 AI 작업");
    expect(ownerBrief).toContain("대표 브리프");

    context.db.close();
  });

  it("marks a campaign as done", () => {
    const config = createTestConfig();
    const context = initializeDatabase(config);
    const campaign = createReviewCampaign(context, config, "상태 전환 테스트");

    const done = updateCampaignStatus(context.db, campaign.id, { status: "done" });
    const stored = listCampaigns(context.db).find((item) => item.id === campaign.id);

    expect(done.status).toBe("done");
    expect(stored?.status).toBe("done");
    expect(done.currentFocus).toContain("완료");

    context.db.close();
  });
});
