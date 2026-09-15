import { parseHTML } from "linkedom";
import assert from "node:assert/strict";
import { emptyDoc } from "../src/model";
import { docFromImport, treeFromRelativePaths } from "../src/scan-core";
import { mountArchitect, type ImportDraft } from "../src/ui";

const { window, document } = parseHTML("<!doctype html><html><body></body></html>");
Object.defineProperty(globalThis, "window", { value: window, configurable: true });
Object.defineProperty(globalThis, "document", { value: document, configurable: true });
Object.defineProperty(globalThis, "HTMLElement", { value: window.HTMLElement, configurable: true });
try {
  Object.defineProperty(globalThis, "navigator", {
    value: { clipboard: { async writeText() {} } },
    configurable: true,
  });
} catch {
  try {
    Object.defineProperty(globalThis.navigator, "clipboard", {
      value: { async writeText() {} },
      configurable: true,
    });
  } catch {
    // copy button is best-effort in tests
  }
}

function btn(root: Element, label: string): HTMLButtonElement {
  const found = [...root.querySelectorAll("button")].find((item) => item.textContent === label);
  assert.ok(found, `button "${label}" missing`);
  return found as HTMLButtonElement;
}

function click(node: Element): void {
  node.dispatchEvent(new window.Event("click", { bubbles: true }));
}

function testUi() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const imports: ImportDraft[] = [];
  const refreshes: number[] = [];
  const ui = mountArchitect(
    host,
    emptyDoc({ title: "Test" }),
    {
      onChange: () => {},
      onImport: (draft) => {
        imports.push(draft);
      },
      onRefresh: () => {
        refreshes.push(1);
      },
    },
    { canPickVault: true, canPickFs: true, pickFsFolder: async () => "Library", pickVaultFolder: async () => "Library" },
  );

  assert.equal(host.textContent?.includes("Design a folder structure"), true);
  click(btn(host, "Start blank"));
  const name = host.querySelector(".fa-name") as HTMLInputElement | null;
  assert.ok(name);
  assert.equal(name.value, "library");

  click(btn(host, "+ File"));
  const names = [...host.querySelectorAll(".fa-name")].map((item) => (item as HTMLInputElement).value);
  assert.ok(names.includes("new-file"));

  const desc = host.querySelector(".fa-desc") as HTMLInputElement | null;
  assert.ok(desc);
  desc.value = "reusable library root";
  desc.dispatchEvent(new window.Event("input", { bubbles: true }));
  desc.dispatchEvent(new window.Event("change", { bubbles: true }));
  assert.equal(ui.getDoc().roots[0]?.description, "reusable library root");

  click(btn(host, "Import folder"));
  assert.ok(host.querySelector(".fa-modal"));
  click(btn(host, "Folders only"));
  click(btn(host, "Live view"));
  const path = host.querySelector(".fa-path") as HTMLInputElement | null;
  assert.ok(path);
  path.value = "Library";
  path.dispatchEvent(new window.Event("input", { bubbles: true }));
  click(btn(host, "Import"));
  assert.equal(imports.length, 1);
  assert.equal(imports[0]?.includeFiles, false);
  assert.equal(imports[0]?.mode, "live");
  assert.equal(imports[0]?.path, "Library");

  const tree = treeFromRelativePaths(
    ["Library/Functions/Motor.m", "Library/Main.m"],
    { includeFiles: true, sourceKind: "fs" },
  );
  assert.ok(tree);
  ui.update(
    docFromImport({
      root: tree,
      mode: "live",
      sourcePath: "Library",
      sourceKind: "fs",
      includeFiles: true,
      linkFiles: false,
    }),
  );
  assert.equal(btn(host, "+ Folder").disabled, true);
  click(btn(host, "Refresh"));
  assert.equal(refreshes.length, 1);
  click(btn(host, "Clone as snapshot"));
  assert.equal(ui.getDoc().mode, "design");
  assert.equal(btn(host, "+ Folder").disabled, false);

  ui.destroy();
  console.log("ok  ui empty, add, describe, import modal, live lock, clone");
}

testUi();
