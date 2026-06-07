import fs from "node:fs";
import path from "node:path";

interface CheckItem {
  label: string;
  passed: boolean;
  evidence: string;
}

const root = process.cwd();
const secretPatterns = [
  /sk-[A-Za-z0-9_-]{20,}/,
  /OPENAI_API_KEY\s*=\s*[^#\s][^\r\n]+/,
  /ANTHROPIC_API_KEY\s*=\s*[^#\s][^\r\n]+/,
  /GITHUB_TOKEN\s*=\s*[^#\s][^\r\n]+/,
  /[A-Za-z]:\\Users\\[^\\\s"'`]+/i,
  /[A-Za-z]:\\[^\\\r\n"'`]*\\local-company-v2/i
];

const scanTargets = [
  ".env.example",
  ".gitignore",
  "README.md",
  "LICENSE",
  "package.json",
  "docs",
  "scripts",
  "src",
  "tests"
];

function exists(relativePath: string): boolean {
  return fs.existsSync(path.join(root, relativePath));
}

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function listTextFiles(target: string): string[] {
  const absolute = path.join(root, target);
  if (!fs.existsSync(absolute)) {
    return [];
  }

  const stat = fs.statSync(absolute);
  if (stat.isFile()) {
    return [absolute];
  }

  const files: string[] = [];
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    if (["node_modules", "dist", "data", ".git"].includes(entry.name)) {
      continue;
    }

    const child = path.join(absolute, entry.name);
    if (entry.isDirectory()) {
      files.push(...listTextFiles(path.relative(root, child)));
      continue;
    }

    if (/\.(ts|tsx|js|json|md|txt|css|html|example|gitignore)$/i.test(entry.name) || entry.name === "LICENSE") {
      files.push(child);
    }
  }

  return files;
}

function scanForSecrets(): string[] {
  const hits: string[] = [];
  const files = scanTargets.flatMap(listTextFiles);

  for (const file of files) {
    if (path.relative(root, file).split(path.sep).join("/") === "scripts/check-public-ready.ts") {
      continue;
    }

    const text = fs.readFileSync(file, "utf8");
    for (const pattern of secretPatterns) {
      if (pattern.test(text)) {
        hits.push(path.relative(root, file));
        break;
      }
    }
  }

  return Array.from(new Set(hits)).sort();
}

const gitignore = exists(".gitignore") ? read(".gitignore") : "";
const packageJson = exists("package.json") ? read("package.json") : "";
const envExample = exists(".env.example") ? read(".env.example") : "";
const secretHits = scanForSecrets();

const checks: CheckItem[] = [
  {
    label: "environment example",
    passed:
      exists(".env.example") &&
      envExample.includes("PORT=") &&
      envExample.includes("DATA_DIR=./data") &&
      envExample.includes("CODEX_RUNNER=mock") &&
      envExample.includes("CODEX_TIMEOUT_MS=") &&
      envExample.includes("CODEX_EXEC_ARGS=") &&
      !/[A-Za-z]:\\/.test(envExample),
    evidence: ".env.example has portable values and no absolute Windows path"
  },
  {
    label: "install guide",
    passed:
      exists("docs/install.md") &&
      read("docs/install.md").includes("npm install") &&
      read("docs/install.md").includes("npm run dev") &&
      read("docs/install.md").includes("codex-connection.md"),
    evidence: "docs/install.md links to Codex connection guide"
  },
  {
    label: "codex connection guide",
    passed:
      exists("docs/codex-connection.md") &&
      read("docs/codex-connection.md").includes("npm install -g @openai/codex") &&
      read("docs/codex-connection.md").includes("CODEX_RUNNER=codex-cli") &&
      read("docs/codex-connection.md").includes("codex exec"),
    evidence: "docs/codex-connection.md covers real codex-cli runner mode"
  },
  {
    label: "user guide",
    passed:
      exists("docs/user-guide.md") &&
      read("docs/user-guide.md").includes("캠페인") &&
      read("docs/user-guide.md").includes("산출물") &&
      read("docs/user-guide.md").includes("인계 보고서"),
    evidence: "docs/user-guide.md"
  },
  {
    label: "demo seed",
    passed:
      exists("scripts/seed-demo.ts") &&
      packageJson.includes("\"seed:demo\"") &&
      exists("data-sample/README.md"),
    evidence: "scripts/seed-demo.ts and data-sample/README.md"
  },
  {
    label: "public ignore list",
    passed:
      gitignore.includes(".env") &&
      gitignore.includes("data/") &&
      gitignore.includes("data-sample/*") &&
      gitignore.includes("!data-sample/README.md") &&
      gitignore.includes("node_modules/") &&
      gitignore.includes("dist/") &&
      gitignore.includes("*.sqlite"),
    evidence: ".gitignore excludes local secrets, generated data, dependencies, build outputs, and SQLite files"
  },
  {
    label: "license note",
    passed: exists("LICENSE") && read("LICENSE").includes("All rights reserved"),
    evidence: "LICENSE"
  },
  {
    label: "secret scan",
    passed: secretHits.length === 0,
    evidence: secretHits.length === 0 ? "no obvious API keys in public text files" : secretHits.join(", ")
  }
];

for (const item of checks) {
  const marker = item.passed ? "PASS" : "FAIL";
  console.log(`[${marker}] ${item.label}`);
  console.log(`       ${item.evidence}`);
}

const failed = checks.filter((item) => !item.passed);
if (failed.length > 0) {
  console.error(`Public readiness check failed: ${failed.length} item(s) need attention.`);
  process.exitCode = 1;
} else {
  console.log("Public readiness check passed.");
}
