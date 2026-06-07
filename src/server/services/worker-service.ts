import type { DatabaseSync } from "node:sqlite";
import type { AssignWorkerRequest, CampaignWorkerSummary, CreateWorkerRequest, WorkerSummary } from "../../shared/types/app-state.js";
import { createId } from "./ids.js";
import { ensureDefaultDivision, getDefaultExecutionWorkerId } from "./division-service.js";

export function createWorker(db: DatabaseSync, input: CreateWorkerRequest): WorkerSummary {
  ensureDefaultDivision(db);

  const name = input.name.trim();
  const position = input.position.trim();

  if (!name || !position) {
    throw new Error("직원 이름과 포지션을 입력하세요.");
  }

  const workerId = createId("worker");

  db.prepare(
    `INSERT INTO workers (id, division_id, name, position, skills, work_style, status)
     VALUES (?, ?, ?, ?, ?, ?, 'active')`
  ).run(workerId, input.divisionId, name, position, JSON.stringify(input.skills ?? []), input.workStyle ?? "");

  const worker = db
    .prepare(
      `SELECT
        id,
        division_id AS divisionId,
        name,
        position,
        status
      FROM workers
      WHERE id = ?`
    )
    .get(workerId) as unknown as WorkerSummary | undefined;

  if (!worker) {
    throw new Error("직원을 생성했지만 다시 조회하지 못했습니다.");
  }

  return worker;
}

export function assignWorkerToCampaign(
  db: DatabaseSync,
  campaignId: string,
  input: AssignWorkerRequest
): CampaignWorkerSummary {
  db.prepare(
    `INSERT INTO campaign_workers (campaign_id, worker_id, role, status, updated_at)
     VALUES (?, ?, ?, 'assigned', CURRENT_TIMESTAMP)
     ON CONFLICT(campaign_id, worker_id)
     DO UPDATE SET role = excluded.role, status = 'assigned', updated_at = CURRENT_TIMESTAMP`
  ).run(campaignId, input.workerId, input.role ?? "AI 직원");

  const assigned = listCampaignWorkers(db, campaignId).find((worker) => worker.workerId === input.workerId);
  if (!assigned) {
    throw new Error("직원을 배정했지만 다시 조회하지 못했습니다.");
  }

  return assigned;
}

export function ensureDefaultExecutionWorkerAssigned(db: DatabaseSync, campaignId: string): CampaignWorkerSummary {
  ensureDefaultDivision(db);
  return assignWorkerToCampaign(db, campaignId, {
    workerId: getDefaultExecutionWorkerId(),
    role: "AI 실행 직원"
  });
}

export function listCampaignWorkers(db: DatabaseSync, campaignId: string): CampaignWorkerSummary[] {
  return db
    .prepare(
      `SELECT
        cw.worker_id AS workerId,
        cw.campaign_id AS campaignId,
        w.name,
        w.position,
        cw.role,
        cw.status AS assignmentStatus,
        w.status AS workerStatus,
        COALESCE(ws.status, 'not_started') AS sessionStatus,
        ws.session_id AS sessionId,
        ws.last_used_at AS lastUsedAt
      FROM campaign_workers cw
      JOIN workers w ON w.id = cw.worker_id
      LEFT JOIN worker_sessions ws ON ws.worker_id = cw.worker_id AND ws.campaign_id = cw.campaign_id
      WHERE cw.campaign_id = ?
      ORDER BY cw.created_at ASC, cw.rowid ASC`
    )
    .all(campaignId) as unknown as CampaignWorkerSummary[];
}

export function startWorkerSession(db: DatabaseSync, campaignId: string, workerId: string): CampaignWorkerSummary {
  const existing = db
    .prepare("SELECT id FROM worker_sessions WHERE campaign_id = ? AND worker_id = ?")
    .get(campaignId, workerId) as unknown as { id: string } | undefined;
  const sessionId = `mock-session-${workerId}-${Date.now()}`;

  if (existing) {
    db.prepare(
      `UPDATE worker_sessions
       SET session_id = ?, status = 'ready', last_used_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(sessionId, existing.id);
  } else {
    db.prepare(
      `INSERT INTO worker_sessions (id, worker_id, campaign_id, session_id, status, last_used_at)
       VALUES (?, ?, ?, ?, 'ready', CURRENT_TIMESTAMP)`
    ).run(createId("worker-session"), workerId, campaignId, sessionId);
  }

  const assigned = listCampaignWorkers(db, campaignId).find((worker) => worker.workerId === workerId);
  if (!assigned) {
    throw new Error("세션을 시작했지만 캠페인 배정을 찾지 못했습니다.");
  }

  return assigned;
}

export function ensureReadyWorkerSession(db: DatabaseSync, campaignId: string, workerId: string): CampaignWorkerSummary {
  const assigned = listCampaignWorkers(db, campaignId).find((worker) => worker.workerId === workerId);
  if (assigned?.sessionStatus === "ready") {
    return assigned;
  }

  return startWorkerSession(db, campaignId, workerId);
}
