import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { AppConfig } from "../config.js";
import type {
  CampaignReferenceKind,
  CampaignReferenceSummary,
  CreateCampaignReferenceRequest,
  CreateCampaignReferenceResponse
} from "../../shared/types/app-state.js";
import { ensureCampaignFolders, ensureDir } from "../storage/file-store.js";
import { getCampaign } from "./campaign-service.js";
import { createId } from "./ids.js";

interface CampaignReferenceRow {
  id: string;
  campaignId: string;
  title: string;
  kind: CampaignReferenceKind;
  source: string;
  content: string;
  filePath: string;
  createdAt: string;
  updatedAt: string;
}

const referenceKinds = new Set<CampaignReferenceKind>(["note", "url", "file"]);
const maxUploadBytes = 5 * 1024 * 1024;
const textFileExtensions = new Set([".csv", ".json", ".md", ".txt", ".tsv", ".html", ".css", ".js", ".ts", ".tsx", ".jsx"]);

function normalizeReference(row: CampaignReferenceRow): CampaignReferenceSummary {
  return {
    id: row.id,
    campaignId: row.campaignId,
    title: row.title,
    kind: row.kind,
    source: row.source,
    content: row.content,
    filePath: row.filePath,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function normalizeKind(value: string | undefined): CampaignReferenceKind {
  const kind = value as CampaignReferenceKind | undefined;
  return kind && referenceKinds.has(kind) ? kind : "note";
}

function getReferenceFolder(config: AppConfig, divisionId: string, campaignId: string): string {
  return path.join(config.dataDir, "divisions", divisionId, "campaigns", campaignId, "knowledge", "references");
}

function getSourceMaterialFolder(config: AppConfig, divisionId: string, campaignId: string): string {
  return path.join(config.dataDir, "divisions", divisionId, "campaigns", campaignId, "knowledge", "source-materials");
}

function sanitizeFileName(fileName: string): string {
  const baseName = path.basename(fileName).trim() || "uploaded-file";
  return baseName.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 120);
}

function shouldExtractText(fileName: string, mimeType: string): boolean {
  return mimeType.startsWith("text/") || textFileExtensions.has(path.extname(fileName).toLowerCase());
}

function renderReferenceFile(input: {
  title: string;
  kind: CampaignReferenceKind;
  source: string;
  content: string;
}): string {
  return [
    `# ${input.title}`,
    "",
    `- 유형: ${referenceKindLabel(input.kind)}`,
    input.source ? `- 원본: ${input.source}` : "- 원본: 직접 입력",
    "",
    "## 내용",
    "",
    input.content || "내용이 아직 입력되지 않았습니다.",
    ""
  ].join("\n");
}

function referenceKindLabel(kind: CampaignReferenceKind): string {
  if (kind === "url") {
    return "URL";
  }

  if (kind === "file") {
    return "파일";
  }

  return "메모";
}

function validateReferenceInput(input: CreateCampaignReferenceRequest): {
  title: string;
  kind: CampaignReferenceKind;
  source: string;
  content: string;
  uploadedFileName: string;
  uploadedMimeType: string;
  uploadedFileBase64: string;
} {
  const title = input.title.trim();
  const kind = normalizeKind(input.kind);
  const source = (input.source ?? "").trim();
  const content = (input.content ?? "").trim();
  const uploadedFileName = (input.fileName ?? "").trim();
  const uploadedMimeType = (input.fileMimeType ?? "").trim();
  const uploadedFileBase64 = (input.fileBase64 ?? "").trim();
  const hasUploadedFile = Boolean(uploadedFileName && uploadedFileBase64);

  if (!title) {
    throw new Error("참고자료 제목을 입력하세요.");
  }

  if (kind === "note" && !content) {
    throw new Error("참고자료 내용을 입력하세요.");
  }

  if (kind === "url" && !source) {
    throw new Error("참고자료의 주소를 입력하세요.");
  }

  if (kind === "file" && !source && !hasUploadedFile) {
    throw new Error("업로드할 파일을 선택하거나 파일 경로를 입력하세요.");
  }

  if (kind === "url") {
    try {
      const parsed = new URL(source);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        throw new Error("invalid protocol");
      }
    } catch {
      throw new Error("URL 참고자료는 http 또는 https 주소로 입력하세요.");
    }
  }

  return { title, kind, source, content, uploadedFileName, uploadedMimeType, uploadedFileBase64 };
}

