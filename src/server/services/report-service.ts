import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { AppConfig } from "../config.js";
import type {
  ArtifactProjection,
  CampaignHandoffReportSummary,
  CampaignReportFile,
  CampaignSummary,
  HandoffItem,
  QueueItemProjection,
  TaskProjection
} from "../../shared/types/app-state.js";
import { ensureCampaignFolders, ensureDir } from "../storage/file-store.js";
import { getArtifactDetail } from "./artifact-service.js";
import { getCampaign } from "./campaign-service.js";
import { getCampaignProjection } from "./graph-service.js";
import { createId } from "./ids.js";

const humanAttentionPatterns = [
  /HUMAN_TODO|OWNER_DECISION|EXTERNAL_CHECK|APPROVAL_REQUIRED/i,
  /사람|대표|오너|승인|결정|확인|외부|연락|컨펌|비용|계약|법무|세금|출처|확정|확인 필요/i
];

const doneTaskStatuses = new Set(["done", "approved", "archived"]);
const activeQueueStatuses = new Set(["queued", "running", "blocked"]);

function queueTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    worker_run: "직원 실행",
    pm_review: "PM 리뷰",
    artifact_revision: "산출물 재작업"
  };

  return labels[type] ?? type;
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    planning: "목표 설계",
    running: "운영 중",
    review: "검토 중",
    blocked: "막힘",
    done: "완료",
    archived: "보관",
    draft: "초안",
    ready: "준비",
    queued: "대기",
    running_queue: "실행 중",
    failed: "실패",
    in_review: "검토 중",
    needs_revision: "수정 필요",
    approved: "승인"
  };

  return labels[status] ?? status;
}

function reportRoot(config: AppConfig, campaign: CampaignSummary): string {
  return path.join(config.dataDir, "divisions", campaign.divisionId, "campaigns", campaign.id, "reports");
}

function campaignRoot(config: AppConfig, campaign: CampaignSummary): string {
  return path.join(config.dataDir, "divisions", campaign.divisionId, "campaigns", campaign.id);
}

function relativeReportPath(config: AppConfig, campaign: CampaignSummary, filePath: string): string {
  return path.relative(campaignRoot(config, campaign), filePath).split(path.sep).join("/");
}

function escapeTableValue(value: string): string {
  return value.replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim();
}

function hasHumanAttentionMarker(text: string): boolean {
  return humanAttentionPatterns.some((pattern) => pattern.test(text));
}

function addUnique(items: HandoffItem[], item: HandoffItem): void {
  const key = `${item.sourceType}:${item.sourceId}:${item.title}`;
  if (!items.some((existing) => `${existing.sourceType}:${existing.sourceId}:${existing.title}` === key)) {
    items.push(item);
  }
}

function collectArtifactText(db: DatabaseSync, config: AppConfig, artifact: ArtifactProjection): string {
  try {
    const detail = getArtifactDetail(db, config, artifact.id);
    return [artifact.title, artifact.reviewSummary, detail.content, detail.review].join("\n");
  } catch {
    return [artifact.title, artifact.reviewSummary].join("\n");
  }
}

function collectHumanTodos(
  db: DatabaseSync,
  config: AppConfig,
  campaign: CampaignSummary,
  queueItems: QueueItemProjection[],
  tasks: TaskProjection[],
  artifacts: ArtifactProjection[]
): HandoffItem[] {
  const items: HandoffItem[] = [];
  const projection = getCampaignProjection(db, campaign.id);

  for (const decision of projection.decisions.filter((item) => item.status === "open")) {
    addUnique(items, {
      id: `human-${decision.id}`,
      title: decision.title,
      reason: decision.reason || "대표 결정이 필요한 항목입니다.",
      sourceType: "decision",
      sourceId: decision.id,
      status: decision.status
    });
  }

  for (const queueItem of queueItems.filter((item) => item.status === "blocked")) {
    addUnique(items, {
      id: `human-${queueItem.id}`,
      title: queueItem.taskTitle ?? queueTypeLabel(queueItem.type),
      reason: queueItem.blockedByDecisionId
        ? "결정함 답변이 있어야 자동 실행을 이어갈 수 있습니다."
        : "막힌 자동 실행 항목입니다. 사람이 확인해야 합니다.",
      sourceType: "queue",
      sourceId: queueItem.id,
      status: queueItem.status
    });
  }

  for (const task of tasks) {
    const taskText = [task.title, task.description, task.acceptanceCriteria].join("\n");
    if (!doneTaskStatuses.has(task.status) && hasHumanAttentionMarker(taskText)) {
      addUnique(items, {
        id: `human-${task.id}`,
        title: task.title,
        reason: "작업 설명에 사람 확인, 외부 연락, 승인 또는 확정이 필요한 표현이 있습니다.",
        sourceType: "task",
        sourceId: task.id,
        status: task.status
      });
    }
  }

  for (const artifact of artifacts) {
    const artifactText = collectArtifactText(db, config, artifact);
    if (artifact.status !== "approved" && hasHumanAttentionMarker(artifactText)) {
      addUnique(items, {
        id: `human-${artifact.id}`,
        title: `${String(artifact.displayNumber).padStart(3, "0")} ${artifact.title}`,
        reason: "산출물 본문 또는 PM 리뷰에 사람 확인, 외부 사실 확인, 승인 표현이 있습니다.",
        sourceType: "artifact",
        sourceId: artifact.id,
        status: artifact.status
      });
    }
  }

  return items;
}

