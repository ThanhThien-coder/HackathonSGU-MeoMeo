import type { Node } from "web-tree-sitter";
import type { IngestOutput, SymbolDefinition } from "@/contracts";
import { getQuery } from "./parser";
import { collectTsJsImports, resolveReExports } from "./resolvers/ts_js";
import type { FunctionInfo, ParsedFile, SymbolIndex } from "./types";

export function uniqueKey(baseKey: string, keyCounts: Map<string, number>): string {
  const count = keyCounts.get(baseKey) ?? 0;
  keyCounts.set(baseKey, count + 1);
  if (count === 0) {
    return baseKey;
  }
  return `${baseKey}~${count + 1}`;
}

function findEnclosingClass(node: Node): { className: string; isAbstract: boolean } | null {
  let curr = node.parent;
  while (curr) {
    if (
      curr.type === "class_declaration" ||
      curr.type === "abstract_class_declaration" ||
      curr.type === "class" ||
      curr.type === "enum_declaration" ||
      curr.type === "record_declaration"
    ) {
      const nameNode =
        curr.childForFieldName("name") ??
        curr.children.find((c) => c.type === "type_identifier" || c.type === "identifier");
      if (nameNode) {
        const isAbstract =
          curr.type === "abstract_class_declaration" ||
          curr.children.some((c) => c.text === "abstract");
        return { className: nameNode.text, isAbstract };
      }
    }
    if (curr.type === "object" || curr.type === "object_expression") {
      return null;
    }
    curr = curr.parent;
  }
  return null;
}

function getLineStart(node: Node, isMethod: boolean): number {
  let minRow = node.startPosition.row;

  for (const child of node.children) {
    if (child.type === "decorator") {
      if (child.startPosition.row < minRow) {
        minRow = child.startPosition.row;
      }
    }
  }

  let prev = node.previousNamedSibling;
  while (prev && prev.type === "decorator") {
    if (prev.startPosition.row < minRow) {
      minRow = prev.startPosition.row;
    }
    prev = prev.previousNamedSibling;
  }

  if (!isMethod && node.parent) {
    if (
      node.parent.type === "export_statement" ||
      node.parent.type === "export_declaration"
    ) {
      for (const child of node.parent.children) {
        if (child.type === "decorator") {
          if (child.startPosition.row < minRow) {
            minRow = child.startPosition.row;
          }
        }
      }
      let parentPrev = node.parent.previousNamedSibling;
      while (parentPrev && parentPrev.type === "decorator") {
        if (parentPrev.startPosition.row < minRow) {
          minRow = parentPrev.startPosition.row;
        }
        parentPrev = parentPrev.previousNamedSibling;
      }
    }
  }

  return minRow + 1;
}

function collectFileExportedNames(root: Node): Set<string> {
  const exported = new Set<string>();

  function walk(node: Node): void {
    if (node.type === "export_statement") {
      const hasSource =
        node.childForFieldName("source") ||
        node.children.some((c) => c.type === "string");
      if (!hasSource) {
        const clause =
          node.childForFieldName("export_clause") ??
          node.children.find((c) => c.type === "export_clause");
        if (clause) {
          for (const spec of clause.namedChildren) {
            if (spec.type === "export_specifier") {
              const nameNode =
                spec.childForFieldName("name") ??
                spec.children.find(
                  (c) => c.type === "identifier" || c.type === "type_identifier"
                );
              if (nameNode) {
                exported.add(nameNode.text);
              }
            }
          }
        }
      }
    }

    if (node.type === "assignment_expression") {
      const left = node.childForFieldName("left") ?? node.namedChild(0);
      const right = node.childForFieldName("right") ?? node.namedChild(1);
      if (left && right) {
        const leftText = left.text;
        if (leftText === "module.exports") {
          if (right.type === "identifier") {
            exported.add(right.text);
          } else if (right.type === "object") {
            for (const prop of right.namedChildren) {
              if (
                prop.type === "shorthand_property_identifier" ||
                prop.type === "identifier"
              ) {
                exported.add(prop.text);
              } else if (prop.type === "pair") {
                const val = prop.childForFieldName("value") ?? prop.namedChild(1);
                if (val && val.type === "identifier") {
                  exported.add(val.text);
                }
              }
            }
          }
        } else if (leftText.startsWith("exports.")) {
          const propName = leftText.slice("exports.".length);
          if (propName) {
            exported.add(propName);
            if (right.type === "identifier") {
              exported.add(right.text);
            }
          }
        }
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) {
        walk(child);
      }
    }
  }

  walk(root);
  return exported;
}

