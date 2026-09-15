import type {} from "obsidian";
import { toAsciiDoc } from "./ascii";
import { detachToSnapshot } from "./merge";
import {
  collectAnnotations,
  countNodes,
  emptyDoc,
  type ArchitectDoc,
  type ArchitectMode,
  type SourceKind,
} from "./model";
import {
  addChild,
  collapseAll,
  deleteNode,
  dismissMissing,
  flattenVisible,
  indentNode,
  moveNode,
  outdentNode,
} from "./tree-ops";

export interface ImportDraft {
  sourceKind: SourceKind;
  path: string;
  includeFiles: boolean;
  linkFiles: boolean;
  mode: ArchitectMode;
}

export interface ArchitectHost {
  canPickVault: boolean;
  canPickFs: boolean;
  pickVaultFolder?: () => Promise<string | null>;
  pickFsFolder?: () => Promise<string | null>;
  onOpenLink?: (link: string) => void;
}

export interface ArchitectHandlers {
  onChange: (doc: ArchitectDoc, immediate: boolean) => void;
  onImport: (draft: ImportDraft) => Promise<void> | void;
  onRefresh?: () => Promise<void> | void;
}

export interface BoardOptions {
  chrome: "editor" | "embed";
  comments: "off" | "click";
  namesEditable: boolean;
}

const DEFAULT_BOARD: BoardOptions = {
  chrome: "editor",
  comments: "click",
  namesEditable: true,
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  return createEl(tag, {
    ...(className ? { cls: className } : {}),
    ...(text != null ? { text } : {}),
  });
}

function iconButton(label: string, extraClass = ""): HTMLButtonElement {
  const button = el("button", `fa-btn ${extraClass}`.trim());
  button.type = "button";
  button.textContent = label;
  return button;
}