function collectNextAiTasks(
  queueItems: QueueItemProjection[],
  tasks: TaskProjection[],
  artifacts: ArtifactProjection[]
): HandoffItem[] {
  const items: HandoffItem[] = [];
  const activeQueueItems = queueItems.filter((item) => activeQueueStatuses.has(item.status));
  const queuedTaskIds = new Set(activeQueueItems.map((item) => item.taskId).filter((id): id is string => Boolean(id)));
  const queuedArtifactIds = new Set(activeQueueItems.flatMap((item) => item.artifactIds));

  for (const queueItem of activeQueueItems) {
    addUnique(items, {
      id: `ai-${queueItem.id}`,
      title: queueItem.taskTitle ?? queueTypeLabel(queueItem.type),
      reason:
        queueItem.status === "blocked"
          ? "사람 결정 이후 다시 이어 받을 자동 실행 항목입니다."
          : "이미 작업 큐에 올라와 있어 다음 실행 대상입니다.",
      sourceType: "queue",
      sourceId: queueItem.id,
      status: queueItem.status
    });
  }

  for (const task of tasks.filter((item) => !doneTaskStatuses.has(item.status) && !queuedTaskIds.has(item.id))) {
    addUnique(items, {
      id: `ai-${task.id}`,
      title: task.title,
      reason: "아직 완료되지 않은 작업 후보입니다.",
      sourceType: "task",
      sourceId: task.id,
      status: task.status
    });
  }

  for (const artifact of artifacts.filter(
    (item) => ["in_review", "needs_revision"].includes(item.status) && !queuedArtifactIds.has(item.id)
  )) {
    addUnique(items, {
      id: `ai-${artifact.id}`,
      title: `${String(artifact.displayNumber).padStart(3, "0")} ${artifact.title}`,
      reason: artifact.status === "in_review" ? "PM 리뷰 실행 후보입니다." : "산출물 재작업 실행 후보입니다.",
      sourceType: "artifact",
      sourceId: artifact.id,
      status: artifact.status
    });
  }

  return items;
}

function renderItemTable(items: HandoffItem[], emptyText: string): string[] {
  if (items.length === 0) {
    return [emptyText];
  }

  return [
    "| 항목 | 상태 | 근거 |",
    "| --- | --- | --- |",
    ...items.map((item) =>
      [`${item.title} (${item.sourceType})`, statusLabel(item.status), item.reason].map(escapeTableValue).join(" | ")
    ).map((row) => `| ${row} |`)
  ];
}

function renderHumanTodos(input: {
  campaign: CampaignSummary;
  generatedAt: string;
  humanTodos: HandoffItem[];
}): string {
  return [
    `# ${input.campaign.title} 사람 TODO`,
    "",
    `Generated at: ${input.generatedAt}`,
    `Campaign status: ${statusLabel(input.campaign.status)}`,
    "",
    "## 사람이 직접 확인할 일",
    "",
    ...renderItemTable(input.humanTodos, "현재 사람이 직접 처리해야 하는 항목은 없습니다."),
    ""
  ].join("\n");
}

function renderCampaignStatus(input: {
  campaign: CampaignSummary;
  generatedAt: string;
  humanTodos: HandoffItem[];
  nextAiTasks: HandoffItem[];
  projection: ReturnType<typeof getCampaignProjection>;
}): string {
  const { campaign, generatedAt, projection, humanTodos, nextAiTasks } = input;

  return [
    `# ${campaign.title} 캠페인 상태`,
    "",
    `Generated at: ${generatedAt}`,
    "",
    "## 요약",
    "",
    `- 상태: ${statusLabel(campaign.status)}`,
    `- 현재 초점: ${campaign.currentFocus || "정리 중"}`,
    `- 목표: ${projection.goals.length}개`,
    `- 작업: ${projection.tasks.length}개`,
    `- 산출물: ${projection.artifacts.length}개`,
    `- 결정: ${projection.decisions.length}개`,
    `- 사람 TODO: ${humanTodos.length}개`,
    `- 다음 AI 작업: ${nextAiTasks.length}개`,
    "",
    "## 산출물",
    "",
    ...renderItemTable(
      projection.artifacts.map((artifact) => ({
        id: artifact.id,
        title: `${String(artifact.displayNumber).padStart(3, "0")} ${artifact.title}`,
        reason: artifact.reviewSummary || `현재 버전 ${artifact.currentVersion ?? "없음"}`,
        sourceType: "artifact" as const,
        sourceId: artifact.id,
        status: artifact.status
      })),
      "아직 산출물이 없습니다."
    ),
    "",
    "## 사람 TODO",
    "",
    ...renderItemTable(humanTodos, "현재 사람이 직접 처리해야 하는 항목은 없습니다."),
    "",
    "## 다음 AI 작업",
    "",
    ...renderItemTable(nextAiTasks, "현재 이어서 실행할 AI 작업 후보는 없습니다."),
    ""
  ].join("\n");
}

