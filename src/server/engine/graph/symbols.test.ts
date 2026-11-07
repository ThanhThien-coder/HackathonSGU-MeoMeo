import { beforeAll, describe, expect, it } from "vitest";
import { CONFIG } from "@/contracts";
import type { IngestionReport, LanguageId } from "@/contracts";
import { parseJsonc, stripJsonc } from "../jsonc";
import { initParsers, parseAll } from "./parser";
import {
  followBarrelReExport,
  resolveTsJsImport,
} from "./resolvers/ts_js";
import {
  collectSymbols,
  resolveImports,
} from "./symbols";

function createMockReport(): IngestionReport {
  return {
    truncated: false,
    selective_fetch: false,
    code_file_count: 0,
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
}

async function parseVirtualFiles(
  files: Record<string, string>,
  lang: LanguageId = "TYPESCRIPT"
) {
  const code = new Map<string, string>();
  const langs = new Map<string, LanguageId>();
  for (const [p, content] of Object.entries(files)) {
    code.set(p, content);
    langs.set(p, lang);
  }
  const report = createMockReport();
  return await parseAll(code, langs, report);
}

describe("symbols and resolvers", () => {
  beforeAll(async () => {
    await initParsers();
  });

  it("import tương đối", async () => {
    const files = await parseVirtualFiles({
      "src/app.ts": 'import { add } from "./math";\nconsole.log(add(1, 2));',
      "src/math.ts": "export function add(a: number, b: number): number { return a + b; }",
    });

    const idx = collectSymbols(files);
    resolveImports(files, idx, new Map(), {
      go_module_path: null,
      dart_package_name: null,
      package_entry_files: [],
    });

    const appImports = idx.imports.get("src/app.ts");
    expect(appImports).toBeDefined();
    const addImport = appImports?.get("add");
    expect(addImport).toBeDefined();
    expect(addImport?.resolved_file).toBe("src/math.ts");
    expect(addImport?.imported_name).toBe("add");
  });

  it("import index", async () => {
    const files = await parseVirtualFiles({
      "src/app.ts": 'import { util } from "./utils";\nutil();',
      "src/utils/index.ts": "export function util(): void {}",
    });

    const idx = collectSymbols(files);
    resolveImports(files, idx, new Map(), {
      go_module_path: null,
      dart_package_name: null,
      package_entry_files: [],
    });

    const appImports = idx.imports.get("src/app.ts");
    const utilImport = appImports?.get("util");
    expect(utilImport?.resolved_file).toBe("src/utils/index.ts");
  });

  it("barrel 2 tầng tới đúng file định nghĩa", async () => {
    const files = await parseVirtualFiles({
      "src/app.ts": 'import { foo } from "./barrel1";\nfoo();',
      "src/barrel1.ts": 'export { foo } from "./barrel2";',
      "src/barrel2.ts": 'export { foo } from "./origin";',
      "src/origin.ts": "export function foo(): string { return 'ok'; }",
    });

    const idx = collectSymbols(files);
    resolveImports(files, idx, new Map(), {
      go_module_path: null,
      dart_package_name: null,
      package_entry_files: [],
    });

    const appImports = idx.imports.get("src/app.ts");
    const fooImport = appImports?.get("foo");
    expect(fooImport?.resolved_file).toBe("src/origin.ts");
    expect(fooImport?.imported_name).toBe("foo");
  });

  it("export * qua barrel", async () => {
    const files = await parseVirtualFiles({
      "src/app.ts": 'import { bar } from "./barrel";\nbar();',
      "src/barrel.ts": 'export * from "./origin";',
      "src/origin.ts": "export function bar(): void {}",
    });

    const idx = collectSymbols(files);
    resolveImports(files, idx, new Map(), {
      go_module_path: null,
      dart_package_name: null,
      package_entry_files: [],
    });

    const appImports = idx.imports.get("src/app.ts");
    const barImport = appImports?.get("bar");
    expect(barImport?.resolved_file).toBe("src/origin.ts");
    expect(barImport?.imported_name).toBe("bar");
  });

  it("alias @/ theo paths trong tsconfig có comment và dấu phẩy thừa", async () => {
    const tsconfigJson = `{
      // Comment trong tsconfig
      "compilerOptions": {
        "baseUrl": ".",
        "paths": {
          "@/*": ["src/*"],
        },
      },
    }`;

    const manifests = new Map<string, string>();
    manifests.set("tsconfig.json", tsconfigJson);

    const files = await parseVirtualFiles({
      "src/pages/home.ts": 'import { Header } from "@/components/header";\nHeader();',
      "src/components/header.ts": "export function Header(): void {}",
    });

    const idx = collectSymbols(files);
    resolveImports(files, idx, manifests, {
      go_module_path: null,
      dart_package_name: null,
      package_entry_files: [],
    });

    const homeImports = idx.imports.get("src/pages/home.ts");
    const headerImport = homeImports?.get("Header");
    expect(headerImport?.resolved_file).toBe("src/components/header.ts");
  });

  it("@/ khi không có tsconfig", async () => {
    const manifests = new Map<string, string>();

    const files = await parseVirtualFiles({
      "src/pages/home.ts": 'import { Header } from "@/components/header";\nHeader();',
      "src/components/header.ts": "export function Header(): void {}",
    });

    const idx = collectSymbols(files);
    resolveImports(files, idx, manifests, {
      go_module_path: null,
      dart_package_name: null,
      package_entry_files: [],
    });

    const homeImports = idx.imports.get("src/pages/home.ts");
    const headerImport = homeImports?.get("Header");
    expect(headerImport?.resolved_file).toBe("src/components/header.ts");
  });

  it("./x.js về x.ts", async () => {
    const files = await parseVirtualFiles({
      "src/app.ts": 'import { x } from "./x.js";\nconsole.log(x);',
      "src/x.ts": "export const x = 42;",
    });

    const idx = collectSymbols(files);
    resolveImports(files, idx, new Map(), {
      go_module_path: null,
      dart_package_name: null,
      package_entry_files: [],
    });

    const appImports = idx.imports.get("src/app.ts");
    const xImport = appImports?.get("x");
    expect(xImport?.resolved_file).toBe("src/x.ts");
  });

  it("tên gói ⇒ null", () => {
    const allFiles = new Set(["src/app.ts"]);
    const resolved = resolveTsJsImport("src/app.ts", "express", allFiles, null, "");
    expect(resolved).toBeNull();
  });

  it("sai hoa thường ⇒ null", () => {
    const allFiles = new Set(["src/utils.ts"]);
    const resolved = resolveTsJsImport("src/app.ts", "./Utils", allFiles, null, "");
    expect(resolved).toBeNull();
  });

  it("../ vượt gốc ⇒ null", () => {
    const allFiles = new Set(["secret.ts"]);
    const resolved = resolveTsJsImport("src/app.ts", "../../secret", allFiles, null, "");
    expect(resolved).toBeNull();
  });

  it("barrel trỏ vòng kết thúc, không treo", () => {
    const reExports = new Map();
    reExports.set("src/a.ts", [
      {
        exported_name: "circular",
        imported_name: "circular",
        source: "./b",
        resolved_file: "src/b.ts",
        line: 1,
      },
    ]);
    reExports.set("src/b.ts", [
      {
        exported_name: "circular",
        imported_name: "circular",
        source: "./a",
        resolved_file: "src/a.ts",
        line: 1,
      },
    ]);

    const result = followBarrelReExport(
      "src/a.ts",
      "circular",
      reExports,
      0,
      new Set(),
      () => false
    );
    expect(result).toBeNull();
  });

  it("barrel sâu hơn CONFIG.BARREL_MAX_DEPTH ⇒ null", () => {
    const reExports = new Map();
    const maxDepth = CONFIG.BARREL_MAX_DEPTH;

    for (let i = 0; i <= maxDepth + 1; i++) {
      const fromFile = `src/b${i}.ts`;
      const toFile = `src/b${i + 1}.ts`;
      reExports.set(fromFile, [
        {
          exported_name: "deep",
          imported_name: "deep",
          source: `./b${i + 1}`,
          resolved_file: toFile,
          line: 1,
        },
      ]);
    }

    const result = followBarrelReExport(
      "src/b0.ts",
      "deep",
      reExports,
      0,
      new Set(),
      (file) => file === `src/b${maxDepth + 2}.ts`
    );
    expect(result).toBeNull();
  });

  it("require cả 2 dạng", async () => {
    const files = await parseVirtualFiles({
      "src/app.ts": `
        const utils = require("./utils");
        const { add, sub: minus } = require("./math");
      `,
      "src/utils.ts": "export const a = 1;",
      "src/math.ts": "export const add = 1; export const sub = 2;",
    });

    const idx = collectSymbols(files);
    resolveImports(files, idx, new Map(), {
      go_module_path: null,
      dart_package_name: null,
      package_entry_files: [],
    });

    const appImports = idx.imports.get("src/app.ts");
    expect(appImports).toBeDefined();

    const utilsImp = appImports?.get("utils");
    expect(utilsImp?.is_namespace).toBe(true);
    expect(utilsImp?.imported_name).toBe("*");
    expect(utilsImp?.resolved_file).toBe("src/utils.ts");

    const addImp = appImports?.get("add");
    expect(addImp?.is_namespace).toBe(false);
    expect(addImp?.imported_name).toBe("add");
    expect(addImp?.local_name).toBe("add");
    expect(addImp?.resolved_file).toBe("src/math.ts");

    const minusImp = appImports?.get("minus");
    expect(minusImp?.is_namespace).toBe(false);
    expect(minusImp?.imported_name).toBe("sub");
    expect(minusImp?.local_name).toBe("minus");
    expect(minusImp?.resolved_file).toBe("src/math.ts");
  });

  it("khóa file#Class.method", async () => {
    const files = await parseVirtualFiles({
      "src/service.ts": `
        class UserService {
          getUser() { return 1; }
        }
      `,
    });

    const idx = collectSymbols(files);
    expect(idx.symbols.has("src/service.ts#UserService.getUser")).toBe(true);
    const methodDef = idx.symbols.get("src/service.ts#UserService.getUser");
    expect(methodDef?.kind).toBe("METHOD");
  });

  it("trùng tên ra ~2", async () => {
    const files = await parseVirtualFiles({
      "src/dup.ts": `
        function run(): void {}
        function run(): void {}
      `,
    });

    const idx = collectSymbols(files);
    expect(idx.symbols.has("src/dup.ts#run")).toBe(true);
    expect(idx.symbols.has("src/dup.ts#run~2")).toBe(true);
  });

  it("is_exported của export, export { a }, module.exports, exports.a", async () => {
    const files = await parseVirtualFiles({
      "src/exp.ts": `
        export function f1(): void {}
        function f2(): void {}
        export { f2 };
        function f3(): void {}
        module.exports = f3;
        function f4(): void {}
        exports.f4 = f4;
      `,
    });

    const idx = collectSymbols(files);
    expect(idx.symbols.get("src/exp.ts#f1")?.is_exported).toBe(true);
    expect(idx.symbols.get("src/exp.ts#f2")?.is_exported).toBe(true);
    expect(idx.symbols.get("src/exp.ts#f3")?.is_exported).toBe(true);
    expect(idx.symbols.get("src/exp.ts#f4")?.is_exported).toBe(true);
  });

  it("file#default", async () => {
    const files = await parseVirtualFiles({
      "src/comp.ts": "export default class Component {}",
    });

    const idx = collectSymbols(files);
    expect(idx.symbols.has("src/comp.ts#default")).toBe(true);
    const defaultDef = idx.symbols.get("src/comp.ts#default");
    expect(defaultDef?.is_exported).toBe(true);
    expect(defaultDef?.kind).toBe("CLASS");
  });

  it("line_start lấy từ decorator", async () => {
    const files = await parseVirtualFiles({
      "src/dec.ts": `@Controller("/test")
export class TestController {
  @Get("/hello")
  hello() {}
}`,
    });

    const idx = collectSymbols(files);
    const classDef = idx.symbols.get("src/dec.ts#TestController");
    expect(classDef?.line_start).toBe(1);

    const methodDef = idx.symbols.get("src/dec.ts#TestController.hello");
    expect(methodDef?.line_start).toBe(3);
  });

  it("field_types với constructor private readonly s: S", async () => {
    const files = await parseVirtualFiles({
      "src/service.ts": `
        interface S {}
        class Service {
          constructor(private readonly s: S) {}
        }
      `,
    });

    const idx = collectSymbols(files);
    expect(idx.field_types.get("src/service.ts#Service.s")).toBe("S");
  });

  it('stripJsonc giữ "http://x"', () => {
    const raw = '{\n  "url": "http://x", // comment\n}';
    const stripped = stripJsonc(raw);
    expect(stripped).toContain('"http://x"');
    const parsed = parseJsonc<{ url: string }>(raw);
    expect(parsed.url).toBe("http://x");
  });
});
