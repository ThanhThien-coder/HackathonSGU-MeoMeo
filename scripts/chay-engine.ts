import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { IngestionReport, LanguageAdapter, LanguageId } from "@/contracts";
import { parseAll } from "../src/server/engine/graph/parser";
import { LANGUAGE_REGISTRY } from "../src/server/engine/graph/registry";

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "target",
]);

function getLanguageForFile(filePath: string): LanguageAdapter | undefined {
  const ext = path.extname(filePath).toLowerCase();
  return LANGUAGE_REGISTRY.find((adapter) =>
    adapter.extensions.some((e) => e.toLowerCase() === ext)
  );
}

async function collectFiles(baseDir: string, currentDir: string = baseDir): Promise<string[]> {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        const subFiles = await collectFiles(baseDir, path.join(currentDir, entry.name));
        files.push(...subFiles);
      }
    } else if (entry.isFile()) {
      files.push(path.join(currentDir, entry.name));
    }
  }

  return files;
}

async function main(): Promise<void> {
  const targetDir = process.argv[2];
  if (!targetDir) {
    console.log("Cách dùng: npx tsx scripts/chay-engine.ts <thư-mục>");
    process.exitCode = 1;
    return;
  }

  const resolvedBaseDir = path.resolve(targetDir);
  const filePaths = await collectFiles(resolvedBaseDir);

  const code = new Map<string, string>();
  const langs = new Map<string, LanguageId>();

  for (const absFilePath of filePaths) {
    const adapter = getLanguageForFile(absFilePath);
    if (!adapter) {
      continue;
    }

    const relPosixPath = path
      .relative(resolvedBaseDir, absFilePath)
      .split(path.sep)
      .join("/");

    const content = await fs.readFile(absFilePath, "utf8");
    code.set(relPosixPath, content);
    langs.set(relPosixPath, adapter.id);
  }

  const report: IngestionReport = {
    truncated: false,
    selective_fetch: false,
    code_file_count: code.size,
    manifest_count: 0,
    omitted_node_count: 0,
    skipped: {
      garbage: 0,
      binary: 0,
      oversized: 0,
      unsupported_lang: 0,
      quota: 0,
      parse_error: 0,
    },
    warnings: [],
    degraded_mode: null,
    redacted_secret_count: 0,
    engine_ms: 0,
    ingest_ms: 0,
    suspicious_instruction_files: [],
  };

  const parsedFiles = await parseAll(code, langs, report);

  console.log(`Số file đọc: ${code.size}`);
  console.log(`Số file parse được: ${parsedFiles.length}`);
  console.log(`Số file bỏ: ${report.skipped.parse_error}`);

  if (report.warnings.length > 0) {
    console.log("Các warning:");
    for (const warning of report.warnings) {
      console.log(`- ${warning}`);
    }
  }

  console.log("buildGraph: chưa có (MI-06)");
}

main().catch((err) => {
  console.error("Lỗi khi chạy engine:", err);
  process.exitCode = 1;
});
