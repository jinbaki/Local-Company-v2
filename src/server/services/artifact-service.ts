import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { marked } from "marked";
import type { AppConfig } from "../config.js";
import type {
  ArtifactDetailResponse,
  ArtifactProjection,
  ArtifactRelationProjection,
  ArtifactVersionSummary
} from "../../shared/types/app-state.js";
import { ensureDir } from "../storage/file-store.js";
import { listArtifactRevisionRequests } from "./revision-service.js";

interface ArtifactRecord extends ArtifactProjection {
  campaignId: string;
  divisionId: string;
}

interface CreateArtifactVersionInput {
  artifactId: string;
  createdBy: string;
  content: string;
  review?: string;
  sourceQueueItemId?: string;
}

interface ArtifactManifest {
  id: string;
  campaignId: string;
  title: string;
  kind: string;
  currentVersion: string | null;
  versions: string[];
  updatedAt: string;
}

function readFileIfExists(filePath: string | null | undefined): string {
  if (!filePath || !fs.existsSync(filePath)) {
    return "";
  }

  return fs.readFileSync(filePath, "utf8");
}

function getArtifactRecord(db: DatabaseSync, artifactId: string): ArtifactRecord | null {
  const artifact = db
    .prepare(
      `SELECT
        a.id,
        a.campaign_id AS campaignId,
        c.division_id AS divisionId,
        a.display_number AS displayNumber,
        a.title,
        a.kind,
        a.status,
        a.current_version AS currentVersion,
        a.owner_worker_id AS ownerWorkerId,
        w.name AS ownerWorkerName,
        a.review_summary AS reviewSummary,
        a.updated_at AS updatedAt
      FROM artifacts a
      JOIN campaigns c ON c.id = a.campaign_id
      LEFT JOIN workers w ON w.id = a.owner_worker_id
      WHERE a.id = ?`
    )
    .get(artifactId) as unknown as ArtifactRecord | undefined;

  return artifact ?? null;
}

function getArtifactRoot(config: AppConfig, artifact: ArtifactRecord): string {
  return path.join(
    config.dataDir,
    "divisions",
    artifact.divisionId,
    "campaigns",
    artifact.campaignId,
    "artifacts",
    artifact.id
  );
}

function getContentFileName(kind: string): string {
  return kind === "html" ? "content.html" : "content.md";
}

function listVersionRows(db: DatabaseSync, artifactId: string): ArtifactVersionSummary[] {
  return db
    .prepare(
      `SELECT
        artifact_id AS artifactId,
        version,
        created_by AS createdBy,
        source_queue_item_id AS sourceQueueItemId,
        content_path AS contentPath,
        review_path AS reviewPath,
        created_at AS createdAt
      FROM artifact_versions
      WHERE artifact_id = ?
      ORDER BY version ASC`
    )
    .all(artifactId) as unknown as ArtifactVersionSummary[];
}

function listArtifactRelations(db: DatabaseSync, artifactId: string): ArtifactRelationProjection[] {
  const rows = db
    .prepare(
      `SELECT
        other.id,
        other.title,
        other.type,
        e.relation,
        'from' AS direction,
        other.status
      FROM graph_edges e
      JOIN graph_nodes other ON other.id = e.to_node_id
      WHERE e.from_node_id = ?
      UNION ALL
      SELECT
        other.id,
        other.title,
        other.type,
        e.relation,
        'to' AS direction,
        other.status
      FROM graph_edges e
      JOIN graph_nodes other ON other.id = e.from_node_id
      WHERE e.to_node_id = ?
      ORDER BY relation ASC, title ASC`
    )
    .all(artifactId, artifactId) as unknown as ArtifactRelationProjection[];

  return rows;
}

function getNextVersion(db: DatabaseSync, artifactId: string): string {
  const row = db
    .prepare("SELECT COUNT(*) + 1 AS nextVersion FROM artifact_versions WHERE artifact_id = ?")
    .get(artifactId) as unknown as { nextVersion: number };

  return `v${String(row.nextVersion).padStart(3, "0")}`;
}

