import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toAsciiTree } from "../src/ascii";
import { filterTree } from "../src/filter";
import { mergeLiveScan } from "../src/merge";
import { emptyDoc, emptyNode, type ArchNode } from "../src/model";
import { parseEmbedQuery } from "../src/query";
import { bakeStaticIntoMarkdown, findBakedAscii } from "../src/static-store";
import { scanFsFolder } from "../src/scan";
import { treeFromRelativePaths } from "../src/scan-core";
import { extractBlocks, parseDoc, upsertArchitectBlock } from "../src/serialize";
import {
  addChild,
  deleteNode,
  flattenVisible,
  indentNode,
  locate,
  moveNode,
  outdentNode,
  relocateNode,
} from "../src/tree-ops";

function test(name: string, fn: () => void | Promise<void>) {
  return { name, fn };
}

const SAMPLE = [
  "Library/Functions/Alpha.m",
  "Library/Functions/Common.m",
  "Library/Functions/Beta.m",
  "Library/Functions/Tests/AlphaTester.m",
  "Library/Functions/Tests/CommonTester.m",
  "Library/Functions/Tests/GammaTester.m",
  "Library/Functions/Tests/BetaTester.m",
  "Library/Functions/Tests/DeltaTester.m",
  "Library/Functions/Tests/MotorTester.m",
  "Library/Functions/Delta.m",
  "Library/Functions/Motor.m",
  "Library/Functions/Epsilon.m",
  "Library/Helpers.m",
  "Library/Main.m",
  "Library/Legacy.m",
];

