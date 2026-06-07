import type { DatabaseSync } from "node:sqlite";
import type {
  ListNotificationsResponse,
  LocalCompanyNotification,
  MarkNotificationsSeenResponse
} from "../../shared/types/app-state.js";

interface EventRow {
  sequence: number;
  eventId: string;
  type: string;
  campaignId: string | null;
  campaignTitle: string | null;
  payload: string;
  createdAt: string;
}

interface NotificationQuery {
  afterSequence?: number;
  limit?: number;
  includeSeen?: boolean;
}

const lastSeenKey = "notifications.lastSeenSequence";
const notificationEventTypes = [
  "pm_reply_created",
  "pm_actions_applied",
  "campaign_team_proposal_created",
  "decision_requested",
  "queue_item_done",
  "pm_review_done",
  "artifact_revision_done",
  "queue_item_failed"
];

function parsePayload(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function compact(value: string, maxLength = 160): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}...`;
}

function placeholders(): string {
  return notificationEventTypes.map(() => "?").join(", ");
}

function getMetaNumber(db: DatabaseSync, key: string): number {
  const row = db.prepare("SELECT value FROM app_meta WHERE key = ?").get(key) as { value: string } | undefined;
  const parsed = Number.parseInt(row?.value ?? "0", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function setMetaNumber(db: DatabaseSync, key: string, value: number): void {
  db.prepare(
    `INSERT INTO app_meta (key, value, updated_at)
     VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`
  ).run(key, String(Math.max(0, Math.floor(value))));
}

function getLatestNotificationSequence(db: DatabaseSync): number {
  const row = db
    .prepare(`SELECT COALESCE(MAX(rowid), 0) AS sequence FROM events WHERE type IN (${placeholders()})`)
    .get(...notificationEventTypes) as { sequence: number } | undefined;
  return row?.sequence ?? 0;
}

function countUnseenNotifications(db: DatabaseSync, lastSeenSequence: number): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS count FROM events WHERE rowid > ? AND type IN (${placeholders()})`)
    .get(lastSeenSequence, ...notificationEventTypes) as { count: number } | undefined;
  return row?.count ?? 0;
}

function titleForEvent(type: string, payload: Record<string, unknown>): string {
  if (type === "pm_reply_created") {
    return `${stringValue(payload.pmName) || "PM"} 답변 도착`;
  }

  if (type === "pm_actions_applied") {
    return "운영판 반영 완료";
  }

  if (type === "campaign_team_proposal_created") {
    return "PM 팀 제안 도착";
  }

  if (type === "decision_requested") {
    return "대표 결정 필요";
  }

  if (type === "queue_item_done") {
    return "산출물 초안 생성";
  }

  if (type === "pm_review_done") {
    const approvedCount = numberValue(payload.approvedCount);
    const revisionCount = numberValue(payload.revisionCount);
    if (approvedCount > 0 && revisionCount === 0) {
      return "산출물 승인 완료";
    }
    if (revisionCount > 0) {
      return "PM 리뷰 완료: 재작업 필요";
    }
    return "PM 리뷰 완료";
  }

  if (type === "artifact_revision_done") {
    return "산출물 재작업 완료";
  }

  if (type === "queue_item_failed") {
    return "AI 작업 실패";
  }

  return "Local Company 알림";
}

function summaryForEvent(type: string, payload: Record<string, unknown>): string {
  if (type === "pm_reply_created") {
    return compact(stringValue(payload.preview) || "PM 답변이 도착했습니다.");
  }

  if (type === "pm_actions_applied") {
    const accepted = Array.isArray(payload.accepted) ? payload.accepted.length : 0;
    const rejected = Array.isArray(payload.rejected) ? payload.rejected.length : 0;
    return `자동 반영 ${accepted}건, 보류 ${rejected}건`;
  }

  if (type === "campaign_team_proposal_created") {
    return compact(stringValue(payload.title) || "PM이 캠페인 팀 구성을 제안했습니다.");
  }

  if (type === "decision_requested") {
    return compact(stringValue(payload.title) || "대표 판단이 필요한 항목이 생겼습니다.");
  }

  if (type === "queue_item_done") {
    const artifactCount = stringArrayValue(payload.artifactIds).length;
    return artifactCount > 0 ? `${artifactCount}개 산출물이 PM 리뷰 대기 상태가 되었습니다.` : "작업 큐가 완료되었습니다.";
  }

  if (type === "pm_review_done") {
    return `검토 ${numberValue(payload.reviewedCount)}건, 승인 ${numberValue(payload.approvedCount)}건, 재작업 ${numberValue(payload.revisionCount)}건`;
  }

  if (type === "artifact_revision_done") {
    const artifactCount = stringArrayValue(payload.artifactIds).length;
    return artifactCount > 0 ? `${artifactCount}개 산출물 재작업 결과가 저장되었습니다.` : "산출물 재작업이 완료되었습니다.";
  }

  if (type === "queue_item_failed") {
    return compact(stringValue(payload.message) || "AI 작업 실행 중 오류가 발생했습니다.");
  }

  return compact(JSON.stringify(payload));
}

function rowToNotification(row: EventRow, lastSeenSequence: number): LocalCompanyNotification {
  const payload = parsePayload(row.payload);

  return {
    sequence: row.sequence,
    eventId: row.eventId,
    type: row.type,
    campaignId: row.campaignId,
    campaignTitle: row.campaignTitle,
    title: titleForEvent(row.type, payload),
    summary: summaryForEvent(row.type, payload),
    createdAt: row.createdAt,
    seen: row.sequence <= lastSeenSequence
  };
}

export function listNotifications(db: DatabaseSync, query: NotificationQuery = {}): ListNotificationsResponse {
  const limit = Math.max(1, Math.min(query.limit ?? 20, 50));
  const lastSeenSequence = getMetaNumber(db, lastSeenKey);
  const afterSequence = query.afterSequence ?? (query.includeSeen ? 0 : lastSeenSequence);
  const rows = db
    .prepare(
      `SELECT
        e.rowid AS sequence,
        e.id AS eventId,
        e.type,
        e.campaign_id AS campaignId,
        c.title AS campaignTitle,
        e.payload,
        e.created_at AS createdAt
      FROM events e
      LEFT JOIN campaigns c ON c.id = e.campaign_id
      WHERE e.rowid > ?
        AND e.type IN (${placeholders()})
      ORDER BY e.rowid ASC
      LIMIT ?`
    )
    .all(afterSequence, ...notificationEventTypes, limit) as unknown as EventRow[];

  return {
    notifications: rows.map((row) => rowToNotification(row, lastSeenSequence)),
    latestSequence: getLatestNotificationSequence(db),
    lastSeenSequence,
    unseenCount: countUnseenNotifications(db, lastSeenSequence)
  };
}

export function markNotificationsSeen(db: DatabaseSync, sequence?: number): MarkNotificationsSeenResponse {
  const latestSequence = getLatestNotificationSequence(db);
  const current = getMetaNumber(db, lastSeenKey);
  const next = Math.max(current, Math.min(sequence ?? latestSequence, latestSequence));
  setMetaNumber(db, lastSeenKey, next);

  return {
    lastSeenSequence: next,
    unseenCount: countUnseenNotifications(db, next),
    message: "알림 확인 위치를 저장했습니다."
  };
}
