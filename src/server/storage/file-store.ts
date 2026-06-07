import fs from "node:fs";
import path from "node:path";
import type { AppConfig } from "../config.js";

export interface FolderStatus {
  path: string;
  exists: boolean;
}

export function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function ensureDataRoot(config: AppConfig): FolderStatus[] {
  const folders = [
    config.dataDir,
    path.join(config.dataDir, "divisions"),
    path.join(config.dataDir, "system")
  ];

  for (const folder of folders) {
    ensureDir(folder);
  }

  return folders.map((folder) => ({
    path: folder,
    exists: fs.existsSync(folder)
  }));
}

export function ensureDivisionFolders(config: AppConfig, divisionId: string): FolderStatus[] {
  const divisionRoot = path.join(config.dataDir, "divisions", divisionId);
  const folders = [
    divisionRoot,
    path.join(divisionRoot, "documents"),
    path.join(divisionRoot, "campaigns")
  ];

  for (const folder of folders) {
    ensureDir(folder);
  }

  return folders.map((folder) => ({
    path: folder,
    exists: fs.existsSync(folder)
  }));
}

export function ensureCampaignFolders(
  config: AppConfig,
  divisionId: string,
  campaignId: string
): FolderStatus[] {
  const campaignRoot = path.join(config.dataDir, "divisions", divisionId, "campaigns", campaignId);
  const folders = [
    campaignRoot,
    path.join(campaignRoot, "knowledge"),
    path.join(campaignRoot, "knowledge", "references"),
    path.join(campaignRoot, "knowledge", "owner-notes"),
    path.join(campaignRoot, "knowledge", "source-materials"),
    path.join(campaignRoot, "conversations"),
    path.join(campaignRoot, "conversations", "pm"),
    path.join(campaignRoot, "conversations", "workers"),
    path.join(campaignRoot, "artifacts"),
    path.join(campaignRoot, "queue-runs"),
    path.join(campaignRoot, "reports")
  ];

  for (const folder of folders) {
    ensureDir(folder);
  }

  return folders.map((folder) => ({
    path: folder,
    exists: fs.existsSync(folder)
  }));
}

export function removeManagedDataDirectory(config: AppConfig, ...segments: string[]): string {
  const dataRoot = path.resolve(config.dataDir);
  const targetPath = path.resolve(config.dataDir, ...segments);
  const relativePath = path.relative(dataRoot, targetPath);

  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error("관리 데이터 폴더 밖의 경로는 삭제할 수 없습니다.");
  }

  fs.rmSync(targetPath, { recursive: true, force: true });
  return targetPath;
}
