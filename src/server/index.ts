import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createServer as createViteServer } from "vite";
import { loadConfig } from "./config.js";
import { ensureDataRoot } from "./storage/file-store.js";
import { getDatabaseSummary, initializeDatabase } from "./storage/db.js";
import { createApiRouter } from "./api/routes.js";
import { getArtifactDetail, renderArtifactViewerHtml } from "./services/artifact-service.js";
import { applyPersistedRunnerSettings, getRunnerSettings } from "./services/runner-settings-service.js";
import type { HealthResponse } from "../shared/types/health.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main(): Promise<void> {
  const config = loadConfig();
  const app = express();
  const databaseContext = initializeDatabase(config);
  applyPersistedRunnerSettings(databaseContext.db, config);

  app.use(express.json({ limit: "8mb" }));
  app.use("/api", createApiRouter(databaseContext));

  app.get("/artifacts/:artifactId/view", (request, response) => {
    try {
      const detail = getArtifactDetail(databaseContext.db, config, request.params.artifactId);
      response.type("html").send(renderArtifactViewerHtml(detail));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "산출물을 찾을 수 없습니다.";
      response.status(404).type("html").send(`<h1>${message}</h1>`);
    }
  });

  app.get("/api/health", (_request, response) => {
    const folders = ensureDataRoot(config);
    const database = getDatabaseSummary(databaseContext.db);
    const payload: HealthResponse = {
      status: "ok",
      app: "Local Company V2",
      phase: "Phase 9",
      generatedAt: new Date().toISOString(),
      port: config.port,
      dataDir: config.dataDir,
      database: {
        path: config.dbPath,
        ready: fs.existsSync(config.dbPath),
        tableCount: database.tableCount,
        migrations: database.migrations
      },
      runner: getRunnerSettings(config),
      folders
    };

    response.json(payload);
  });

  if (config.nodeEnv === "production") {
    const clientDir = path.resolve(__dirname, "../client");
    app.use(express.static(clientDir));
    app.get(/.*/, (_request, response) => {
      response.sendFile(path.join(clientDir, "index.html"));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  }

  app.listen(config.port, "127.0.0.1", () => {
    console.log(`Local Company V2 is running at http://127.0.0.1:${config.port}`);
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
