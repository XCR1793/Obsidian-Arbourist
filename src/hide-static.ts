const STORE_CLASS = "fa-static-store";
const LANG = "arbourist-static";
const LANG_BLOCK = `block-language-${LANG}`;
const LANG_CODE = `language-${LANG}`;

function markHidden(node: HTMLElement): void {
  node.classList.add(STORE_CLASS);
  node.hidden = true;
}

export function hideStaticStoreElement(el: HTMLElement): void {
  const nodes = new Set<HTMLElement>([el]);
  const pre = el.closest("pre");
  if (pre) nodes.add(pre);
  const wrap = el.closest(`.el-pre, .cm-preview-code-block, .${LANG_BLOCK}`);
  if (wrap instanceof HTMLElement) nodes.add(wrap);
  let parent = el.parentElement;
  for (let i = 0; i < 5 && parent; i += 1) {
    if (
      parent.tagName === "PRE" ||
      parent.classList.contains("el-pre") ||
      parent.classList.contains("cm-preview-code-block") ||
      parent.classList.contains(LANG_BLOCK)
    ) {
      nodes.add(parent);
    }
    parent = parent.parentElement;
  }
  for (const node of nodes) markHidden(node);
}

function looksLikeStore(el: Element): boolean {
  const classBlob = `${el.className} ${el.querySelector("code")?.className ?? ""}`;
  if (classBlob.includes(LANG) || el.classList.contains(LANG_BLOCK)) return true;
  if (el.querySelector(`code.${LANG_CODE}, .${LANG_BLOCK}`)) return true;
  if (/\b(HyperMD-codeblock|cm-hmd-codeblock)\b/.test(el.className) && (el.textContent ?? "").includes(LANG)) {
    return true;
  }
  return false;
}

function hideStoreChunk(start: Element): void {
  if (/\b(HyperMD-codeblock|cm-hmd-codeblock)\b/.test(start.className)) {
    let cur: Element | null = start;
    while (cur && /\b(HyperMD-codeblock|cm-hmd-codeblock)\b/.test(cur.className)) {
      markHidden(cur as HTMLElement);
      cur = cur.nextElementSibling;
    }
    return;
  }
  hideStaticStoreElement(start as HTMLElement);
}

export function hideFollowingBake(el: HTMLElement): void {
  let node: HTMLElement | null = el;
  for (let depth = 0; depth < 12 && node && node !== document.body; depth += 1) {
    let sib: Element | null = node.nextElementSibling;
    for (let i = 0; i < 8 && sib; i += 1) {
      if (looksLikeStore(sib)) {
        hideStoreChunk(sib);
        return;
      }
      sib = sib.nextElementSibling;
    }
    node = node.parentElement;
  }
}

export function hideBakedStoresIn(root: ParentNode): void {
  const rendered = root.querySelectorAll(`code.${LANG_CODE}, .${LANG_BLOCK}`);
  for (const node of Array.from(rendered)) {
    hideStaticStoreElement(node as HTMLElement);
  }
  const lines = root.querySelectorAll(".HyperMD-codeblock, .cm-hmd-codeblock");
  for (const line of Array.from(lines)) {
    if ((line.textContent ?? "").includes(LANG) && !line.classList.contains(STORE_CLASS)) {
      hideStoreChunk(line);
    }
  }
}