function extractBoundNames(node: Node): string[] {
  const names: string[] = [];

  function walk(n: Node): void {
    if (n.type === "identifier") {
      names.push(n.text);
      return;
    }
    if (n.type === "required_parameter" || n.type === "optional_parameter") {
      const pattern = n.childForFieldName("pattern") ?? n.namedChild(0);
      if (pattern) {
        walk(pattern);
      }
      return;
    }
    if (n.type === "rest_pattern") {
      const inner = n.namedChild(0);
      if (inner) {
        walk(inner);
      }
      return;
    }
    if (n.type === "assignment_pattern") {
      const left = n.childForFieldName("left") ?? n.namedChild(0);
      if (left) {
        walk(left);
      }
      return;
    }
    if (n.type === "object_pattern") {
      for (const child of n.namedChildren) {
        if (
          child.type === "shorthand_property_identifier_pattern" ||
          child.type === "identifier"
        ) {
          names.push(child.text);
        } else if (child.type === "pair_pattern" || child.type === "pair") {
          const val = child.childForFieldName("value") ?? child.namedChild(1);
          if (val) {
            walk(val);
          }
        } else {
          walk(child);
        }
      }
      return;
    }
    if (n.type === "array_pattern") {
      for (const child of n.namedChildren) {
        walk(child);
      }
      return;
    }
    if (n.type === "formal_parameter" || n.type === "spread_parameter") {
      const nameNode =
        n.childForFieldName("name") ??
        n.children.find((c) => c.type === "identifier");
      if (nameNode) {
        names.push(nameNode.text);
      }
      return;
    }
  }

  walk(node);
  return names;
}

function extractParams(defNode: Node): string[] {
  const paramsNode =
    defNode.childForFieldName("parameters") ??
    defNode.children.find(
      (c) => c.type === "formal_parameters" || c.type === "parameters"
    );

  if (!paramsNode) {
    return [];
  }

  const result: string[] = [];
  for (const child of paramsNode.namedChildren) {
    const names = extractBoundNames(child);
    result.push(...names);
  }
  return result;
}

function extractLocals(defNode: Node): string[] {
  const bodyNode =
    defNode.childForFieldName("body") ??
    defNode.children.find(
      (c) =>
        c.type === "statement_block" ||
        c.type === "block" ||
        c.type === "block_statement"
    );

  if (!bodyNode) {
    return [];
  }

  const locals: string[] = [];

  function walk(n: Node): void {
    if (
      n !== defNode &&
      (n.type === "function_declaration" ||
        n.type === "generator_function_declaration" ||
        n.type === "function_expression" ||
        n.type === "arrow_function" ||
        n.type === "method_definition")
    ) {
      return;
    }

    if (n.type === "variable_declarator") {
      const nameNode = n.childForFieldName("name") ?? n.namedChild(0);
      if (nameNode) {
        locals.push(...extractBoundNames(nameNode));
      }
    } else if (n.type === "catch_clause") {
      const paramNode =
        n.childForFieldName("parameter") ??
        n.children.find(
          (c) =>
            c.type === "catch_formal_parameter" ||
            c.type === "identifier" ||
            c.type === "object_pattern"
        );
      if (paramNode) {
        locals.push(...extractBoundNames(paramNode));
      }
    }

    for (let i = 0; i < n.childCount; i++) {
      const child = n.child(i);
      if (child) {
        walk(child);
      }
    }
  }

  for (let i = 0; i < bodyNode.childCount; i++) {
    const child = bodyNode.child(i);
    if (child) {
      walk(child);
    }
  }

  return locals;
}

function cleanTypeName(raw: string): string {
  let cleaned = raw.replace(/^:\s*/, "").trim();
  cleaned = cleaned.split("<")[0].trim();
  return cleaned;
}

interface SymbolCandidate {
  defNode: Node;
  name: string;
  kind: "FUNCTION" | "METHOD" | "CLASS" | "INTERFACE" | "TYPE" | "VARIABLE";
  isDirectDefaultExport: boolean;
}