const tests = [
  test("tree ops indent outdent move delete", () => {
    const roots: ArchNode[] = [];
    const a = addChild(roots, null, "folder", "src");
    const b = addChild(roots, null, "folder", "tests");
    assert.ok(a && b);
    const file = addChild(roots, a.id, "file", "Main.m");
    assert.ok(file);
    assert.equal(indentNode(roots, b.id), true);
    assert.equal(a.children.map((n) => n.name).join(","), "Main.m,tests");
    assert.equal(outdentNode(roots, b.id), true);
    assert.equal(roots.map((n) => n.name).join(","), "src,tests");
    assert.equal(moveNode(roots, b.id, "up"), true);
    assert.equal(roots[0]?.name, "tests");
    assert.equal(deleteNode(roots, file.id), true);
    assert.equal(locate(roots, file.id), null);
  }),

  test("relocateNode moves folders with children between trees", () => {
    const roots: ArchNode[] = [];
    const lib = addChild(roots, null, "folder", "Library");
    const extra = addChild(roots, null, "folder", "Extra");
    assert.ok(lib && extra);
    const fn = addChild(roots, lib.id, "folder", "Functions");
    assert.ok(fn);
    addChild(roots, fn.id, "file", "Motor.m");
    const lone = addChild(roots, extra.id, "file", "Notes.md");
    assert.ok(lone);
    assert.equal(relocateNode(roots, fn.id, extra.id, "inside"), true);
    assert.equal(lib.children.length, 0);
    assert.equal(extra.children.map((n) => n.name).join(","), "Notes.md,Functions");
    assert.equal(extra.children[1]?.children[0]?.name, "Motor.m");
    assert.equal(relocateNode(roots, extra.id, fn.id, "inside"), false);
    assert.equal(relocateNode(roots, lone.id, lib.id, "before"), true);
    assert.equal(roots.map((n) => n.name).join(","), "Notes.md,Library,Extra");
  }),

  test("visible rows use ascii branch prefixes", () => {
    const roots: ArchNode[] = [];
    const src = addChild(roots, null, "folder", "src");
    assert.ok(src);
    addChild(roots, src.id, "file", "Main.m");
    addChild(roots, null, "folder", "tests");
    const rows = flattenVisible(roots);
    assert.equal(rows[0]?.prefix, "");
    assert.equal(rows[1]?.prefix, "└── ");
    assert.equal(rows[2]?.prefix, "");
    const nested = flattenVisible(roots);
    const testsFolder = nested.find((row) => row.node.name === "tests");
    assert.equal(testsFolder?.prefix, "");
  }),

  test("embed query parses path and comma options", () => {
    const query = parseEmbedQuery("/Library, display:live, comments:disable");
    assert.ok(query);
    assert.equal(query.path, "Library");
    assert.equal(query.display, "live");
    assert.equal(query.comments, false);
    assert.equal(query.explicit, true);
    const commentsOn = parseEmbedQuery("lib, comments:enable, files:off, filter:Tester, ext:m");
    assert.equal(commentsOn?.comments, true);
    assert.equal(commentsOn?.files, false);
    assert.equal(commentsOn?.filter, "Tester");
    assert.equal(commentsOn?.ext, "m");
    assert.equal(parseEmbedQuery("lib, display:static")?.display, "static");
    assert.equal(parseEmbedQuery("lib, display:snapshot")?.display, "static");
    assert.equal(parseEmbedQuery("lib, display:static, refresh")?.refresh, true);
    assert.equal(parseEmbedQuery("lib, display:static")?.refresh, false);
  }),

  test("filterTree keeps ancestors of matching files", () => {
    const tree = treeFromRelativePaths(SAMPLE, { includeFiles: true, sourceKind: "fs" });
    assert.ok(tree);
    const filtered = filterTree(tree, "Tester", "");
    const ascii = toAsciiTree([filtered]);
    assert.match(ascii, /MotorTester\.m/);
    assert.doesNotMatch(ascii, /Main\.m/);
    assert.match(ascii, /Tests\//);
  }),

  test("static bake keeps the embed line and strips refresh", () => {
    const src = "/Library, display:static, comments:disable, files:off, refresh";
    const md = [
      "See:",
      `![[${src}]]`,
      "%%fa-static %2Ffoo",
      JSON.stringify({ version: 1, roots: [{ name: "Library", type: "folder", description: "", children: [{ name: "Functions", type: "folder", description: "", children: [] }] }] }),
      "%%",
      "",
    ].join("\n");
    const baked = bakeStaticIntoMarkdown(md, src, "Library/\n└── Functions/");
    assert.match(baked, /!\[\[\/Library, display:static, comments:disable, files:off\]\]/);
    assert.doesNotMatch(baked, /refresh/);
    assert.match(baked, /```arbourist-static/);
    assert.match(baked, /└── Functions\//);
    assert.doesNotMatch(baked, /%%fa-static/);
    assert.doesNotMatch(baked, /"version": 1/);
    assert.equal(findBakedAscii(baked, src), "Library/\n└── Functions/");
    const again = bakeStaticIntoMarkdown(baked, "/Library, display:static, comments:disable, files:off", "Library/\n└── Functions/\n    └── Tests/");
    assert.equal(again.split("```arbourist-static").length - 1, 1);
    assert.match(again, /Tests\//);
  }),

  test("folders-only import skips files but keeps Tests", () => {
    const tree = treeFromRelativePaths(SAMPLE, { includeFiles: false, sourceKind: "fs" });
    assert.ok(tree);
    const ascii = toAsciiTree([tree]);
    assert.match(ascii, /Functions\//);
    assert.match(ascii, /Tests\//);
    assert.doesNotMatch(ascii, /Main\.m/);
    assert.doesNotMatch(ascii, /MotorTester\.m/);
  }),

  test("full import lists every file from the sample tree", () => {
    const tree = treeFromRelativePaths(SAMPLE, { includeFiles: true, sourceKind: "fs" });
    assert.ok(tree);
    const ascii = toAsciiTree([tree]);
    for (const path of SAMPLE) {
      const name = path.split("/").pop();
      assert.ok(name && ascii.includes(name), `missing ${name}`);
    }
  }),

  test("vault link option stamps wikilink paths", () => {
    const tree = treeFromRelativePaths(["lib/src/Main.m"], {
      includeFiles: true,
      linkFiles: true,
      sourceKind: "vault",
    });
    assert.equal(tree?.children[0]?.children[0]?.link, "lib/src/Main.m");
  }),

  test("fs import does not stamp links even if asked", () => {
    const tree = treeFromRelativePaths(["lib/src/Main.m"], {
      includeFiles: true,
      linkFiles: true,
      sourceKind: "fs",
    });
    assert.equal(tree?.children[0]?.children[0]?.link, undefined);
  }),

  test("live merge keeps descriptions and flags missing files", () => {
    const oldRoot = treeFromRelativePaths(SAMPLE, { includeFiles: true, sourceKind: "fs" });
    assert.ok(oldRoot);
    const motor = oldRoot.children
      .find((n) => n.name === "Functions")
      ?.children.find((n) => n.name === "Motor.m");
    assert.ok(motor);
    motor.description = "motor model";
    const gone = oldRoot.children.find((n) => n.name === "Legacy.m");
    assert.ok(gone);
    gone.description = "old helper";
    const current = emptyDoc({
      mode: "live",
      sourcePath: "Library",
      sourceKind: "fs",
      roots: [oldRoot],
      annotations: { [motor.relPath ?? ""]: "motor model" },
    });
    const nextPaths = SAMPLE.filter((p) => !p.endsWith("Legacy.m"));
    const scanned = treeFromRelativePaths(nextPaths, { includeFiles: true, sourceKind: "fs" });
    assert.ok(scanned);
    const merged = mergeLiveScan(current, scanned);
    const mergedMotor = merged.roots[0]?.children
      .find((n) => n.name === "Functions")
      ?.children.find((n) => n.name === "Motor.m");
    assert.equal(mergedMotor?.description, "motor model");
    const missing = merged.roots[0]?.children.find((n) => n.name === "_missing");
    assert.ok(missing);
    assert.equal(missing.children[0]?.name, "Legacy.m");
    assert.equal(missing.children[0]?.missing, true);
  }),

  test("markdown roundtrip preserves id and descriptions", () => {
    const doc = emptyDoc({ title: "Lib" });
    const folder = emptyNode("src", "folder", "src");
    folder.description = "code";
    doc.roots = [folder];
    const md = "# Lib\n\n```arbourist\n" + JSON.stringify(doc) + "\n```\n";
    const blocks = extractBlocks(md);
    assert.equal(blocks[0]?.doc.roots[0]?.description, "code");
    const next = parseDoc(JSON.stringify({ ...doc, title: "Library" }));
    next.roots[0]!.description = "reusable code";
    const updated = upsertArchitectBlock(md, next);
    assert.match(updated, /reusable code/);
    assert.match(updated, /# Lib/);
  }),

  test("scanFsFolder reads a real temp directory", async () => {
    const dir = mkdtempSync(join(tmpdir(), "arbourist-"));
    try {
      mkdirSync(join(dir, "Functions", "Tests"), { recursive: true });
      writeFileSync(join(dir, "Main.m"), "% main");
      writeFileSync(join(dir, "Functions", "Motor.m"), "% motor");
      writeFileSync(join(dir, "Functions", "Tests", "MotorTester.m"), "% test");
      mkdirSync(join(dir, ".git"));
      writeFileSync(join(dir, ".git", "config"), "x");
      const full = await scanFsFolder(dir, { includeFiles: true, sourceKind: "fs" });
      const names = toAsciiTree([full]);
      assert.match(names, /Main\.m/);
      assert.match(names, /MotorTester\.m/);
      assert.doesNotMatch(names, /\.git/);
      const foldersOnly = await scanFsFolder(dir, { includeFiles: false, sourceKind: "fs" });
      assert.doesNotMatch(toAsciiTree([foldersOnly]), /Main\.m/);
      assert.match(toAsciiTree([foldersOnly]), /Functions\//);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }),
];

let failed = 0;
async function run() {
  for (const item of tests) {
    try {
      await item.fn();
      console.log(`ok  ${item.name}`);
    } catch (error) {
      failed += 1;
      console.error(`fail  ${item.name}`);
      console.error(error);
    }
  }
  if (failed) {
    console.error(`\n${failed} failed`);
    process.exit(1);
  }
  console.log(`\n${tests.length} passed`);
}

void run();
