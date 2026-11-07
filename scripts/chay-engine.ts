import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { IngestionReport, LanguageAdapter, LanguageId } from "@/contracts";
import { parseAll } from "../src/server/engine/graph/parser";
import { LANGUAGE_REGISTRY } from "../src/server/engine/graph/registry";
import { collectSymbols, resolveImports } from "../src/server/engine/graph/symbols";
import { buildCallGraph, findEntries } from "../src/server/engine/graph/callgraph";

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
  const manifests = new Map<string, string>();

  for (const absFilePath of filePaths) {
    const relPosixPath = path
      .relative(resolvedBaseDir, absFilePath)
      .split(path.sep)
      .join("/");

    const baseName = path.basename(absFilePath);
    if (
      baseName === "tsconfig.json" ||
      baseName === "jsconfig.json" ||
      baseName === "package.json"
    ) {
      const content = await fs.readFile(absFilePath, "utf8");
      manifests.set(relPosixPath, content);
    }

    const adapter = getLanguageForFile(absFilePath);
    if (!adapter) {
      continue;
    }

    const content = await fs.readFile(absFilePath, "utf8");
    code.set(relPosixPath, content);
    langs.set(relPosixPath, adapter.id);
  }

  const report: IngestionReport = {
    truncated: false,
    selective_fetch: false,
    code_file_count: code.size,
    manifest_count: manifests.size,
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

  const idx = collectSymbols(parsedFiles);
  resolveImports(parsedFiles, idx, manifests, {
    go_module_path: null,
    dart_package_name: null,
    package_entry_files: [],
  });

  let a = 0;
  let b = 0;
  for (const fileImports of idx.imports.values()) {
    for (const imp of fileImports.values()) {
      if (
        imp.source.startsWith("./") ||
        imp.source.startsWith("../") ||
        imp.source.startsWith("@/") ||
        imp.source.startsWith("~/")
      ) {
        b++;
        if (imp.resolved_file !== null) {
          a++;
        }
      }
    }
  }

  const percentage = b === 0 ? 0 : Math.round((a / b) * 100);

  console.log(`Số định nghĩa: ${idx.symbols.size}`);
  console.log(`Số hàm: ${idx.functions.size}`);
  console.log(`Import nội bộ nối được: ${a}/${b} (${percentage}%)`);

  const graph = buildCallGraph(parsedFiles, idx);
  const entries = findEntries(parsedFiles, idx, graph, "");

  const resolvedEdges = graph.edges.filter((e) => e.confidence === "RESOLVED");
  console.log(`Số cạnh hàm: ${graph.edges.length}`);
  console.log(`Số cạnh RESOLVED: ${resolvedEdges.length}`);

  const sourceCounts = new Map<string, number>();
  for (const entry of entries) {
    sourceCounts.set(entry.source, (sourceCounts.get(entry.source) ?? 0) + 1);
  }
  const sourceStr = Array.from(sourceCounts.entries())
    .map(([src, count]) => `${src}: ${count}`)
    .join(", ");
  console.log(`Số entry theo source: ${sourceStr || "0"}`);

  console.log("10 route đầu:");
  for (const b of graph.bindings.slice(0, 10)) {
    console.log(`${b.method ?? "ANY"} ${b.path ?? ""} -> ${b.handler}`);
  }
}

main().catch((err) => {
  console.error("Lỗi khi chạy engine:", err);
  process.exitCode = 1;
});
