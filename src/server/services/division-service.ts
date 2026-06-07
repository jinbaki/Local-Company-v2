import type { DatabaseSync } from "node:sqlite";
import type { AppConfig } from "../config.js";
import type { CreateDivisionRequest, DivisionSummary, UpdateDivisionRequest, WorkerSummary } from "../../shared/types/app-state.js";
import { ensureDivisionFolders } from "../storage/file-store.js";
import { createId } from "./ids.js";

const defaultDivisionId = "division-default";
const defaultLeadWorkerId = "worker-default-pm";
const defaultExecutionWorkerId = "worker-default-execution";
const reservedFolderNames = new Set(["con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9"]);

function normalizeFolderName(value: string | undefined): string | null {
  const folderName = value?.trim();
  if (!folderName) {
    return null;
  }

  if (!/^[\p{L}\p{N}_-]{1,64}$/u.test(folderName)) {
    throw new Error("사업부 폴더 이름은 공백 없이 한글, 영문, 숫자, 하이픈, 밑줄만 사용할 수 있습니다.");
  }

  if (reservedFolderNames.has(folderName.toLowerCase())) {
    throw new Error("이 폴더 이름은 사용할 수 없습니다.");
  }

  return folderName;
}

export function ensureDefaultDivision(db: DatabaseSync): void {
  db.prepare(
    `INSERT OR IGNORE INTO divisions (id, name, description, lead_worker_id, status)
     VALUES (?, ?, ?, ?, 'active')`
  ).run(
    defaultDivisionId,
    "기본 사업부",
    "Local Company V2의 첫 캠페인을 운영하는 기본 사업부입니다.",
    defaultLeadWorkerId
  );

  db.prepare(
    `INSERT OR IGNORE INTO workers (id, division_id, name, position, skills, work_style, status)
     VALUES (?, ?, ?, ?, ?, ?, 'active')`
  ).run(
    defaultLeadWorkerId,
    defaultDivisionId,
    "김하늘",
    "사업부 리드 / 캠페인 PM",
    JSON.stringify(["목표 구조화", "실행 계획", "산출물 리뷰"]),
    "대표의 의도를 정리하고 다음 행동을 제안합니다."
  );

  db.prepare(
    `INSERT OR IGNORE INTO workers (id, division_id, name, position, skills, work_style, status)
     VALUES (?, ?, ?, ?, ?, ?, 'active')`
  ).run(
    defaultExecutionWorkerId,
    defaultDivisionId,
    "박도현",
    "AI 실행 직원",
    JSON.stringify(["자료 정리", "초안 작성", "산출물 보강"]),
    "PM의 작업지시를 받아 산출물을 실제 문서로 확장합니다."
  );

  db.prepare(
    `UPDATE divisions
     SET lead_worker_id = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND (lead_worker_id IS NULL OR lead_worker_id = '')`
  ).run(defaultLeadWorkerId, defaultDivisionId);
}

export function listDivisions(db: DatabaseSync): DivisionSummary[] {
  ensureDefaultDivision(db);

  return db
    .prepare(
      `SELECT
        d.id,
        d.id AS folderName,
        d.name,
        d.description,
        d.lead_worker_id AS leadWorkerId,
        w.name AS leadWorkerName,
        d.status,
        d.updated_at AS updatedAt,
        COUNT(DISTINCT c.id) AS campaignCount,
        COUNT(DISTINCT worker.id) AS workerCount
      FROM divisions d
      LEFT JOIN workers w ON w.id = d.lead_worker_id
      LEFT JOIN campaigns c ON c.division_id = d.id
      LEFT JOIN workers worker ON worker.division_id = d.id
      GROUP BY d.id
      ORDER BY d.created_at ASC`
    )
    .all() as unknown as DivisionSummary[];
}

export function listWorkers(db: DatabaseSync): WorkerSummary[] {
  ensureDefaultDivision(db);

  return db
    .prepare(
      `SELECT
        id,
        division_id AS divisionId,
        name,
        position,
        status
      FROM workers
      ORDER BY created_at ASC`
    )
    .all() as unknown as WorkerSummary[];
}

