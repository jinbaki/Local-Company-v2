import type { DatabaseSync } from "node:sqlite";
import type { AppConfig } from "../config.js";
import type { ArtifactDetailResponse, CampaignWorkerSummary, QueueItemProjection, QueueRunResponse } from "../../shared/types/app-state.js";
import { createArtifactVersion, getArtifactDetail, writeCurrentArtifactReview } from "./artifact-service.js";
import { createRevisionArtifactContent, createWorkerArtifactContent, reviewArtifactWithPm } from "./agent-runner.js";
import { createId } from "./ids.js";
import { listTeamProposals } from "./team-proposal-service.js";
import { ensureDefaultExecutionWorkerAssigned, ensureReadyWorkerSession, listCampaignWorkers } from "./worker-service.js";

interface TaskRow {
  id: string;
  campaignId: string;
  title: string;
  description: string;
  status: string;
  instructions: string;
  acceptanceCriteria: string;
  ownerWorkerId: string | null;
}

interface RevisionRequestRow {
  id: string;
  instruction: string;
}

type PmReviewResult = "approved" | "needs_revision" | "owner_decision";

function parseJsonArray(value: string | null): string[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function normalizeQueueItem(row: Omit<QueueItemProjection, "artifactIds"> & { artifactIds: string }): QueueItemProjection {
  return {
    ...row,
    artifactIds: parseJsonArray(row.artifactIds)
  };
}

function getTask(db: DatabaseSync, taskId: string): TaskRow | null {
  const task = db
    .prepare(
      `SELECT
        id,
        campaign_id AS campaignId,
        title,
        description,
        status,
        instructions,
        acceptance_criteria AS acceptanceCriteria,
        owner_worker_id AS ownerWorkerId
      FROM tasks
      WHERE id = ?`
    )
    .get(taskId) as unknown as TaskRow | undefined;

  return task ?? null;
}

function getArtifactIdsForTask(db: DatabaseSync, campaignId: string, taskId: string): string[] {
  const rows = db
    .prepare(
      `SELECT to_node_id AS artifactId
       FROM graph_edges
       WHERE campaign_id = ? AND from_node_id = ? AND relation = 'produces'
       ORDER BY created_at ASC, rowid ASC`
    )
    .all(campaignId, taskId) as unknown as { artifactId: string }[];

  return rows.map((row) => row.artifactId);
}

export function listQueueItems(db: DatabaseSync, campaignId: string): QueueItemProjection[] {
  const rows = db
    .prepare(
      `SELECT
        q.id,
        q.type,
        q.status,
        q.campaign_id AS campaignId,
        q.worker_id AS workerId,
        w.name AS workerName,
        q.task_id AS taskId,
        t.title AS taskTitle,
        q.artifact_ids AS artifactIds,
        q.attempt,
        q.max_attempts AS maxAttempts,
        q.blocked_by_decision_id AS blockedByDecisionId,
        q.updated_at AS updatedAt
      FROM queue_items q
      LEFT JOIN workers w ON w.id = q.worker_id
      LEFT JOIN tasks t ON t.id = q.task_id
      WHERE q.campaign_id = ?
      ORDER BY
        CASE q.status
          WHEN 'running' THEN 0
          WHEN 'queued' THEN 1
          WHEN 'blocked' THEN 2
          WHEN 'failed' THEN 3
          ELSE 4
        END,
        q.created_at ASC,
        q.rowid ASC`
    )
    .all(campaignId) as unknown as (Omit<QueueItemProjection, "artifactIds"> & { artifactIds: string })[];

  return rows.map(normalizeQueueItem);
}

function getQueueItem(db: DatabaseSync, queueItemId: string): QueueItemProjection | null {
  const row = db
    .prepare(
      `SELECT
        q.id,
        q.type,
        q.status,
        q.campaign_id AS campaignId,
        q.worker_id AS workerId,
        w.name AS workerName,
        q.task_id AS taskId,
        t.title AS taskTitle,
        q.artifact_ids AS artifactIds,
        q.attempt,
        q.max_attempts AS maxAttempts,
        q.blocked_by_decision_id AS blockedByDecisionId,
        q.updated_at AS updatedAt
      FROM queue_items q
      LEFT JOIN workers w ON w.id = q.worker_id
      LEFT JOIN tasks t ON t.id = q.task_id
      WHERE q.id = ?`
    )
    .get(queueItemId) as unknown as (Omit<QueueItemProjection, "artifactIds"> & { artifactIds: string }) | undefined;

  return row ? normalizeQueueItem(row) : null;
}

function hasOpenQueueForArtifact(db: DatabaseSync, campaignId: string, type: string, artifactId: string): boolean {
  return listQueueItems(db, campaignId).some(
    (item) => item.type === type && ["queued", "running", "blocked"].includes(item.status) && item.artifactIds.includes(artifactId)
  );
}

function insertQueueItem(input: {
  db: DatabaseSync;
  type: string;
  status?: string;
  campaignId: string;
  workerId?: string | null;
  taskId?: string | null;
  artifactIds: string[];
  maxAttempts?: number;
  blockedByDecisionId?: string | null;
}): string {
  const queueId = createId("queue");

  input.db
    .prepare(
      `INSERT INTO queue_items (
        id,
        type,
        status,
        campaign_id,
        worker_id,
        task_id,
        artifact_ids,
        max_attempts,
        blocked_by_decision_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      queueId,
      input.type,
      input.status ?? "queued",
      input.campaignId,
      input.workerId ?? null,
      input.taskId ?? null,
      JSON.stringify(input.artifactIds),
      input.maxAttempts ?? 2,
      input.blockedByDecisionId ?? null
    );

  return queueId;
}

function enqueuePmReview(db: DatabaseSync, campaignId: string, artifactIds: string[], taskId?: string | null): void {
  const artifactsNeedingReview = artifactIds.filter((artifactId) => !hasOpenQueueForArtifact(db, campaignId, "pm_review", artifactId));
  if (artifactsNeedingReview.length === 0) {
    return;
  }

  insertQueueItem({
    db,
    type: "pm_review",
    campaignId,
    taskId: taskId ?? null,
    artifactIds: artifactsNeedingReview,
    maxAttempts: 1
  });
}

function countRevisionRuns(db: DatabaseSync, campaignId: string, artifactId: string): number {
  return listQueueItems(db, campaignId).filter((item) => item.type === "artifact_revision" && item.artifactIds.includes(artifactId)).length;
}

function createOwnerDecision(db: DatabaseSync, campaignId: string, title: string, reason: string, blocks: string[]): string {
  const decisionId = createId("decision");

  db.prepare(
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
  ).run(
    decisionId,
    campaignId,
    title,
    reason,
    JSON.stringify(["대표가 기준을 제공한다", "PM이 안전한 범위에서 보류한다"]),
    "대표가 기준을 제공한다",
    JSON.stringify(blocks)
  );

  db.prepare(
    `INSERT INTO graph_nodes (id, campaign_id, type, title, status, summary)
     VALUES (?, ?, 'decision', ?, 'open', ?)`
  ).run(decisionId, campaignId, title, reason);

  for (const blockedId of blocks) {
    db.prepare(
      `INSERT INTO graph_edges (id, campaign_id, from_node_id, to_node_id, relation)
       VALUES (?, ?, ?, ?, 'blocks')`
    ).run(createId("edge"), campaignId, decisionId, blockedId);
  }

  db.prepare(
    `UPDATE campaigns
     SET health = 'needs_owner_decision', updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(campaignId);

  return decisionId;
}

function getAnsweredDecisionAnswer(db: DatabaseSync, decisionId: string | null): string | null {
  if (!decisionId) {
    return null;
  }

  const row = db
    .prepare("SELECT answer FROM decisions WHERE id = ? AND status = 'answered'")
    .get(decisionId) as unknown as { answer: string | null } | undefined;

  return row?.answer ?? null;
}

function getRevisionRequestForQueue(db: DatabaseSync, queueItemId: string): RevisionRequestRow | null {
  const row = db
    .prepare(
      `SELECT id, instruction
       FROM artifact_revision_requests
       WHERE queue_item_id = ?`
    )
    .get(queueItemId) as unknown as RevisionRequestRow | undefined;

  return row ?? null;
}

function updateRevisionRequestStatus(db: DatabaseSync, queueItemId: string, status: string): void {
  db.prepare(
    `UPDATE artifact_revision_requests
     SET status = ?, updated_at = CURRENT_TIMESTAMP
     WHERE queue_item_id = ?`
  ).run(status, queueItemId);
}

function updateLatestRevisionRequestStatus(db: DatabaseSync, artifactId: string, status: string): void {
  const row = db
    .prepare(
      `SELECT id
       FROM artifact_revision_requests
       WHERE artifact_id = ? AND status IN ('queued', 'running', 'done', 'needs_revision')
       ORDER BY updated_at DESC, rowid DESC
       LIMIT 1`
    )
    .get(artifactId) as unknown as { id: string } | undefined;

  if (!row) {
    return;
  }

  db.prepare(
    `UPDATE artifact_revision_requests
     SET status = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(status, row.id);
}

function enqueueArtifactRevision(db: DatabaseSync, campaignId: string, artifactId: string, workerId: string | null, taskId: string | null): void {
  if (hasOpenQueueForArtifact(db, campaignId, "artifact_revision", artifactId)) {
    return;
  }

  if (countRevisionRuns(db, campaignId, artifactId) >= 2) {
    const decisionId = createOwnerDecision(
      db,
      campaignId,
      "산출물 재작업 반복 제한 도달",
      "동일 산출물이 최대 재작업 횟수에 도달해 대표 판단이 필요합니다.",
      [artifactId]
    );

    insertQueueItem({
      db,
      type: "artifact_revision",
      status: "blocked",
      campaignId,
      workerId,
      taskId,
      artifactIds: [artifactId],
      blockedByDecisionId: decisionId
    });
    return;
  }

  insertQueueItem({
    db,
    type: "artifact_revision",
    campaignId,
    workerId,
    taskId,
    artifactIds: [artifactId],
    maxAttempts: 2
  });
}

export function syncReviewQueueForCampaign(db: DatabaseSync, campaignId: string): QueueItemProjection[] {
  const rows = db
    .prepare(
      `SELECT id
       FROM artifacts
       WHERE campaign_id = ? AND status = 'in_review'
       ORDER BY updated_at ASC, rowid ASC`
    )
    .all(campaignId) as unknown as { id: string }[];

  for (const row of rows) {
    enqueuePmReview(db, campaignId, [row.id]);
  }

  return listQueueItems(db, campaignId);
}

function isExecutionWorker(worker: CampaignWorkerSummary): boolean {
  const roleText = `${worker.role} ${worker.position}`;
  return !/PM|리드/i.test(roleText);
}

function getRunnableCampaignWorker(db: DatabaseSync, campaignId: string): CampaignWorkerSummary | null {
  const assignedWorker = listCampaignWorkers(db, campaignId).find(isExecutionWorker);
  if (assignedWorker) {
    return assignedWorker;
  }

  const hasPendingTeamProposal = listTeamProposals(db, campaignId).some((proposal) => proposal.status === "pending");
  if (hasPendingTeamProposal) {
    return null;
  }

  return ensureDefaultExecutionWorkerAssigned(db, campaignId);
}

export function syncQueueForCampaign(db: DatabaseSync, campaignId: string): QueueItemProjection[] {
  const assignedWorker = getRunnableCampaignWorker(db, campaignId);
  if (!assignedWorker) {
    syncReviewQueueForCampaign(db, campaignId);
    return listQueueItems(db, campaignId);
  }

  ensureReadyWorkerSession(db, campaignId, assignedWorker.workerId);

  const tasks = db
    .prepare(
      `SELECT
        id,
        campaign_id AS campaignId,
        title,
        description,
        status,
        instructions,
        acceptance_criteria AS acceptanceCriteria,
        owner_worker_id AS ownerWorkerId
      FROM tasks
      WHERE campaign_id = ?
        AND status IN ('ready', 'queued')
        AND NOT EXISTS (
          SELECT 1
          FROM graph_edges e
          WHERE e.from_node_id = tasks.id AND e.relation = 'revises'
        )
      ORDER BY created_at ASC, rowid ASC`
    )
    .all(campaignId) as unknown as TaskRow[];

  for (const task of tasks) {
    const existing = db
      .prepare("SELECT id FROM queue_items WHERE campaign_id = ? AND task_id = ? AND type = 'worker_run'")
      .get(campaignId, task.id);
    const artifactIds = getArtifactIdsForTask(db, campaignId, task.id);

    db.prepare(
      `UPDATE tasks
       SET owner_worker_id = ?, status = CASE WHEN status = 'ready' THEN 'queued' ELSE status END, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(assignedWorker.workerId, task.id);

    db.prepare(
      `UPDATE graph_nodes
       SET status = 'queued', updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND type = 'task'`
    ).run(task.id);

    for (const artifactId of artifactIds) {
      db.prepare(
        `UPDATE artifacts
         SET owner_worker_id = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).run(assignedWorker.workerId, artifactId);
    }

    if (!existing) {
      insertQueueItem({
        db,
        type: "worker_run",
        campaignId,
        workerId: assignedWorker.workerId,
        taskId: task.id,
        artifactIds
      });
    }
  }

  syncReviewQueueForCampaign(db, campaignId);
  return listQueueItems(db, campaignId);
}

function renderMockWorkerContent(task: TaskRow, workerName: string): string {
  return [
    `# ${task.title}`,
    "",
    "## 작업 결과",
    "",
    `${workerName}이 PM의 작업지시를 바탕으로 산출물을 확장했습니다.`,
    "",
    "## 작업 목적",
    "",
    task.description || "PM 대화에서 생성된 작업을 실행 가능한 문서로 정리합니다.",
    "",
    "## PM 작업지시",
    "",
    task.instructions || "작업지시가 아직 상세화되지 않았습니다.",
    "",
    "## 완료 기준",
    "",
    task.acceptanceCriteria || "PM이 검토할 수 있는 초안 산출물이 있어야 합니다.",
    "",
    "## 남은 리스크",
    "",
    "- 외부 사실 확인이 필요한 항목은 대표 또는 사람 직원 확인이 필요합니다.",
    "- 실제 Codex 직원 실행 전까지 이 문서는 mock worker 결과입니다.",
    "",
    "## PM에게 제안하는 다음 행동",
    "",
    "- 산출물 목적 적합성과 근거 품질을 리뷰합니다.",
    "- 부족한 부분이 있으면 재작업 큐를 만듭니다.",
    ""
  ].join("\n");
}

function cleanRevisionMarkers(value: string): string {
  return value.replace(/\[NEEDS_REVISION\]|재작업 필요/g, "").trim();
}

function renderMockRevisionContent(detail: ArtifactDetailResponse, workerName: string, revisionInstruction?: string): string {
  const cleanTitle = cleanRevisionMarkers(detail.artifact.title) || detail.artifact.title;

  return [
    `# ${cleanTitle}`,
    "",
    "## 재작업 결과",
    "",
    `${workerName}이 PM 리뷰를 반영해 산출물을 보강했습니다.`,
    "",
    "## 보강 내용",
    "",
    revisionInstruction ? `- 대표 수정 요청을 반영했습니다: ${revisionInstruction}` : "- PM 리뷰에서 나온 재작업 요청을 반영했습니다.",
    "- 목적, 근거, 다음 행동을 더 분명히 정리했습니다.",
    "- 대표 판단이 필요한 항목은 확정 표현으로 쓰지 않았습니다.",
    "",
    "## 본문",
    "",
    cleanRevisionMarkers(detail.content),
    "",
    "## 남은 리스크",
    "",
    "- 외부 사실은 사람 확인 후 확정해야 합니다.",
    ""
  ].join("\n");
}

function evaluatePmReview(detail: ArtifactDetailResponse): PmReviewResult {
  const content = detail.content;

  if (/\[OWNER_DECISION\]|대표 결정 필요|대표 판단 필요|외부 연락 필요|비용 확정 필요/.test(content)) {
    return "owner_decision";
  }

  if (/\[NEEDS_REVISION\]|재작업 필요|보강 필요|근거 부족/.test(content)) {
    return "needs_revision";
  }

  return "approved";
}

function renderPmReview(
  detail: ArtifactDetailResponse,
  result: PmReviewResult,
  ownerAnswer?: string | null
): { review: string; summary: string } {
  if (result === "approved") {
    return {
      summary: ownerAnswer ? "대표 결정을 반영해 PM 리뷰를 통과했습니다." : "PM 리뷰를 통과했습니다.",
      review: [
        "# PM 리뷰",
        "",
        "판정: 승인",
        "",
        "- 산출물 목적이 캠페인 목표와 연결되어 있습니다.",
        "- 다음 행동으로 이어질 수 있는 구조입니다.",
        ownerAnswer ? `- 대표 결정 답변을 반영했습니다: ${ownerAnswer.replace(/\n+/g, " ")}` : "- 외부 사실은 확정하지 않고 확인 필요 항목으로 남겼습니다.",
        ""
      ].join("\n")
    };
  }

  if (result === "needs_revision") {
    return {
      summary: "PM 리뷰 결과 재작업이 필요합니다.",
      review: [
        "# PM 리뷰",
        "",
        "판정: 재작업 필요",
        "",
        "- 일부 근거와 실행 기준이 충분히 선명하지 않습니다.",
        "- 직원에게 산출물 보강을 요청합니다.",
        ""
      ].join("\n")
    };
  }

  return {
    summary: "대표 결정이 필요해 자동 실행을 멈췄습니다.",
    review: [
      "# PM 리뷰",
      "",
      "판정: 대표 결정 필요",
      "",
      "- 전략, 비용, 외부 연락, 확정 판단 중 대표 확인이 필요한 항목이 있습니다.",
      "- 결정이 기록될 때까지 관련 자동 실행을 멈춥니다.",
      ""
    ].join("\n")
  };
}

function runWorkerQueueItem(db: DatabaseSync, config: AppConfig, queued: QueueItemProjection): QueueRunResponse {
  if (!queued.workerId || !queued.taskId) {
    db.prepare("UPDATE queue_items SET status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(queued.id);
    return {
      queueItem: getQueueItem(db, queued.id),
      message: "담당 직원이나 작업이 없어 실행하지 못했습니다."
    };
  }

  const task = getTask(db, queued.taskId);
  if (!task) {
    db.prepare("UPDATE queue_items SET status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(queued.id);
    return {
      queueItem: getQueueItem(db, queued.id),
      message: "작업을 찾지 못해 실행하지 못했습니다."
    };
  }

  ensureReadyWorkerSession(db, queued.campaignId, queued.workerId);

  db.prepare(
    `UPDATE queue_items
     SET status = 'running', attempt = attempt + 1, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(queued.id);

  db.prepare("UPDATE tasks SET status = 'running', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(task.id);
  db.prepare("UPDATE graph_nodes SET status = 'running', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(task.id);

  for (const artifactId of queued.artifactIds) {
    const content = createWorkerArtifactContent(config, task, queued.workerName ?? "AI 직원");
    createArtifactVersion(db, config, {
      artifactId,
      createdBy: queued.workerName ?? "AI 직원",
      sourceQueueItemId: queued.id,
      content,
      review: "직원 실행 결과가 저장되었습니다. PM 리뷰가 필요합니다.\n"
    });

    db.prepare(
      `UPDATE artifacts
       SET status = 'in_review', review_summary = '직원 실행 결과가 저장되어 PM 리뷰가 필요합니다.', updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(artifactId);

    db.prepare("UPDATE graph_nodes SET status = 'in_review', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(artifactId);
  }

  db.prepare("UPDATE tasks SET status = 'done', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(task.id);
  db.prepare("UPDATE graph_nodes SET status = 'done', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(task.id);
  db.prepare("UPDATE queue_items SET status = 'done', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(queued.id);
  db.prepare(
    `INSERT INTO events (id, type, campaign_id, payload)
     VALUES (?, 'queue_item_done', ?, ?)`
  ).run(createId("event"), queued.campaignId, JSON.stringify({ queueItemId: queued.id, artifactIds: queued.artifactIds }));

  enqueuePmReview(db, queued.campaignId, queued.artifactIds, queued.taskId);

  return {
    queueItem: getQueueItem(db, queued.id),
    message: "직원 실행 결과가 산출물 새 버전으로 저장되었습니다."
  };
}

function runPmReviewQueueItem(db: DatabaseSync, config: AppConfig, queued: QueueItemProjection): QueueRunResponse {
  db.prepare(
    `UPDATE queue_items
     SET status = 'running', attempt = attempt + 1, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(queued.id);

  let blockedDecisionId: string | null = null;
  let reviewedCount = 0;
  let revisionCount = 0;
  let approvedCount = 0;

  for (const artifactId of queued.artifactIds) {
    const detail = getArtifactDetail(db, config, artifactId);
    const ownerAnswer = getAnsweredDecisionAnswer(db, queued.blockedByDecisionId);
    const review = reviewArtifactWithPm(config, detail, ownerAnswer);
    const result: PmReviewResult = review.result;

    reviewedCount += 1;

    if (result === "approved") {
      approvedCount += 1;
      writeCurrentArtifactReview(db, config, artifactId, review.review, review.summary, "approved");
      updateLatestRevisionRequestStatus(db, artifactId, "approved");
      continue;
    }

    if (result === "needs_revision") {
      revisionCount += 1;
      writeCurrentArtifactReview(db, config, artifactId, review.review, review.summary, "needs_revision");
      updateLatestRevisionRequestStatus(db, artifactId, "needs_revision");
      enqueueArtifactRevision(db, queued.campaignId, artifactId, queued.workerId, queued.taskId);
      continue;
    }

    writeCurrentArtifactReview(db, config, artifactId, review.review, review.summary, "blocked");
    blockedDecisionId = createOwnerDecision(
      db,
      queued.campaignId,
      `${detail.artifact.title} 대표 결정 필요`,
      "PM 리뷰 중 대표가 직접 판단해야 할 항목이 발견되었습니다.",
      [artifactId]
    );
  }

  if (blockedDecisionId) {
    db.prepare(
      `UPDATE queue_items
       SET status = 'blocked', blocked_by_decision_id = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(blockedDecisionId, queued.id);

    return {
      queueItem: getQueueItem(db, queued.id),
      message: "대표 결정이 필요해 자동 실행을 멈췄습니다."
    };
  }

  db.prepare("UPDATE queue_items SET status = 'done', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(queued.id);
  db.prepare(
    `INSERT INTO events (id, type, campaign_id, payload)
     VALUES (?, 'pm_review_done', ?, ?)`
  ).run(createId("event"), queued.campaignId, JSON.stringify({ reviewedCount, approvedCount, revisionCount }));

  return {
    queueItem: getQueueItem(db, queued.id),
    message:
      revisionCount > 0
        ? `PM 리뷰가 완료되었습니다. 재작업 ${revisionCount}건을 큐에 추가했습니다.`
        : "PM 리뷰가 완료되었습니다. 산출물이 승인되었습니다."
  };
}

function runArtifactRevisionQueueItem(db: DatabaseSync, config: AppConfig, queued: QueueItemProjection): QueueRunResponse {
  if ((queued.attempt ?? 0) >= queued.maxAttempts) {
    db.prepare("UPDATE queue_items SET status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(queued.id);
    updateRevisionRequestStatus(db, queued.id, "failed");
    return {
      queueItem: getQueueItem(db, queued.id),
      message: "최대 재작업 횟수에 도달해 작업을 중단했습니다."
    };
  }

  db.prepare(
    `UPDATE queue_items
     SET status = 'running', attempt = attempt + 1, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(queued.id);
  updateRevisionRequestStatus(db, queued.id, "running");

  const revisionRequest = getRevisionRequestForQueue(db, queued.id);

  for (const artifactId of queued.artifactIds) {
    const detail = getArtifactDetail(db, config, artifactId);
    const content = createRevisionArtifactContent(config, detail, queued.workerName ?? "AI 직원", revisionRequest?.instruction);

    createArtifactVersion(db, config, {
      artifactId,
      createdBy: queued.workerName ?? "AI 직원",
      sourceQueueItemId: queued.id,
      content,
      review: "재작업 결과가 저장되었습니다. PM 리뷰가 필요합니다.\n"
    });

    db.prepare(
      `UPDATE artifacts
       SET status = 'in_review', review_summary = '재작업 결과가 저장되어 PM 리뷰가 필요합니다.', updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(artifactId);

    db.prepare("UPDATE graph_nodes SET status = 'in_review', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(artifactId);
  }

  db.prepare("UPDATE queue_items SET status = 'done', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(queued.id);
  updateRevisionRequestStatus(db, queued.id, "done");
  db.prepare(
    `INSERT INTO events (id, type, campaign_id, payload)
     VALUES (?, 'artifact_revision_done', ?, ?)`
  ).run(createId("event"), queued.campaignId, JSON.stringify({ queueItemId: queued.id, artifactIds: queued.artifactIds }));

  enqueuePmReview(db, queued.campaignId, queued.artifactIds, queued.taskId);

  return {
    queueItem: getQueueItem(db, queued.id),
    message: "재작업 결과가 산출물 새 버전으로 저장되었습니다."
  };
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

function failQueueRun(db: DatabaseSync, queued: QueueItemProjection, error: unknown): QueueRunResponse {
  const message = getErrorMessage(error, "작업 실행 중 오류가 발생했습니다.");

  db.prepare("UPDATE queue_items SET status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(queued.id);

  if (queued.type === "worker_run" && queued.taskId) {
    db.prepare("UPDATE tasks SET status = 'ready', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(queued.taskId);
    db.prepare("UPDATE graph_nodes SET status = 'ready', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(queued.taskId);
  }

  if (queued.type === "artifact_revision") {
    updateRevisionRequestStatus(db, queued.id, "failed");
  }

  db.prepare(
    `INSERT INTO events (id, type, campaign_id, payload)
     VALUES (?, 'queue_item_failed', ?, ?)`
  ).run(createId("event"), queued.campaignId, JSON.stringify({ queueItemId: queued.id, type: queued.type, message }));

  return {
    queueItem: getQueueItem(db, queued.id),
    message
  };
}

export function runNextQueueItem(db: DatabaseSync, config: AppConfig, campaignId: string): QueueRunResponse {
  const queued = listQueueItems(db, campaignId).find((item) => item.status === "queued");

  if (!queued) {
    return {
      queueItem: null,
      message: "실행할 대기 작업이 없습니다."
    };
  }

  try {
    if (queued.type === "worker_run") {
      return runWorkerQueueItem(db, config, queued);
    }

    if (queued.type === "pm_review") {
      return runPmReviewQueueItem(db, config, queued);
    }

    if (queued.type === "artifact_revision") {
      return runArtifactRevisionQueueItem(db, config, queued);
    }
  } catch (error: unknown) {
    return failQueueRun(db, queued, error);
  }

  db.prepare("UPDATE queue_items SET status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(queued.id);
  return {
    queueItem: getQueueItem(db, queued.id),
    message: "지원하지 않는 작업 큐 유형입니다."
  };
}