function renderOwnerBrief(input: {
  campaign: CampaignSummary;
  generatedAt: string;
  humanTodos: HandoffItem[];
  nextAiTasks: HandoffItem[];
  projection: ReturnType<typeof getCampaignProjection>;
}): string {
  const { campaign, generatedAt, humanTodos, nextAiTasks, projection } = input;
  const approvedArtifacts = projection.artifacts.filter((artifact) => artifact.status === "approved").length;

  return [
    `# ${campaign.title} 대표 브리프`,
    "",
    `Generated at: ${generatedAt}`,
    "",
    "## 한눈에 보기",
    "",
    `현재 캠페인은 ${statusLabel(campaign.status)} 상태입니다. 산출물 ${projection.artifacts.length}개 중 ${approvedArtifacts}개가 승인되었고, 사람 TODO ${humanTodos.length}개와 다음 AI 작업 ${nextAiTasks.length}개가 남아 있습니다.`,
    "",
    "## 대표가 볼 항목",
    "",
    ...renderItemTable(humanTodos.slice(0, 8), "현재 대표가 바로 확인할 항목은 없습니다."),
    "",
    "## AI에게 넘길 항목",
    "",
    ...renderItemTable(nextAiTasks.slice(0, 8), "현재 AI에게 넘길 다음 항목은 없습니다."),
    ""
  ].join("\n");
}

function writeReportFile(filePath: string, content: string): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, "utf8");
}

export function generateCampaignHandoffReport(
  db: DatabaseSync,
  config: AppConfig,
  campaignId: string
): CampaignHandoffReportSummary {
  const campaign = getCampaign(db, campaignId);
  if (!campaign) {
    throw new Error("캠페인을 찾을 수 없습니다.");
  }

  ensureCampaignFolders(config, campaign.divisionId, campaign.id);

  const projection = getCampaignProjection(db, campaign.id);
  const generatedAt = new Date().toISOString();
  const humanTodos = collectHumanTodos(db, config, campaign, projection.queueItems, projection.tasks, projection.artifacts);
  const nextAiTasks = collectNextAiTasks(projection.queueItems, projection.tasks, projection.artifacts);
  const root = reportRoot(config, campaign);
  const baseFiles: Array<Omit<CampaignReportFile, "relativePath">> = [
    {
      kind: "human_todos",
      label: "사람 TODO",
      path: path.join(root, "human-todos.md")
    },
    {
      kind: "campaign_status",
      label: "캠페인 상태",
      path: path.join(root, "campaign-status.md")
    },
    {
      kind: "owner_brief",
      label: "대표 브리프",
      path: path.join(root, "owner-brief.md")
    }
  ];
  const fileSpecs: CampaignReportFile[] = baseFiles.map((file) => ({
    ...file,
    relativePath: relativeReportPath(config, campaign, file.path)
  }));

  writeReportFile(
    fileSpecs[0].path,
    renderHumanTodos({
      campaign,
      generatedAt,
      humanTodos
    })
  );
  writeReportFile(
    fileSpecs[1].path,
    renderCampaignStatus({
      campaign,
      generatedAt,
      humanTodos,
      nextAiTasks,
      projection
    })
  );
  writeReportFile(
    fileSpecs[2].path,
    renderOwnerBrief({
      campaign,
      generatedAt,
      humanTodos,
      nextAiTasks,
      projection
    })
  );

  db.prepare(
    `INSERT INTO events (id, type, campaign_id, payload)
     VALUES (?, 'handoff_report_generated', ?, ?)`
  ).run(
    createId("event"),
    campaign.id,
    JSON.stringify({
      files: fileSpecs.map((file) => file.relativePath),
      humanTodoCount: humanTodos.length,
      nextAiTaskCount: nextAiTasks.length
    })
  );

  return {
    campaignId: campaign.id,
    campaignTitle: campaign.title,
    generatedAt,
    status: campaign.status,
    artifactCount: projection.artifacts.length,
    decisionCount: projection.decisions.length,
    humanTodoCount: humanTodos.length,
    nextAiTaskCount: nextAiTasks.length,
    humanTodos,
    nextAiTasks,
    files: fileSpecs
  };
}
