import type { DatabaseSync } from "node:sqlite";
import type {
  ArtifactRevisionRequestProjection,
  RequestArtifactRevisionRequest,
  RequestArtifactRevisionResponse
} from "../../shared/types/app-state.js";
import { createId } from "./ids.js";

interface ArtifactCampaignRow {
  id: string;
  campaignId: string;
  title: string;
}

function normalizeRevisionRequest(row: {
  id: string;
  campaignId: string;
  artifactId: string;
  taskId: string;
  queueItemId: string | null;
  instruction: string;
  status: string;
  updatedAt: string;
}): ArtifactRevisionRequestProjection {
  return row;
}

function getArtifactCampaign(db: DatabaseSync, artifactId: string): ArtifactCampaignRow | null {
  const row = db
    .prepare(
      `SELECT
        id,
        campaign_id AS campaignId,
        title
       FROM artifacts
       WHERE id = ?`
    )
    .get(artifactId) as unknown as ArtifactCampaignRow | undefined;

  return row ?? null;
}

export function listArtifactRevisionRequests(db: DatabaseSync, artifactId: string): ArtifactRevisionRequestProjection[] {
  const rows = db
    .prepare(
      `SELECT
        id,
        campaign_id AS campaignId,
        artifact_id AS artifactId,
        task_id AS taskId,
        queue_item_id AS queueItemId,
        instruction,
        status,
        updated_at AS updatedAt
      FROM artifact_revision_requests
      WHERE artifact_id = ?
      ORDER BY created_at DESC, rowid DESC`
    )
    .all(artifactId) as unknown as ArtifactRevisionRequestProjection[];

  return rows.map(normalizeRevisionRequest);
}

function getRevisionRequestById(db: DatabaseSync, requestId: string): ArtifactRevisionRequestProjection | null {
  const row = db
    .prepare(
      `SELECT
        id,
        campaign_id AS campaignId,
        artifact_id AS artifactId,
        task_id AS taskId,
        queue_item_id AS queueItemId,
        instruction,
        status,
        updated_at AS updatedAt
      FROM artifact_revision_requests
      WHERE id = ?`
    )
    .get(requestId) as unknown as ArtifactRevisionRequestProjection | undefined;

  return row ? normalizeRevisionRequest(row) : null;
}

function getExistingRevisionRequest(
  db: DatabaseSync,
  artifactId: string,
  instruction: string
): ArtifactRevisionRequestProjection | null {
  const row = db
    .prepare(
      `SELECT
        id,
        campaign_id AS campaignId,
        artifact_id AS artifactId,
        task_id AS taskId,
        queue_item_id AS queueItemId,
        instruction,
        status,
        updated_at AS updatedAt
      FROM artifact_revision_requests
      WHERE artifact_id = ? AND instruction = ? AND status IN ('queued', 'running', 'done', 'approved', 'needs_revision')
      ORDER BY created_at DESC, rowid DESC
      LIMIT 1`
    )
    .get(artifactId, instruction) as unknown as ArtifactRevisionRequestProjection | undefined;

  return row ? normalizeRevisionRequest(row) : null;
}

function uniqueRelatedArtifactIds(artifactId: string, relatedArtifactIds: string[] | undefined): string[] {
  return Array.from(new Set((relatedArtifactIds ?? []).filter((relatedId) => relatedId && relatedId !== artifactId)));
}