function writeManifest(db: DatabaseSync, config: AppConfig, artifact: ArtifactRecord): void {
  const versions = listVersionRows(db, artifact.id).map((version) => version.version);
  const manifest: ArtifactManifest = {
    id: artifact.id,
    campaignId: artifact.campaignId,
    title: artifact.title,
    kind: artifact.kind,
    currentVersion: artifact.currentVersion,
    versions,
    updatedAt: new Date().toISOString()
  };
  const artifactRoot = getArtifactRoot(config, artifact);

  ensureDir(artifactRoot);
  fs.writeFileSync(path.join(artifactRoot, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  fs.writeFileSync(
    path.join(artifactRoot, "README.md"),
    [
      `# ${artifact.title}`,
      "",
      `- ID: ${artifact.id}`,
      `- Kind: ${artifact.kind}`,
      `- Current version: ${artifact.currentVersion ?? "none"}`,
      ""
    ].join("\n"),
    "utf8"
  );
}

export function ensureArtifactManifest(db: DatabaseSync, config: AppConfig, artifactId: string): void {
  const artifact = getArtifactRecord(db, artifactId);
  if (!artifact) {
    throw new Error("산출물을 찾을 수 없습니다.");
  }

  writeManifest(db, config, artifact);
}

export function createArtifactVersion(
  db: DatabaseSync,
  config: AppConfig,
  input: CreateArtifactVersionInput
): ArtifactVersionSummary {
  const artifact = getArtifactRecord(db, input.artifactId);
  if (!artifact) {
    throw new Error("산출물을 찾을 수 없습니다.");
  }

  const version = getNextVersion(db, artifact.id);
  const versionRoot = path.join(getArtifactRoot(config, artifact), "versions", version);
  const contentPath = path.join(versionRoot, getContentFileName(artifact.kind));
  const reviewPath = path.join(versionRoot, "review.md");

  ensureDir(versionRoot);
  fs.writeFileSync(contentPath, input.content, "utf8");
  fs.writeFileSync(reviewPath, input.review ?? "PM 리뷰는 아직 작성되지 않았습니다.\n", "utf8");

  db.prepare(
    `INSERT INTO artifact_versions (
      artifact_id,
      version,
      created_by,
      source_queue_item_id,
      content_path,
      review_path
    )
    VALUES (?, ?, ?, ?, ?, ?)`
  ).run(artifact.id, version, input.createdBy, input.sourceQueueItemId ?? null, contentPath, reviewPath);

  db.prepare(
    `UPDATE artifacts
     SET current_version = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(version, artifact.id);

  const updatedArtifact = getArtifactRecord(db, artifact.id);
  if (updatedArtifact) {
    writeManifest(db, config, updatedArtifact);
  }

  const created = listVersionRows(db, artifact.id).find((item) => item.version === version);
  if (!created) {
    throw new Error("산출물 버전을 생성했지만 다시 조회하지 못했습니다.");
  }

  return created;
}

export function ensureInitialArtifactVersion(db: DatabaseSync, config: AppConfig, artifactId: string, reason: string): void {
  const existing = listVersionRows(db, artifactId);
  if (existing.length > 0) {
    return;
  }

  const artifact = getArtifactRecord(db, artifactId);
  if (!artifact) {
    throw new Error("산출물을 찾을 수 없습니다.");
  }

  const content = [
    `# ${artifact.title}`,
    "",
    "## 산출물 요청",
    "",
    reason || "PM 대화에서 생성된 산출물 요청입니다.",
    "",
    "## 다음 단계",
    "",
    "- 담당 직원이 배정되면 이 문서를 실제 산출물로 확장합니다.",
    "- PM 리뷰를 거쳐 승인 또는 수정 필요 상태로 전환합니다.",
    ""
  ].join("\n");

  createArtifactVersion(db, config, {
    artifactId,
    createdBy: "PM",
    content,
    review: "초기 산출물 요청 버전입니다.\n"
  });
}

export function writeCurrentArtifactReview(
  db: DatabaseSync,
  config: AppConfig,
  artifactId: string,
  review: string,
  reviewSummary: string,
  status: string
): void {
  const detail = getArtifactDetail(db, config, artifactId);
  const reviewPath = detail.currentVersion?.reviewPath;

  if (!reviewPath) {
    throw new Error("리뷰를 저장할 산출물 버전이 없습니다.");
  }

  ensureDir(path.dirname(reviewPath));
  fs.writeFileSync(reviewPath, review, "utf8");

  db.prepare(
    `UPDATE artifacts
     SET status = ?, review_summary = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(status, reviewSummary, artifactId);

  db.prepare(
    `UPDATE graph_nodes
     SET status = ?, summary = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND type = 'artifact'`
  ).run(status, reviewSummary, artifactId);

  ensureArtifactManifest(db, config, artifactId);
}

export function listArtifacts(db: DatabaseSync, campaignId?: string): ArtifactProjection[] {
  const where = campaignId ? "WHERE a.campaign_id = ?" : "";
  const statement = db.prepare(
    `SELECT
      a.id,
      a.display_number AS displayNumber,
      a.title,
      a.kind,
      a.status,
      a.current_version AS currentVersion,
      a.owner_worker_id AS ownerWorkerId,
      w.name AS ownerWorkerName,
      a.review_summary AS reviewSummary,
      a.updated_at AS updatedAt
    FROM artifacts a
    LEFT JOIN workers w ON w.id = a.owner_worker_id
    ${where}
    ORDER BY a.updated_at DESC, a.display_number ASC`
  );

  return (campaignId ? statement.all(campaignId) : statement.all()) as unknown as ArtifactProjection[];
}

export function getArtifactDetail(db: DatabaseSync, config: AppConfig, artifactId: string): ArtifactDetailResponse {
  const artifact = getArtifactRecord(db, artifactId);
  if (!artifact) {
    throw new Error("산출물을 찾을 수 없습니다.");
  }

  const versions = listVersionRows(db, artifactId);
  const currentVersion = versions.find((version) => version.version === artifact.currentVersion) ?? versions.at(-1) ?? null;

  return {
    artifact,
    versions,
    currentVersion,
    content: readFileIfExists(currentVersion?.contentPath),
    review: readFileIfExists(currentVersion?.reviewPath),
    viewUrl: `/artifacts/${artifact.id}/view`,
    revisionRequests: listArtifactRevisionRequests(db, artifact.id),
    relations: listArtifactRelations(db, artifact.id)
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function renderArtifactViewerHtml(detail: ArtifactDetailResponse): string {
  const isHtml = detail.artifact.kind === "html";
  const body = isHtml
    ? `<iframe class="html-frame" sandbox srcdoc="${escapeHtml(detail.content)}"></iframe>`
    : `<article class="document">${marked.parse(detail.content)}</article>`;
  const review = marked.parse(detail.review || "PM 리뷰가 아직 없습니다.");

  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(detail.artifact.title)}</title>
    <style>
      :root { color: #1F2328; background: #F7F8FA; font-family: system-ui, "Apple SD Gothic Neo", "Segoe UI", sans-serif; letter-spacing: 0; }
      body { margin: 0; }
      header { position: sticky; top: 0; display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 56px; padding: 0 24px; border-bottom: 1px solid #DADDE3; background: #FFFFFF; }
      h1 { margin: 0; font-size: 18px; }
      .version { color: #667085; font-size: 13px; }
      main { display: grid; grid-template-columns: minmax(0, 860px) minmax(280px, 360px); gap: 24px; max-width: 1280px; margin: 0 auto; padding: 24px; }
      .document, aside { border: 1px solid #DADDE3; border-radius: 8px; background: #FFFFFF; }
      .document { padding: 28px; line-height: 1.7; overflow-x: auto; }
      .document h1, .document h2, .document h3 { line-height: 1.3; }
      .document table { border-collapse: collapse; width: 100%; }
      .document th, .document td { border: 1px solid #DADDE3; padding: 8px 10px; text-align: left; }
      aside { align-self: start; padding: 18px; }
      aside h2 { margin: 0 0 12px; font-size: 16px; }
      aside .review { color: #1F2328; line-height: 1.6; }
      .html-frame { width: 100%; min-height: calc(100vh - 128px); border: 1px solid #DADDE3; border-radius: 8px; background: #FFFFFF; }
      @media (max-width: 900px) { main { grid-template-columns: 1fr; padding: 16px; } }
    </style>
  </head>
  <body>
    <header>
      <h1>${escapeHtml(String(detail.artifact.displayNumber).padStart(3, "0"))} ${escapeHtml(detail.artifact.title)}</h1>
      <span class="version">${escapeHtml(detail.currentVersion?.version ?? "no version")}</span>
    </header>
    <main>
      ${body}
      <aside>
        <h2>PM 리뷰</h2>
        <div class="review">${review}</div>
      </aside>
    </main>
  </body>
</html>`;
}