export function getDivisionLeadWorkerId(db: DatabaseSync, divisionId: string): string {
  ensureDefaultDivision(db);

  const row = db
    .prepare("SELECT lead_worker_id AS leadWorkerId FROM divisions WHERE id = ?")
    .get(divisionId) as unknown as { leadWorkerId: string | null } | undefined;

  if (!row) {
    throw new Error("사업부를 찾을 수 없습니다.");
  }

  if (row.leadWorkerId) {
    return row.leadWorkerId;
  }

  return getDefaultLeadWorkerId();
}

export function createDivision(db: DatabaseSync, config: AppConfig, input: CreateDivisionRequest): DivisionSummary {
  ensureDefaultDivision(db);

  const name = input.name.trim();
  if (!name) {
    throw new Error("사업부 이름을 입력하세요.");
  }

  const requestedFolderName = normalizeFolderName(input.folderName);
  const divisionId = requestedFolderName ?? createId("division");
  const leadWorkerId = createId("worker");
  const description = input.description?.trim() || `${name}의 캠페인과 산출물을 운영하는 사업부입니다.`;
  const leadWorkerName = input.leadWorkerName?.trim() || `${name} PM`;

  const existing = db.prepare("SELECT id FROM divisions WHERE id = ?").get(divisionId);
  if (existing) {
    throw new Error("이미 같은 사업부 폴더가 있습니다. 다른 폴더 이름을 사용하세요.");
  }

  db.prepare(
    `INSERT INTO divisions (id, name, description, lead_worker_id, status)
     VALUES (?, ?, ?, ?, 'active')`
  ).run(divisionId, name, description, leadWorkerId);

  db.prepare(
    `INSERT INTO workers (id, division_id, name, position, skills, work_style, status)
     VALUES (?, ?, ?, ?, ?, ?, 'active')`
  ).run(
    leadWorkerId,
    divisionId,
    leadWorkerName,
    "사업부 리드 / 캠페인 PM",
    JSON.stringify(["목표 구조화", "실행 계획", "산출물 리뷰"]),
    "대표의 의도를 정리하고 다음 행동을 제안합니다."
  );

  ensureDivisionFolders(config, divisionId);

  const created = listDivisions(db).find((division) => division.id === divisionId);
  if (!created) {
    throw new Error("사업부를 생성했지만 다시 조회하지 못했습니다.");
  }

  return created;
}

export function updateDivision(db: DatabaseSync, divisionId: string, input: UpdateDivisionRequest): DivisionSummary {
  ensureDefaultDivision(db);

  const name = input.name.trim();
  if (!name) {
    throw new Error("사업부 이름을 입력하세요.");
  }

  const current = listDivisions(db).find((division) => division.id === divisionId);
  if (!current) {
    throw new Error("사업부를 찾을 수 없습니다.");
  }

  const description = input.description?.trim() ?? "";
  const leadWorkerName = input.leadWorkerName?.trim();
  if (input.leadWorkerName !== undefined && !leadWorkerName) {
    throw new Error("사업부 리드 / PM 이름을 입력하세요.");
  }

  db.prepare(
    `UPDATE divisions
     SET name = ?, description = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(name, description, divisionId);

  if (leadWorkerName && current.leadWorkerId) {
    db.prepare(
      `UPDATE workers
       SET name = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(leadWorkerName, current.leadWorkerId);
  }

  const updated = listDivisions(db).find((division) => division.id === divisionId);
  if (!updated) {
    throw new Error("사업부를 수정했지만 다시 조회하지 못했습니다.");
  }

  return updated;
}

export function getDefaultDivisionId(): string {
  return defaultDivisionId;
}

export function getDefaultLeadWorkerId(): string {
  return defaultLeadWorkerId;
}

export function getDefaultExecutionWorkerId(): string {
  return defaultExecutionWorkerId;
}
