import type { DatabaseSync } from "node:sqlite";
import type { AppConfig } from "../config.js";
import type {
  CampaignSummary,
  CreateCampaignRequest,
  UpdateCampaignStatusRequest,
  WorkerSummary
} from "../../shared/types/app-state.js";
import { ensureCampaignFolders } from "../storage/file-store.js";
import { createId } from "./ids.js";
import { ensureDefaultDivision, getDivisionLeadWorkerId } from "./division-service.js";
import { ensureConversation } from "./conversation-service.js";
import { assignWorkerToCampaign } from "./worker-service.js";

export function listCampaigns(db: DatabaseSync): CampaignSummary[] {
  ensureDefaultDivision(db);

  return db
    .prepare(
      `SELECT
        c.id,
        c.division_id AS divisionId,
        c.title,
        c.summary,
        c.pm_worker_id AS pmWorkerId,
        w.name AS pmName,
        c.status,
        c.current_focus AS currentFocus,
        c.health,
        c.updated_at AS updatedAt
      FROM campaigns c
      LEFT JOIN workers w ON w.id = c.pm_worker_id
      ORDER BY c.updated_at DESC`
    )
    .all() as unknown as CampaignSummary[];
}

export function getCampaign(db: DatabaseSync, campaignId: string): CampaignSummary | null {
  const campaign = db
    .prepare(
      `SELECT
        c.id,
        c.division_id AS divisionId,
        c.title,
        c.summary,
        c.pm_worker_id AS pmWorkerId,
        w.name AS pmName,
        c.status,
        c.current_focus AS currentFocus,
        c.health,
        c.updated_at AS updatedAt
      FROM campaigns c
      LEFT JOIN workers w ON w.id = c.pm_worker_id
      WHERE c.id = ?`
    )
    .get(campaignId) as unknown as CampaignSummary | undefined;

  return campaign ?? null;
}

export function getCampaignPm(db: DatabaseSync, campaignId: string): WorkerSummary | null {
  const worker = db
    .prepare(
      `SELECT
        w.id,
        w.division_id AS divisionId,
        w.name,
        w.position,
        w.status
      FROM campaigns c
      JOIN workers w ON w.id = c.pm_worker_id
      WHERE c.id = ?`
    )
    .get(campaignId) as unknown as WorkerSummary | undefined;

  return worker ?? null;
}

export function createCampaign(db: DatabaseSync, config: AppConfig, input: CreateCampaignRequest): CampaignSummary {
  ensureDefaultDivision(db);

  const title = input.title.trim();
  if (!title) {
    throw new Error("캠페인명을 입력하세요.");
  }

  const campaignId = createId("campaign");
  const pmWorkerId = getDivisionLeadWorkerId(db, input.divisionId);
  const summary = input.summary?.trim() ?? "";
  const currentFocus = summary || "대표의 첫 지시를 기다리는 중";

  db.prepare(
    `INSERT INTO campaigns (
      id,
      division_id,
      title,
      summary,
      pm_worker_id,
      status,
      current_focus,
      health
    )
    VALUES (?, ?, ?, ?, ?, 'planning', ?, 'normal')`
  ).run(campaignId, input.divisionId, title, summary, pmWorkerId, currentFocus);

  assignWorkerToCampaign(db, campaignId, {
    workerId: pmWorkerId,
    role: "캠페인 PM"
  });

  ensureCampaignFolders(config, input.divisionId, campaignId);
  ensureConversation(db, config, campaignId);

  db.prepare(
    `INSERT INTO events (id, type, campaign_id, payload)
     VALUES (?, 'campaign_created', ?, ?)`
  ).run(createId("event"), campaignId, JSON.stringify({ title, divisionId: input.divisionId }));

  const campaign = getCampaign(db, campaignId);
  if (!campaign) {
    throw new Error("캠페인을 생성했지만 다시 조회하지 못했습니다.");
  }

  return campaign;
}

const allowedCampaignStatuses = new Set(["planning", "running", "review", "blocked", "done", "archived"]);

function statusFocus(status: string, fallback: string): string {
  if (status === "done") {
    return "캠페인이 완료되어 산출물과 인계 보고서를 기준으로 보관합니다.";
  }

  return fallback;
}

export function updateCampaignStatus(
  db: DatabaseSync,
  campaignId: string,
  input: UpdateCampaignStatusRequest
): CampaignSummary {
  const status = input.status.trim();
  if (!allowedCampaignStatuses.has(status)) {
    throw new Error("지원하지 않는 캠페인 상태입니다.");
  }

  const current = getCampaign(db, campaignId);
  if (!current) {
    throw new Error("캠페인을 찾을 수 없습니다.");
  }

  const currentFocus = statusFocus(status, current.currentFocus);
  db.prepare(
    `UPDATE campaigns
     SET status = ?, current_focus = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(status, currentFocus, campaignId);

  db.prepare(
    `INSERT INTO events (id, type, campaign_id, payload)
     VALUES (?, 'campaign_status_updated', ?, ?)`
  ).run(createId("event"), campaignId, JSON.stringify({ from: current.status, to: status }));

  const updated = getCampaign(db, campaignId);
  if (!updated) {
    throw new Error("캠페인 상태를 저장했지만 다시 조회하지 못했습니다.");
  }

  return updated;
}
