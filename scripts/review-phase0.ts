import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../src/server/config.js";
import { ensureDataRoot } from "../src/server/storage/file-store.js";
import { getDatabaseSummary, initializeDatabase } from "../src/server/storage/db.js";

interface ReviewItem {
  ticket: string;
  label: string;
  passed: boolean;
  evidence: string;
}

function exists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

function readText(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

const config = loadConfig();
const folders = ensureDataRoot(config);
const database = initializeDatabase(config);
const summary = getDatabaseSummary(database.db);
const root = config.rootDir;

const reviewItems: ReviewItem[] = [
  {
    ticket: "V2-0-01",
    label: "프로젝트 스캐폴드 생성",
    passed:
      exists(path.join(root, "package.json")) &&
      exists(path.join(root, "src", "client", "main.tsx")) &&
      exists(path.join(root, "src", "server", "index.ts")) &&
      exists(path.join(root, "README.md")),
    evidence: "package.json, src/client, src/server, README.md"
  },
  {
    ticket: "V2-0-02",
    label: "TypeScript/Node 환경 구성",
    passed:
      exists(path.join(root, "tsconfig.json")) &&
      exists(path.join(root, "tsconfig.server.json")) &&
      readText(path.join(root, "package.json")).includes("\"build\""),
    evidence: "tsconfig.json, tsconfig.server.json, npm build script"
  },
  {
    ticket: "V2-0-03",
    label: "SQLite 연결",
    passed: exists(config.dbPath) && summary.migrations.includes("001_initial_schema"),
    evidence: `${config.dbPath}, migrations=${summary.migrations.join(", ")}`
  },
  {
    ticket: "V2-0-04",
    label: "기본 폴더 생성기",
    passed: folders.every((folder) => folder.exists),
    evidence: folders.map((folder) => folder.path).join("; ")
  },
  {
    ticket: "V2-0-05",
    label: "문서 색인 정리",
    passed:
      readText(path.join(root, "docs", "00-index.md")).includes("12-phase-ticket-implementation-plan.md") &&
      readText(path.join(root, "docs", "04-folder-structure.md")).includes("12-phase-ticket-implementation-plan.md"),
    evidence: "00-index.md and 04-folder-structure.md reference the implementation plan"
  }
];

database.db.close();

for (const item of reviewItems) {
  const marker = item.passed ? "PASS" : "FAIL";
  console.log(`[${marker}] ${item.ticket} ${item.label}`);
  console.log(`       ${item.evidence}`);
}

const failed = reviewItems.filter((item) => !item.passed);

if (failed.length > 0) {
  console.error(`Phase 0 review failed: ${failed.length} item(s) need attention.`);
  process.exitCode = 1;
} else {
  console.log("Phase 0 review passed.");
}