export function requestArtifactRevision(
  db: DatabaseSync,
  artifactId: string,
  input: RequestArtifactRevisionRequest
): RequestArtifactRevisionResponse {
  const artifact = getArtifactCampaign(db, artifactId);
  if (!artifact) {
    throw new Error("수정할 산출물을 찾을 수 없습니다.");
  }

  const instruction = input.instruction.trim();
  if (!instruction) {
    throw new Error("수정 요청 내용을 입력하세요.");
  }

  const existing = getExistingRevisionRequest(db, artifactId, instruction);
  if (existing) {
    return {
      revisionRequest: existing,
      created: false,
      message: "이미 같은 수정 요청이 접수되어 중복으로 큐에 넣지 않았습니다."
    };
  }

  const requestId = createId("revision");
  const taskId = createId("task");
  const queueItemId = createId("queue");
  const relatedArtifactIds = uniqueRelatedArtifactIds(artifactId, input.relatedArtifactIds);
  const taskTitle = `${artifact.title} 수정 요청`;

  db.prepare(
    `INSERT INTO tasks (
      id,
      campaign_id,
      title,
      description,
      status,
      instructions,
      acceptance_criteria,
      artifact_ids,
      priority
    )
    VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, 'normal')`
  ).run(
    taskId,
    artifact.campaignId,
    taskTitle,
    "대표가 요청한 산출물 수정 작업",
    instruction,
    "대표 수정 요청이 반영된 새 산출물 버전이 생성되고 PM 리뷰를 통과해야 한다.",
    JSON.stringify([artifactId])
  );

  db.prepare(
    `INSERT INTO graph_nodes (id, campaign_id, type, title, status, summary)
     VALUES (?, ?, 'task', ?, 'queued', ?)`
  ).run(taskId, artifact.campaignId, taskTitle, instruction);

  db.prepare(
    `INSERT INTO graph_edges (id, campaign_id, from_node_id, to_node_id, relation)
     VALUES (?, ?, ?, ?, 'revises')`
  ).run(createId("edge"), artifact.campaignId, taskId, artifactId);

  for (const relatedArtifactId of relatedArtifactIds) {
    const relatedArtifact = getArtifactCampaign(db, relatedArtifactId);
    if (!relatedArtifact || relatedArtifact.campaignId !== artifact.campaignId) {
      continue;
    }

    db.prepare(
      `INSERT INTO graph_edges (id, campaign_id, from_node_id, to_node_id, relation)
       VALUES (?, ?, ?, ?, 'references')`
    ).run(createId("edge"), artifact.campaignId, artifactId, relatedArtifactId);
  }

  db.prepare(
    `INSERT INTO queue_items (
      id,
      type,
      status,
      campaign_id,
      task_id,
      artifact_ids,
      max_attempts
    )
    VALUES (?, 'artifact_revision', 'queued', ?, ?, ?, 2)`
  ).run(queueItemId, artifact.campaignId, taskId, JSON.stringify([artifactId]));

  db.prepare(
    `INSERT INTO artifact_revision_requests (
      id,
      campaign_id,
      artifact_id,
      task_id,
      queue_item_id,
      instruction,
      status
    )
    VALUES (?, ?, ?, ?, ?, ?, 'queued')`
  ).run(requestId, artifact.campaignId, artifactId, taskId, queueItemId, instruction);

  db.prepare(
    `UPDATE artifacts
     SET status = 'needs_revision', review_summary = '대표 수정 요청이 접수되어 재작업 대기 중입니다.', updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(artifactId);

  db.prepare(
    `UPDATE graph_nodes
     SET status = 'needs_revision', summary = '대표 수정 요청이 접수되어 재작업 대기 중입니다.', updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND type = 'artifact'`
  ).run(artifactId);

  db.prepare(
    `INSERT INTO events (id, type, campaign_id, payload)
     VALUES (?, 'artifact_revision_requested', ?, ?)`
  ).run(
    createId("event"),
    artifact.campaignId,
    JSON.stringify({
      requestId,
      artifactId,
      taskId,
      queueItemId,
      instruction,
      relatedArtifactIds
    })
  );

  const revisionRequest = getRevisionRequestById(db, requestId);
  if (!revisionRequest) {
    throw new Error("수정 요청을 저장했지만 다시 조회하지 못했습니다.");
  }

  return {
    revisionRequest,
    created: true,
    message: "수정 요청을 접수했고 재작업 큐에 추가했습니다."
  };
}
