# Arbourist

Design folder structures inside an Obsidian note. Import a real folder, comment on each row, keep it live, or bake a static tree.

## Install

Community listing is not submitted yet. Until then, install it by hand:

1. Build with `npm install` then `npm run build`, or download a GitHub release.
2. Copy `main.js`, `manifest.json`, and `styles.css` into:

   `.obsidian/plugins/arbourist/`

3. Enable **Arbourist** under Settings → Community plugins.

## Embed a folder in a note

Type a vault path after `![[`, then comma options:

```markdown
![[/Projects/My Library, display:live, comments:disable]]
```

Command **Insert folder embed** inserts one of these for a folder you pick.

| Option | Values | Default |
|---|---|---|
| `display` | `live`, `static` | `live` |
| `refresh` | flag (`refresh`) | off |
| `comments` | `enable`, `disable` | `disable` |
| `files` | `on`, `off` | `on` |
| `links` | `on`, `off` | `off` |
| `filter` | text | none |
| `ext` | `m`, `md`, … | none |
| `depth` | number | 20 |

**Live** re-reads the folder when you open the note or click Refresh. Names stay in sync with disk. Comments stick to each path.

**Static** pulls once and bakes the tree. The `![[...]]` line stays in the note so you can edit it later; while reading you see the baked tree. Add `refresh` on that line to pull again. Arbourist then drops `refresh` so it will not keep scanning:

```markdown
![[/Projects/My Library, display:static, files:off, refresh]]
```

**Comments:** with `comments:disable` you only see the tree. With `comments:enable`, hover a line and click after the name to type a note.

## Blueprints

A blueprint is a note you can rearrange before anything exists on disk.

- Ribbon or command **New blueprint** — empty unsaved tree. **Save** chooses a folder and file name; the button disappears once the note exists.
- **Import folder into a new blueprint** — snapshot (editable copy) or live view.
- Snapshot can include folders only, or every file. Wikilinks are optional and only for files that already live in the vault.

Blueprints are stored as an `arbourist` code block in the note. Open the note in Arbourist to edit the tree with buttons. That note **is** the save — there is no separate database.

Include a blueprint in another note (live: edits to the blueprint update every include):

```markdown
![[Blueprints/Untitled blueprint, display:live, comments:enable]]
```

Command **Insert blueprint embed** inserts that line for a blueprint you pick.

## Settings

- Blueprints folder
- Import files by default
- Create wikilinks by default
- Max import depth
