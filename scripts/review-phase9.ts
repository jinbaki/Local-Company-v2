import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AppConfig } from "../src/server/config.js";
import { initializeDatabase } from "../src/server/storage/db.js";
import { listCampaigns } from "../src/server/services/campaign-service.js";
import { getCampaignProjection } from "../src/server/services/graph-service.js";
import { generateCampaignHandoffReport } from "../src/server/services/report-service.js";

interface ReviewItem {
  ticket: string;
  label: string;
  passed: boolean;
  evidence: string;
}

const root = process.cwd();

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function exists(relativePath: string): boolean {
  return fs.existsSync(path.join(root, relativePath));
}

function createReviewDataDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "local-company-v2-phase9-sample-"));
}

async function runSeedDemo(dataDir: string): Promise<{ stdout: string; code: number }> {
  const { spawn } = await import("node:child_process");

  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ["./node_modules/tsx/dist/cli.mjs", "scripts/seed-demo.ts", "--data-dir", dataDir],
      {
        cwd: root,
        stdio: ["ignore", "pipe", "pipe"],
        shell: false
      }
    );
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("close", (code) => {
      resolve({ stdout: `${stdout}${stderr}`, code: code ?? 1 });
    });
  });
}

async function runPublicCheck(): Promise<{ stdout: string; code: number }> {
  const { spawn } = await import("node:child_process");

  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["./node_modules/tsx/dist/cli.mjs", "scripts/check-public-ready.ts"], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("close", (code) => {
      resolve({ stdout: `${stdout}${stderr}`, code: code ?? 1 });
    });
  });
}

function createConfig(dataDir: string): AppConfig {
  return {
    rootDir: root,
    port: 8788,
    dataDir,
    dbPath: path.join(dataDir, "local-company.sqlite"),
    nodeEnv: "review"
  };
}

async function main(): Promise<void> {
  const envExample = read(".env.example");
  const packageJson = read("package.json");
  const installGuide = read("docs/install.md");
  const userGuide = read("docs/user-guide.md");
  const codexGuide = read("docs/codex-connection.md");
  const agentRunner = read("src/server/services/agent-runner.ts");
  const pmActionService = read("src/server/services/pm-action-service.ts");
  const queueService = read("src/server/services/queue-service.ts");
  const gitignore = read(".gitignore");
  const reviewDataDir = createReviewDataDir();
  const seedResult = await runSeedDemo(reviewDataDir);
  const publicCheck = await runPublicCheck();
  const config = createConfig(reviewDataDir);
  const context = initializeDatabase(config);
  const campaign = listCampaigns(context.db).find((item) => item.title === "데모: 콘텐츠 제작 캠페인");
  const projection = campaign ? getCampaignProjection(context.db, campaign.id) : null;
  const report = campaign ? generateCampaignHandoffReport(context.db, config, campaign.id) : null;
  context.db.close();

  const reviewItems: ReviewItem[] = [
    {
      ticket: "V2-9-01",
      label: ".env.example 작성",
      passed:
        envExample.includes("PORT=8788") &&
        envExample.includes("DATA_DIR=./data") &&
        envExample.includes("CODEX_RUNNER=mock") &&
        envExample.includes("CODEX_PM_MODEL=") &&
        envExample.includes("CODEX_TIMEOUT_MS=") &&
        envExample.includes("CODEX_EXEC_ARGS=") &&
        !/[A-Za-z]:\\/.test(envExample),
      evidence: ".env.example has portable port, data, runner, model, timeout, and exec arg examples"
    },
    {
      ticket: "V2-9-02",
      label: "설치 매뉴얼",
      passed:
        installGuide.includes("npm install") &&
        installGuide.includes("npm run dev") &&
        installGuide.includes("npm run build") &&
        installGuide.includes("DATA_DIR") &&
        installGuide.includes("codex-connection.md"),
      evidence: "docs/install.md covers install, run, build, demo data, and Codex guide link"
    },
    {
      ticket: "V2-9-03",
      label: "사용 매뉴얼",
      passed:
        userGuide.includes("첫 캠페인") &&
        userGuide.includes("PM과 대화") &&
        userGuide.includes("산출물") &&
        userGuide.includes("결정함") &&
        userGuide.includes("인계 보고서"),
      evidence: "docs/user-guide.md covers first campaign flow"
    },
    {
      ticket: "V2-9-02",
      label: "Codex 연결 안내",
      passed:
        codexGuide.includes("npm install -g @openai/codex") &&
        codexGuide.includes("codex --version") &&
        codexGuide.includes("CODEX_RUNNER=codex-cli") &&
        codexGuide.includes("codex exec") &&
        agentRunner.includes("runCodexCli") &&
        pmActionService.includes("scribe_actions") &&
        queueService.includes("reviewArtifactWithPm"),
      evidence: "docs/codex-connection.md and server services cover the real codex-cli runner mode"
    },
    {
      ticket: "V2-9-04",
      label: "샘플 데이터",
      passed:
        seedResult.code === 0 &&
        Boolean(campaign) &&
        Boolean(projection && projection.artifacts.length >= 1 && projection.decisions.length >= 1) &&
        Boolean(report && report.files.every((file) => fs.existsSync(file.path))),
      evidence: `seedCode=${seedResult.code}, campaigns=${campaign ? 1 : 0}, artifacts=${projection?.artifacts.length ?? 0}, decisions=${projection?.decisions.length ?? 0}`
    },
    {
      ticket: "V2-9-05",
      label: "GitHub 공개 준비",
      passed:
        publicCheck.code === 0 &&
        exists("LICENSE") &&
        packageJson.includes("\"check:public\"") &&
        gitignore.includes(".env") &&
        gitignore.includes("data/") &&
        gitignore.includes("data-sample/*") &&
        gitignore.includes("*.sqlite"),
      evidence: publicCheck.code === 0 ? "public readiness check passed" : publicCheck.stdout
    }
  ];

  for (const item of reviewItems) {
    const marker = item.passed ? "PASS" : "FAIL";
    console.log(`[${marker}] ${item.ticket} ${item.label}`);
    console.log(`       ${item.evidence}`);
  }

  const failed = reviewItems.filter((item) => !item.passed);

  if (failed.length > 0) {
    console.error(`Phase 9 review failed: ${failed.length} item(s) need attention.`);
    process.exitCode = 1;
  } else {
    console.log("Phase 9 review passed.");
  }
}

void main();