export function listCampaignReferences(db: DatabaseSync, campaignId: string): CampaignReferenceSummary[] {
  const rows = db
    .prepare(
      `SELECT
        id,
        campaign_id AS campaignId,
        title,
        kind,
        source,
        content,
        file_path AS filePath,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM campaign_references
      WHERE campaign_id = ?
      ORDER BY created_at DESC, rowid DESC`
    )
    .all(campaignId) as unknown as CampaignReferenceRow[];

  return rows.map(normalizeReference);
}

export function createCampaignReference(
  db: DatabaseSync,
  config: AppConfig,
  campaignId: string,
  input: CreateCampaignReferenceRequest
): CreateCampaignReferenceResponse {
  const campaign = getCampaign(db, campaignId);
  if (!campaign) {
    throw new Error("캠페인을 찾을 수 없습니다.");
  }

  const reference = validateReferenceInput(input);
  ensureCampaignFolders(config, campaign.divisionId, campaign.id);

  const referenceId = createId("reference");
  let source = reference.source;
  let content = reference.content;

  if (reference.kind === "file" && reference.uploadedFileName && reference.uploadedFileBase64) {
    const uploaded = Buffer.from(reference.uploadedFileBase64, "base64");
    if (uploaded.length === 0) {
      throw new Error("업로드한 파일이 비어 있습니다.");
    }

    if (uploaded.length > maxUploadBytes) {
      throw new Error("참고자료 파일은 5MB 이하만 업로드할 수 있습니다.");
    }

    const sourceMaterialFolder = getSourceMaterialFolder(config, campaign.divisionId, campaign.id);
    ensureDir(sourceMaterialFolder);
    const safeFileName = sanitizeFileName(reference.uploadedFileName);
    const uploadedPath = path.join(sourceMaterialFolder, `${referenceId}-${safeFileName}`);
    fs.writeFileSync(uploadedPath, uploaded);
    source = uploadedPath;

    if (!content && shouldExtractText(safeFileName, reference.uploadedMimeType)) {
      content = uploaded.toString("utf8").slice(0, 4000);
    }
  }

  const referenceFolder = getReferenceFolder(config, campaign.divisionId, campaign.id);
  ensureDir(referenceFolder);
  const filePath = path.join(referenceFolder, `${referenceId}.md`);
  fs.writeFileSync(filePath, renderReferenceFile({ title: reference.title, kind: reference.kind, source, content }), "utf8");

  db.prepare(
    `INSERT INTO campaign_references (id, campaign_id, title, kind, source, content, file_path)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(referenceId, campaignId, reference.title, reference.kind, source, content, filePath);

  db.prepare(
    `INSERT INTO events (id, type, campaign_id, payload)
     VALUES (?, 'campaign_reference_created', ?, ?)`
  ).run(createId("event"), campaignId, JSON.stringify({ referenceId, title: reference.title, kind: reference.kind }));

  const created = listCampaignReferences(db, campaignId).find((item) => item.id === referenceId);
  if (!created) {
    throw new Error("참고자료를 저장하지 못했습니다.");
  }

  return {
    reference: created,
    message: "PM 참고자료를 추가했습니다."
  };
}

function compactText(value: string, maxLength: number): string {
  const compacted = value.replace(/\s+/g, " ").trim();
  return compacted.length <= maxLength ? compacted : `${compacted.slice(0, maxLength)}...`;
}

export function renderReferenceContext(db: DatabaseSync, campaignId: string): string {
  const references = listCampaignReferences(db, campaignId).slice(0, 8);
  if (references.length === 0) {
    return "없음";
  }

  return references
    .map((reference, index) => {
      const lines = [
        `${index + 1}. ${reference.title}`,
        `   - 유형: ${referenceKindLabel(reference.kind)}`,
        reference.source ? `   - 원본: ${reference.source}` : "",
        reference.content ? `   - 내용: ${compactText(reference.content, 900)}` : "",
        `   - 저장 파일: ${reference.filePath}`
      ].filter(Boolean);

      return lines.join("\n");
    })
    .join("\n\n");
}
