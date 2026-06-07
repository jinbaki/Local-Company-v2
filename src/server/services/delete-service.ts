import type { DatabaseSync } from "node:sqlite";
import type { AppConfig } from "../config.js";
import type { DeleteCampaignResponse, DeleteDivisionResponse } from "../../shared/types/app-state.js";
import { removeManagedDataDirectory } from "../storage/file-store.js";
import { getDefaultDivisionId } from "./division-service.js";

interface CampaignDeleteRow {
  id: string;
  divisionId: string;
  title: string;
}

interface DivisionDeleteRow {
  id: string;
  name: string;
}

function withTransaction<T>(db: DatabaseSync, callback: () => T): T {
  db.exec("BEGIN IMMEDIATE;");
  try {
    const result = callback();
    db.exec("COMMIT;");
    return result;
  } catch (error: unknown) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

function getCampaignDeleteRow(db: DatabaseSync, campaignId: string): CampaignDeleteRow {
  const campaign = db
    .prepare(
      `SELECT
        id,
        division_id AS divisionId,
        title
      FROM campaigns
      WHERE id = ?`
    )
    .get(campaignId) as unknown as CampaignDeleteRow | undefined;

  if (!campaign) {
    throw new Error("캠페인을 찾을 수 없습니다.");
  }

  return campaign;
}

function deleteCampaignRecords(db: DatabaseSync, campaignId: string): CampaignDeleteRow {
  const campaign = getCampaignDeleteRow(db, campaignId);

  db.prepare("DELETE FROM artifact_revision_requests WHERE campaign_id = ?").run(campaignId);
  db.prepare("DELETE FROM artifact_versions WHERE artifact_id IN (SELECT id FROM artifacts WHERE campaign_id = ?)").run(campaignId);
  db.prepare("DELETE FROM graph_edges WHERE campaign_id = ?").run(campaignId);
  db.prepare("DELETE FROM messages WHERE campaign_id = ?").run(campaignId);
  db.prepare("DELETE FROM conversations WHERE campaign_id = ?").run(campaignId);
  db.prepare("DELETE FROM campaign_references WHERE campaign_id = ?").run(campaignId);
  db.prepare("DELETE FROM campaign_team_proposals WHERE campaign_id = ?").run(campaignId);
  db.prepare("DELETE FROM worker_sessions WHERE campaign_id = ?").run(campaignId);
  db.prepare("DELETE FROM campaign_workers WHERE campaign_id = ?").run(campaignId);
  db.prepare("DELETE FROM queue_items WHERE campaign_id = ?").run(campaignId);
  db.prepare("DELETE FROM decisions WHERE campaign_id = ?").run(campaignId);
  db.prepare("DELETE FROM tasks WHERE campaign_id = ?").run(campaignId);
  db.prepare("DELETE FROM artifacts WHERE campaign_id = ?").run(campaignId);
  db.prepare("DELETE FROM graph_nodes WHERE campaign_id = ?").run(campaignId);
  db.prepare("DELETE FROM events WHERE campaign_id = ?").run(campaignId);
  db.prepare("DELETE FROM campaigns WHERE id = ?").run(campaignId);

  return campaign;
}

export function deleteCampaign(db: DatabaseSync, config: AppConfig, campaignId: string): DeleteCampaignResponse {
  const campaign = withTransaction(db, () => deleteCampaignRecords(db, campaignId));
  const deletedFolderPath = removeManagedDataDirectory(config, "divisions", campaign.divisionId, "campaigns", campaign.id);

  return {
    campaignId: campaign.id,
    deletedFolderPath,
    message: "캠페인과 연결된 로컬 데이터를 삭제했습니다."
  };
}

export function deleteDivision(db: DatabaseSync, config: AppConfig, divisionId: string): DeleteDivisionResponse {
  if (divisionId === getDefaultDivisionId()) {
    throw new Error("기본 사업부는 삭제할 수 없습니다. 이름과 PM은 사업부 수정에서 바꿀 수 있습니다.");
  }

  const division = db
    .prepare(
      `SELECT
        id,
        name
      FROM divisions
      WHERE id = ?`
    )
    .get(divisionId) as unknown as DivisionDeleteRow | undefined;

  if (!division) {
    throw new Error("사업부를 찾을 수 없습니다.");
  }

  const campaigns = db
    .prepare("SELECT id FROM campaigns WHERE division_id = ? ORDER BY created_at ASC")
    .all(divisionId) as unknown as Array<{ id: string }>;
  const workerCount = (
    db.prepare("SELECT COUNT(*) AS count FROM workers WHERE division_id = ?").get(divisionId) as unknown as { count: number }
  ).count;

  withTransaction(db, () => {
    for (const campaign of campaigns) {
      deleteCampaignRecords(db, campaign.id);
    }

    db.prepare("DELETE FROM workers WHERE division_id = ?").run(divisionId);
    db.prepare("DELETE FROM divisions WHERE id = ?").run(divisionId);
  });

  const deletedFolderPath = removeManagedDataDirectory(config, "divisions", division.id);

  return {
    divisionId: division.id,
    deletedCampaignCount: campaigns.length,
    deletedWorkerCount: workerCount,
    deletedFolderPath,
    message: "사업부와 연결된 캠페인, 직원, 로컬 폴더를 삭제했습니다."
  };
}