export function mountArchitect(
  container: HTMLElement,
  initial: ArchitectDoc,
  handlers: ArchitectHandlers,
  host: ArchitectHost,
  board: BoardOptions = DEFAULT_BOARD,
): { update(doc: ArchitectDoc): void; getDoc(): ArchitectDoc; destroy(): void } {
  let doc = initial;
  let selectedId: string | null = null;
  let commentingId: string | null = null;
  let destroyed = false;
  let modalOpen = false;

  const emit = (immediate: boolean) => {
    doc.annotations = collectAnnotations(doc.roots, { ...doc.annotations });
    handlers.onChange(doc, immediate);
  };

  const selectId = (id: string | null) => {
    selectedId = id;
    container.querySelectorAll(".fa-row").forEach((row) => {
      row.classList.toggle("is-selected", (row as HTMLElement).dataset.id === id);
    });
  };

  const isLive = () => doc.mode === "live";
  const structuralLocked = () => isLive();

  const paint = (focusNameId?: string, focusCommentId?: string) => {
    if (destroyed) return;
    container.replaceChildren();
    container.classList.add("arbourist");
    container.classList.toggle("is-embed", board.chrome === "embed");
    container.classList.toggle("is-comments-click", board.comments === "click");
    container.classList.toggle("is-comments-off", board.comments === "off");
    if (board.chrome === "editor") container.appendChild(renderToolbar());
    if (doc.roots.length === 0) container.appendChild(renderEmpty());
    else container.appendChild(renderTable());
    if (board.chrome === "editor") container.appendChild(renderStatus());
    if (focusNameId) {
      const input = container.querySelector<HTMLInputElement>(`.fa-row[data-id="${focusNameId}"] .fa-name`);
      input?.focus?.();
      input?.select?.();
    } else if (focusCommentId) {
      const input = container.querySelector<HTMLInputElement>(`.fa-row[data-id="${focusCommentId}"] .fa-desc`);
      input?.focus?.();
    }
  };

  function renderToolbar(): HTMLElement {
    const bar = el("div", "fa-toolbar");
    const left = el("div", "fa-toolbar-group");
    const right = el("div", "fa-toolbar-group");

    const addFolder = iconButton("+ Folder", "mod-cta");
    addFolder.title = "Add a folder under the selection (or at the root)";
    addFolder.disabled = structuralLocked();
    addFolder.addEventListener("click", () => {
      const created = addChild(doc.roots, selectedParentId(), "folder");
      if (created) {
        selectedId = created.id;
        emit(true);
        paint(created.id);
      }
    });

    const addFile = iconButton("+ File");
    addFile.title = "Add a file under the selection (or at the root)";
    addFile.disabled = structuralLocked();
    addFile.addEventListener("click", () => {
      const created = addChild(doc.roots, selectedParentId(), "file");
      if (created) {
        selectedId = created.id;
        emit(true);
        paint(created.id);
      }
    });

    const importBtn = iconButton("Import folder");
    importBtn.addEventListener("click", () => openImportModal());

    const refreshBtn = iconButton("Refresh");
    refreshBtn.title = "Re-scan the live folder";
    refreshBtn.disabled = !isLive() || !handlers.onRefresh;
    refreshBtn.addEventListener("click", () => {
      void handlers.onRefresh?.();
    });

    const cloneBtn = iconButton("Clone as snapshot");
    cloneBtn.title = "Turn this live view into an editable copy";
    cloneBtn.disabled = !isLive();
    cloneBtn.addEventListener("click", () => {
      doc = detachToSnapshot(doc);
      emit(true);
      paint();
    });

    const copyBtn = iconButton("Copy tree");
    copyBtn.addEventListener("click", () => {
      void (async () => {
        const text = toAsciiDoc(doc);
        try {
          await navigator.clipboard.writeText(text);
          copyBtn.textContent = "Copied";
          window.setTimeout(() => {
            copyBtn.textContent = "Copy tree";
          }, 1200);
        } catch {
          copyBtn.textContent = "Copy failed";
        }
      })();
    });

    const collapseBtn = iconButton("Collapse");
    collapseBtn.addEventListener("click", () => {
      collapseAll(doc.roots, true);
      emit(true);
      paint();
    });
    const expandBtn = iconButton("Expand");
    expandBtn.addEventListener("click", () => {
      collapseAll(doc.roots, false);
      emit(true);
      paint();
    });

    left.append(addFolder, addFile, importBtn, refreshBtn, cloneBtn);
    right.append(collapseBtn, expandBtn, copyBtn);
    bar.append(left, right);
    return bar;
  }

  function selectedParentId(): string | null {
    if (!selectedId) return null;
    const rows = flattenVisible(doc.roots);
    const row = rows.find((item) => item.node.id === selectedId);
    if (!row) return null;
    return row.node.type === "folder" ? row.node.id : row.parent?.id ?? null;
  }

  function renderEmpty(): HTMLElement {
    const box = el("div", "fa-empty");
    box.append(
      el("h3", "", "Design a folder structure"),
      el("p", "fa-muted", "Start blank, or import an existing folder as a snapshot you can rewrite, or as a live view that stays in sync."),
    );
    const actions = el("div", "fa-empty-actions");
    const blank = iconButton("Start blank", "mod-cta");
    blank.addEventListener("click", () => {
      const created = addChild(doc.roots, null, "folder", "library");
      if (created) {
        selectedId = created.id;
        emit(true);
        paint(created.id);
      }
    });
    const snap = iconButton("Import snapshot");
    snap.addEventListener("click", () => openImportModal({ mode: "design" }));
    const live = iconButton("Watch live folder");
    live.addEventListener("click", () => openImportModal({ mode: "live" }));
    actions.append(blank, snap, live);
    box.appendChild(actions);
    return box;
  }

  function renderTable(): HTMLElement {
    const wrap = el("div", "fa-table-wrap");
    const table = el("div", "fa-table");
    for (const row of flattenVisible(doc.roots)) {
      table.appendChild(renderRow(row));
    }
    wrap.appendChild(table);
    return wrap;
  }

  function renderRow(flat: ReturnType<typeof flattenVisible>[number]): HTMLElement {
    const node = flat.node;
    const row = el("div", `fa-row${node.id === selectedId ? " is-selected" : ""}${node.missing ? " is-missing" : ""}${node.description.trim() ? " has-comment" : ""}${commentingId === node.id ? " is-commenting" : ""}`);
    row.dataset.id = node.id;
    row.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      selectId(node.id);
    });

    const nameCol = el("div", "fa-col-name");
    nameCol.appendChild(el("span", "fa-prefix", flat.prefix));

    if (node.type === "folder") {
      const twist = iconButton(node.collapsed ? "▸" : "▾", "fa-twist");
      twist.title = node.collapsed ? "Expand" : "Collapse";
      twist.addEventListener("click", (event) => {
        event.stopPropagation();
        node.collapsed = !node.collapsed;
        emit(true);
        paint();
      });
      nameCol.appendChild(twist);
    }

    if (board.namesEditable) {
      const nameInput = el("input", "fa-name");
      nameInput.value = node.name;
      nameInput.placeholder = node.type === "folder" ? "folder" : "file";
      nameInput.size = Math.max(node.name.length, 4);
      nameInput.disabled = structuralLocked();
      nameInput.addEventListener("input", () => {
        node.name = nameInput.value;
        nameInput.size = Math.max(nameInput.value.length, 4);
        emit(false);
      });
      nameInput.addEventListener("change", () => emit(true));
      nameInput.addEventListener("keydown", (event) => {
        if (event.key === "Tab" && !event.shiftKey && !structuralLocked()) {
          event.preventDefault();
          if (indentNode(doc.roots, node.id)) {
            emit(true);
            paint(node.id);
          }
        } else if (event.key === "Tab" && event.shiftKey && !structuralLocked()) {
          event.preventDefault();
          if (outdentNode(doc.roots, node.id)) {
            emit(true);
            paint(node.id);
          }
        } else if (event.key === "ArrowUp" && event.altKey && !structuralLocked()) {
          event.preventDefault();
          if (moveNode(doc.roots, node.id, "up")) {
            emit(true);
            paint(node.id);
          }
        } else if (event.key === "ArrowDown" && event.altKey && !structuralLocked()) {
          event.preventDefault();
          if (moveNode(doc.roots, node.id, "down")) {
            emit(true);
            paint(node.id);
          }
        } else if (event.key === "Enter" && !structuralLocked()) {
          event.preventDefault();
          const created = addChild(doc.roots, node.type === "folder" ? node.id : selectedParentId(), "folder");
          if (created) {
            selectedId = created.id;
            emit(true);
            paint(created.id);
          }
        }
      });
      nameCol.appendChild(nameInput);
    } else {
      const label = el("span", "fa-name-text", node.name);
      if (node.link && host.onOpenLink) {
        label.classList.add("is-link");
        label.addEventListener("click", (event) => {
          event.stopPropagation();
          host.onOpenLink?.(node.link ?? "");
        });
      }
      nameCol.appendChild(label);
    }
    if (node.type === "folder") nameCol.appendChild(el("span", "fa-slash", "/"));
    if (node.missing) nameCol.appendChild(el("span", "fa-badge", "missing"));

    row.appendChild(nameCol);

    if (board.comments !== "off") {
      const descCol = el("div", "fa-col-desc");
      descCol.appendChild(el("span", "fa-dash", "—"));
      const descInput = el("input", "fa-desc");
      descInput.value = node.description;
      descInput.placeholder = "";
      descInput.addEventListener("click", (event) => {
        event.stopPropagation();
        commentingId = node.id;
        row.classList.add("is-commenting");
      });
      descInput.addEventListener("focus", () => {
        commentingId = node.id;
        row.classList.add("is-commenting");
      });
      descInput.addEventListener("input", () => {
        node.description = descInput.value;
        if (node.relPath) doc.annotations[node.relPath] = node.description;
        row.classList.toggle("has-comment", Boolean(node.description.trim()));
        emit(false);
      });
      descInput.addEventListener("change", () => emit(true));
      descInput.addEventListener("blur", () => {
        if (commentingId === node.id) commentingId = null;
        row.classList.remove("is-commenting");
        emit(true);
      });
      descCol.appendChild(descInput);
      descCol.addEventListener("click", (event) => {
        event.stopPropagation();
        commentingId = node.id;
        descInput.focus();
      });
      row.appendChild(descCol);
    }

    if (board.chrome === "editor" && node.type === "file") {
      const linkCol = el("div", "fa-col-link");
      const linkInput = el("input", "fa-link");
      linkInput.value = node.link ?? "";
      linkInput.placeholder = "[[link]]";
      linkInput.size = Math.max((node.link ?? "").length, 8);
      linkInput.addEventListener("input", () => {
        node.link = linkInput.value.trim() || undefined;
        linkInput.size = Math.max(linkInput.value.length, 8);
        emit(false);
      });
      linkInput.addEventListener("change", () => emit(true));
      linkCol.appendChild(linkInput);
      if (node.link && host.onOpenLink) {
        const open = iconButton("Open", "fa-tiny");
        open.addEventListener("click", (event) => {
          event.stopPropagation();
          host.onOpenLink?.(node.link ?? "");
        });
        linkCol.appendChild(open);
      }
      row.appendChild(linkCol);
    }

    if (board.chrome === "editor") {
      const actions = el("div", "fa-col-actions");
      const up = iconButton("↑", "fa-tiny");
      up.title = "Move up (Alt+Up)";
      up.disabled = structuralLocked();
      up.addEventListener("click", (event) => {
        event.stopPropagation();
        if (moveNode(doc.roots, node.id, "up")) {
          emit(true);
          paint(node.id);
        }
      });
      const down = iconButton("↓", "fa-tiny");
      down.title = "Move down (Alt+Down)";
      down.disabled = structuralLocked();
      down.addEventListener("click", (event) => {
        event.stopPropagation();
        if (moveNode(doc.roots, node.id, "down")) {
          emit(true);
          paint(node.id);
        }
      });
      const del = iconButton("Delete", "fa-tiny fa-danger");
      del.disabled = structuralLocked() && !node.missing;
      del.addEventListener("click", (event) => {
        event.stopPropagation();
        if (deleteNode(doc.roots, node.id)) {
          if (selectedId === node.id) selectedId = null;
          emit(true);
          paint();
        }
      });
      actions.append(up, down, del);
      row.appendChild(actions);
    }

    return row;
  }

  function renderStatus(): HTMLElement {
    const counts = countNodes(doc.roots);
    const bar = el("div", "fa-status");
    const mode = isLive() ? "Live view" : "Snapshot / design";
    const source = doc.sourcePath ? ` · ${doc.sourcePath}` : "";
    const files = doc.includeFiles ? `${counts.files} files` : "folders only";
    bar.appendChild(el("span", "", `${mode}${source}`));
    bar.appendChild(el("span", "fa-muted", `${counts.folders} folders · ${files}`));
    if (isLive() && doc.roots.some((node) => node.children.some((child) => child.missing || child.name === "_missing"))) {
      const dismiss = iconButton("Dismiss missing", "fa-tiny");
      dismiss.addEventListener("click", () => {
        dismissMissing(doc.roots);
        emit(true);
        paint();
      });
      bar.appendChild(dismiss);
    }
    return bar;
  }

  function openImportModal(preset?: Partial<ImportDraft>) {
    if (modalOpen) return;
    modalOpen = true;
    const draft: ImportDraft = {
      sourceKind: host.canPickVault ? "vault" : "fs",
      path: doc.sourcePath ?? "",
      includeFiles: doc.includeFiles,
      linkFiles: doc.linkFiles,
      mode: "design",
      ...preset,
    };

    const overlay = el("div", "fa-modal-overlay");
    const modal = el("div", "fa-modal");
    modal.appendChild(el("h3", "", "Import folder"));
    modal.appendChild(
      el(
        "p",
        "fa-muted",
        "Snapshot is a copy you can redesign even if those files later disappear. Live view re-reads the folder when you open or refresh.",
      ),
    );

    const sourceRow = el("div", "fa-field");
    sourceRow.appendChild(el("label", "", "Source"));
    const sourceBtns = el("div", "fa-seg");
    const vaultBtn = iconButton("Vault folder");
    vaultBtn.disabled = !host.canPickVault;
    const fsBtn = iconButton("Computer folder");
    fsBtn.disabled = !host.canPickFs;
    const syncSeg = () => {
      vaultBtn.classList.toggle("is-active", draft.sourceKind === "vault");
      fsBtn.classList.toggle("is-active", draft.sourceKind === "fs");
      if (draft.sourceKind !== "vault") draft.linkFiles = false;
      linkCheck.disabled = draft.sourceKind !== "vault";
    };
    vaultBtn.addEventListener("click", () => {
      draft.sourceKind = "vault";
      syncSeg();
    });
    fsBtn.addEventListener("click", () => {
      draft.sourceKind = "fs";
      draft.linkFiles = false;
      syncSeg();
    });
    sourceBtns.append(vaultBtn, fsBtn);
    sourceRow.appendChild(sourceBtns);

    const pathRow = el("div", "fa-field");
    pathRow.appendChild(el("label", "", "Path"));
    const pathWrap = el("div", "fa-path-wrap");
    const pathInput = el("input", "fa-path");
    pathInput.value = draft.path;
    pathInput.placeholder = draft.sourceKind === "vault" ? "folder/inside/vault" : "/path/to/folder";
    pathInput.addEventListener("input", () => {
      draft.path = pathInput.value;
    });
    const browse = iconButton("Browse");
    browse.addEventListener("click", () => {
      void (async () => {
        const picked =
          draft.sourceKind === "vault" ? await host.pickVaultFolder?.() : await host.pickFsFolder?.();
        if (picked) {
          draft.path = picked;
          pathInput.value = picked;
        }
      })();
    });
    pathWrap.append(pathInput, browse);
    pathRow.appendChild(pathWrap);

    const includeRow = el("div", "fa-field");
    includeRow.appendChild(el("label", "", "Include"));
    const includeSeg = el("div", "fa-seg");
    const foldersOnly = iconButton("Folders only");
    const withFiles = iconButton("Folders and files");
    const syncInclude = () => {
      foldersOnly.classList.toggle("is-active", !draft.includeFiles);
      withFiles.classList.toggle("is-active", draft.includeFiles);
    };
    foldersOnly.addEventListener("click", () => {
      draft.includeFiles = false;
      syncInclude();
    });
    withFiles.addEventListener("click", () => {
      draft.includeFiles = true;
      syncInclude();
    });
    includeSeg.append(foldersOnly, withFiles);
    includeRow.appendChild(includeSeg);

    const linkRow = el("div", "fa-field");
    const linkLabel = el("label", "fa-check");
    const linkCheck = el("input");
    linkCheck.type = "checkbox";
    linkCheck.checked = draft.linkFiles;
    linkCheck.addEventListener("change", () => {
      draft.linkFiles = linkCheck.checked;
    });
    linkLabel.append(linkCheck, createEl("span", { text: " Create wikilinks for files (vault only, optional)" }));
    linkRow.appendChild(linkLabel);

    const modeRow = el("div", "fa-field");
    modeRow.appendChild(el("label", "", "Kind"));
    const modeSeg = el("div", "fa-seg");
    const snapBtn = iconButton("Snapshot");
    const liveBtn = iconButton("Live view");
    const syncMode = () => {
      snapBtn.classList.toggle("is-active", draft.mode === "design");
      liveBtn.classList.toggle("is-active", draft.mode === "live");
    };
    snapBtn.addEventListener("click", () => {
      draft.mode = "design";
      syncMode();
    });
    liveBtn.addEventListener("click", () => {
      draft.mode = "live";
      syncMode();
    });
    modeSeg.append(snapBtn, liveBtn);
    modeRow.appendChild(modeSeg);
    modeRow.appendChild(
      el("p", "fa-hint", "Snapshot: editable copy. Live: names come from disk; descriptions stay with each path."),
    );

    const footer = el("div", "fa-modal-footer");
    const cancel = iconButton("Cancel");
    const ok = iconButton("Import", "mod-cta");
    const close = () => {
      overlay.remove();
      modalOpen = false;
    };
    cancel.addEventListener("click", close);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close();
    });
    ok.addEventListener("click", () => {
      void (async () => {
        draft.path = pathInput.value.trim();
        if (!draft.path) {
          pathInput.focus();
          return;
        }
        ok.disabled = true;
        try {
          await handlers.onImport(draft);
          close();
        } catch (error) {
          ok.disabled = false;
          const message = error instanceof Error ? error.message : String(error);
          notice.textContent = message;
        }
      })();
    });
    footer.append(cancel, ok);

    const notice = el("p", "fa-error", "");
    modal.append(sourceRow, pathRow, includeRow, linkRow, modeRow, notice, footer);
    overlay.appendChild(modal);
    container.appendChild(overlay);
    syncSeg();
    syncInclude();
    syncMode();
    pathInput.focus();
  }

  paint();

  return {
    update(next: ArchitectDoc) {
      doc = next;
      paint();
    },
    getDoc() {
      return doc;
    },
    destroy() {
      destroyed = true;
      container.replaceChildren();
    },
  };
}

export function createBlankBoard(): ArchitectDoc {
  return emptyDoc();
}
