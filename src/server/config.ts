import path from "node:path";
import { config as loadEnvFile } from "dotenv";

loadEnvFile({ quiet: true });

export interface AppConfig {
  rootDir: string;
  port: number;
  dataDir: string;
  dbPath: string;
  nodeEnv: string;
  codexRunner?: string;
  codexCliBin?: string;
  codexPmModel?: string;
  codexWorkerModel?: string;
  codexScribeModel?: string;
  codexTimeoutMs?: number;
  codexExecArgs?: string[];
}

function readPort(value: string | undefined): number {
  if (!value) {
    return 8788;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 8788;
}

function readNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readArgs(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return (
    value
      .match(/(?:[^\s"]+|"[^"]*")+/g)
      ?.map((item) => item.replace(/^"|"$/g, ""))
      .filter(Boolean) ?? []
  );
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const rootDir = process.cwd();
  const dataDir = path.resolve(env.DATA_DIR ?? path.join(rootDir, "data"));

  return {
    rootDir,
    port: readPort(env.PORT),
    dataDir,
    dbPath: path.join(dataDir, "local-company.sqlite"),
    nodeEnv: env.NODE_ENV ?? "development",
    codexRunner: env.CODEX_RUNNER ?? "mock",
    codexCliBin: env.CODEX_CLI_BIN ?? "codex",
    codexPmModel: env.CODEX_PM_MODEL ?? "gpt-5.5",
    codexWorkerModel: env.CODEX_WORKER_MODEL ?? "gpt-5.5",
    codexScribeModel: env.CODEX_SCRIBE_MODEL ?? "gpt-5.5",
    codexTimeoutMs: readNumber(env.CODEX_TIMEOUT_MS, 600000),
    codexExecArgs: readArgs(env.CODEX_EXEC_ARGS)
  };
}