export function collectSymbols(files: ParsedFile[]): SymbolIndex {
  const idx: SymbolIndex = {
    symbols: new Map(),
    imports: new Map(),
    re_exports: new Map(),
    field_types: new Map(),
    interface_impls: new Map(),
    locals: new Map(),
    functions: new Map(),
  };

  const keyCounts = new Map<string, number>();
  const abstractClasses = new Set<string>();

  const sortedFiles = [...files].sort((a, b) => a.path.localeCompare(b.path));

  for (const file of sortedFiles) {
    const isJava = file.language === "JAVA";
    const isTsJs =
      file.language === "TYPESCRIPT" ||
      file.language === "TSX" ||
      file.language === "JAVASCRIPT";

    const fileExportedNames = isTsJs ? collectFileExportedNames(file.tree.rootNode) : new Set<string>();

    const query = getQuery(file.language);
    const matches = query.matches(file.tree.rootNode);

    const candidates: SymbolCandidate[] = [];

    for (const match of matches) {
      const defCapture = match.captures.find((c) => c.name.startsWith("def."));
      const nameCapture = match.captures.find((c) => c.name === "name");

      if (!defCapture || !nameCapture) {
        continue;
      }

      let kind: SymbolCandidate["kind"] = "VARIABLE";
      switch (defCapture.name) {
        case "def.function":
          kind = "FUNCTION";
          break;
        case "def.method":
          kind = "METHOD";
          break;
        case "def.class":
          kind = "CLASS";
          break;
        case "def.interface":
          kind = "INTERFACE";
          break;
        case "def.type":
          kind = "TYPE";
          break;
        case "def.var":
          kind = "VARIABLE";
          break;
        default:
          continue;
      }

      const isDirectDefaultExport =
        defCapture.node.parent?.type === "export_statement" &&
        defCapture.node.parent.children.some((c) => c.text === "default");

      candidates.push({
        defNode: defCapture.node,
        name: nameCapture.node.text,
        kind,
        isDirectDefaultExport,
      });

      if (kind === "CLASS") {
        if (
          defCapture.node.type === "abstract_class_declaration" ||
          defCapture.node.children.some((c) => c.text === "abstract")
        ) {
          abstractClasses.add(nameCapture.node.text);
        }
      }
    }

    // ENG-21: Thêm biến cấp module của TS/JS
    if (isTsJs) {
      for (const topNode of file.tree.rootNode.children) {
        let declNode: Node | null = null;
        let isExportedTop = false;

        if (
          topNode.type === "lexical_declaration" ||
          topNode.type === "variable_declaration"
        ) {
          declNode = topNode;
        } else if (topNode.type === "export_statement") {
          const childDecl = topNode.children.find(
            (c) =>
              c.type === "lexical_declaration" ||
              c.type === "variable_declaration"
          );
          if (childDecl) {
            declNode = childDecl;
            isExportedTop = true;
          }
        }

        if (declNode) {
          for (const declarator of declNode.namedChildren) {
            if (declarator.type === "variable_declarator") {
              const nameNode =
                declarator.childForFieldName("name") ?? declarator.namedChild(0);
              const valNode =
                declarator.childForFieldName("value") ?? declarator.namedChild(1);

              if (nameNode && nameNode.type === "identifier") {
                const isFunctionVal =
                  valNode &&
                  (valNode.type === "arrow_function" ||
                    valNode.type === "function_expression");

                if (!isFunctionVal) {
                  const alreadyCaptured = candidates.some(
                    (c) =>
                      c.defNode.startIndex === declarator.startIndex &&
                      c.name === nameNode.text
                  );

                  if (!alreadyCaptured) {
                    candidates.push({
                      defNode: declarator,
                      name: nameNode.text,
                      kind: "VARIABLE",
                      isDirectDefaultExport:
                        isExportedTop &&
                        topNode.children.some((c) => c.text === "default"),
                    });
                  }
                }
              }
            }
          }
        }
      }
    }

    // Sort match theo vị trí bắt đầu trước khi tạo khóa
    candidates.sort((a, b) => {
      if (a.defNode.startIndex !== b.defNode.startIndex) {
        return a.defNode.startIndex - b.defNode.startIndex;
      }
      return a.defNode.endIndex - b.defNode.endIndex;
    });

    const fileDefinitions: SymbolDefinition[] = [];

    for (const cand of candidates) {
      let baseKey = `${file.path}#${cand.name}`;
      let enclosingClassInfo: { className: string; isAbstract: boolean } | null = null;

      if (cand.kind === "METHOD") {
        enclosingClassInfo = findEnclosingClass(cand.defNode);
        if (enclosingClassInfo) {
          baseKey = `${file.path}#${enclosingClassInfo.className}.${cand.name}`;
        }
      }

      const key = uniqueKey(baseKey, keyCounts);
      const isMethod = cand.kind === "METHOD";
      const line_start = getLineStart(cand.defNode, isMethod);
      const line_end = cand.defNode.endPosition.row + 1;

      let is_exported = false;
      if (isJava) {
        const modNode = cand.defNode.children.find((c) => c.type === "modifiers");
        if (modNode) {
          const hasPrivateOrProtected = modNode.children.some(
            (c) => c.text === "private" || c.text === "protected"
          );
          is_exported = !hasPrivateOrProtected;
        } else {
          is_exported = true;
        }
      } else if (isTsJs) {
        if (isMethod && enclosingClassInfo) {
          // Method theo lớp chứa nó
          const enclosingDef = fileDefinitions.find(
            (d) => d.name === enclosingClassInfo!.className && d.kind === "CLASS"
          );
          if (enclosingDef) {
            is_exported = enclosingDef.is_exported;
          } else {
            is_exported = fileExportedNames.has(enclosingClassInfo.className);
          }
        } else {
          let hasExportAncestor = false;
          let p = cand.defNode.parent;
          while (p) {
            if (p.type === "export_statement" || p.type === "export_declaration") {
              hasExportAncestor = true;
              break;
            }
            p = p.parent;
          }
          is_exported = hasExportAncestor || fileExportedNames.has(cand.name);
        }
      }

      const def: SymbolDefinition = {
        key,
        kind: cand.kind,
        name: cand.name,
        file_path: file.path,
        line_start,
        line_end,
        is_exported,
      };

      idx.symbols.set(key, def);
      fileDefinitions.push(def);

      if (cand.isDirectDefaultExport) {
        const defaultDef: SymbolDefinition = {
          ...def,
          key: `${file.path}#default`,
          is_exported: true,
        };
        idx.symbols.set(defaultDef.key, defaultDef);
      }

      if (cand.kind === "FUNCTION" || cand.kind === "METHOD") {
        const params = extractParams(cand.defNode);
        const locals = extractLocals(cand.defNode);
        const info: FunctionInfo = {
          ...def,
          params,
          locals,
          complexity: 0,
        };
        idx.functions.set(def.key, info);
        idx.locals.set(def.key, new Set([...params, ...locals]));

        if (cand.isDirectDefaultExport) {
          const defaultInfo: FunctionInfo = {
            ...info,
            key: `${file.path}#default`,
            is_exported: true,
          };
          idx.functions.set(defaultInfo.key, defaultInfo);
          idx.locals.set(defaultInfo.key, new Set([...params, ...locals]));
        }
      }
    }

    // Xử lý export default X cấp file (export default X;)
    if (isTsJs) {
      for (const topNode of file.tree.rootNode.children) {
        if (topNode.type === "export_statement") {
          const hasDefault = topNode.children.some((c) => c.text === "default");
          if (hasDefault) {
            const idNode = topNode.children.find((c) => c.type === "identifier");
            if (idNode) {
              const targetName = idNode.text;
              const matchingDef = fileDefinitions.find((d) => d.name === targetName);
              if (matchingDef) {
                const defaultDef: SymbolDefinition = {
                  ...matchingDef,
                  key: `${file.path}#default`,
                  is_exported: true,
                };
                idx.symbols.set(defaultDef.key, defaultDef);

                if (matchingDef.kind === "FUNCTION" || matchingDef.kind === "METHOD") {
                  const existingFunc = idx.functions.get(matchingDef.key);
                  if (existingFunc) {
                    const defaultFunc: FunctionInfo = {
                      ...existingFunc,
                      key: `${file.path}#default`,
                      is_exported: true,
                    };
                    idx.functions.set(defaultFunc.key, defaultFunc);
                    const existingLocals = idx.locals.get(matchingDef.key);
                    if (existingLocals) {
                      idx.locals.set(defaultFunc.key, new Set(existingLocals));
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    // ENG-22: idx.field_types
    // ENG-23: idx.interface_impls
    function analyzeClassTypesAndImpls(node: Node): void {
      if (
        node.type === "class_declaration" ||
        node.type === "abstract_class_declaration" ||
        node.type === "class"
      ) {
        const nameNode =
          node.childForFieldName("name") ??
          node.children.find((c) => c.type === "type_identifier" || c.type === "identifier");
        if (nameNode) {
          const className = nameNode.text;

          // Heritage: implements & extends
          const heritageNode =
            node.childForFieldName("heritage") ??
            node.children.find((c) => c.type === "class_heritage");

          if (heritageNode) {
            for (const hChild of heritageNode.namedChildren) {
              if (hChild.type === "implements_clause") {
                for (const iface of hChild.namedChildren) {
                  const ifaceName = cleanTypeName(iface.text);
                  if (ifaceName) {
                    let list = idx.interface_impls.get(ifaceName);
                    if (!list) {
                      list = [];
                      idx.interface_impls.set(ifaceName, list);
                    }
                    list.push(`${file.path}#${className}`);
                  }
                }
              } else if (hChild.type === "extends_clause") {
                for (const parentClause of hChild.namedChildren) {
                  const parentName = cleanTypeName(parentClause.text);
                  if (parentName && abstractClasses.has(parentName)) {
                    let list = idx.interface_impls.get(parentName);
                    if (!list) {
                      list = [];
                      idx.interface_impls.set(parentName, list);
                    }
                    list.push(`${file.path}#${className}`);
                  }
                }
              }
            }
          }

          // Fields & constructor param properties
          const bodyNode =
            node.childForFieldName("body") ??
            node.children.find((c) => c.type === "class_body");

          if (bodyNode) {
            for (const member of bodyNode.namedChildren) {
              // Constructor params with modifier and type
              if (member.type === "method_definition") {
                const methodName =
                  member.childForFieldName("name") ??
                  member.children.find((c) => c.type === "property_identifier");
                if (methodName && methodName.text === "constructor") {
                  const paramsNode =
                    member.childForFieldName("parameters") ??
                    member.children.find((c) => c.type === "formal_parameters");
                  if (paramsNode) {
                    for (const param of paramsNode.namedChildren) {
                      const hasModifier = param.children.some(
                        (c) =>
                          c.type === "accessibility_modifier" ||
                          c.text === "readonly" ||
                          c.text === "private" ||
                          c.text === "protected" ||
                          c.text === "public"
                      );
                      const typeNode =
                        param.childForFieldName("type") ??
                        param.children.find((c) => c.type === "type_annotation");
                      const nameNodeInParam =
                        param.childForFieldName("pattern") ??
                        param.children.find((c) => c.type === "identifier");

                      if (hasModifier && typeNode && nameNodeInParam) {
                        const typeName = cleanTypeName(typeNode.text);
                        idx.field_types.set(
                          `${file.path}#${className}.${nameNodeInParam.text}`,
                          typeName
                        );
                      }
                    }
                  }
                }
              }

              // Field with type or new T()
              if (
                member.type === "field_definition" ||
                member.type === "public_field_definition" ||
                member.type === "property_definition"
              ) {
                const fieldNameNode =
                  member.childForFieldName("name") ??
                  member.children.find(
                    (c) => c.type === "property_identifier" || c.type === "identifier"
                  );
                const typeNode =
                  member.childForFieldName("type") ??
                  member.children.find((c) => c.type === "type_annotation");
                const valNode =
                  member.childForFieldName("value") ??
                  member.children.find((c) => c.type === "new_expression");

                if (fieldNameNode) {
                  if (typeNode) {
                    const typeName = cleanTypeName(typeNode.text);
                    idx.field_types.set(
                      `${file.path}#${className}.${fieldNameNode.text}`,
                      typeName
                    );
                  } else if (valNode && valNode.type === "new_expression") {
                    const ctor =
                      valNode.childForFieldName("constructor") ??
                      valNode.namedChild(0);
                    if (ctor) {
                      const typeName = cleanTypeName(ctor.text);
                      idx.field_types.set(
                        `${file.path}#${className}.${fieldNameNode.text}`,
                        typeName
                      );
                    }
                  }
                }
              }
            }
          }
        }
      }

      // File-level or module variable x = new T()
      if (
        node.type === "lexical_declaration" ||
        node.type === "variable_declaration"
      ) {
        for (const declarator of node.namedChildren) {
          if (declarator.type === "variable_declarator") {
            const nameNode =
              declarator.childForFieldName("name") ?? declarator.namedChild(0);
            const valNode =
              declarator.childForFieldName("value") ?? declarator.namedChild(1);

            if (nameNode && nameNode.type === "identifier" && valNode && valNode.type === "new_expression") {
              const ctor =
                valNode.childForFieldName("constructor") ?? valNode.namedChild(0);
              if (ctor) {
                const typeName = cleanTypeName(ctor.text);
                idx.field_types.set(`${file.path}#${nameNode.text}`, typeName);
              }
            }
          }
        }
      }

      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) {
          analyzeClassTypesAndImpls(child);
        }
      }
    }

    analyzeClassTypesAndImpls(file.tree.rootNode);
  }

  return idx;
}

export function resolveImports(
  files: ParsedFile[],
  idx: SymbolIndex,
  manifests: Map<string, string>,
  _module_info: IngestOutput["module_info"],
  rootDirOffset = ""
): void {
  const allFiles = new Set(files.map((f) => f.path));

  for (const file of files) {
    if (
      file.language === "TYPESCRIPT" ||
      file.language === "TSX" ||
      file.language === "JAVASCRIPT"
    ) {
      collectTsJsImports(file, allFiles, manifests, rootDirOffset, idx);
    }
  }

  resolveReExports(idx);
}
