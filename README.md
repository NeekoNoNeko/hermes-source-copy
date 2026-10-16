# Hermes Source Copy

[English](README.md) | [简体中文](README.zh-CN.md)

Select text in a Hermes Desktop chat and press **Ctrl+C** (**Cmd+C** on macOS) to copy its original Markdown and LaTeX. The plugin preserves original syntax and opens a source window when it cannot identify a selection accurately.

An independent community **Desktop-only** plugin, using the [official ESM SDK](https://hermes-agent.nousresearch.com/docs/developer-guide/desktop-plugin-sdk). Compatibility baseline: official Hermes Desktop commit `ac28abc96c`. No client modification, model calls, or backend plugin are required. The plugin interface currently uses Chinese labels; the English and Chinese documentation cover the same features.

## Install from Git (recommended)

1. Open **Capabilities → Plugins → Install from Git** in Hermes Desktop.
2. Enter `NeekoNoNeko/hermes-source-copy` or `https://github.com/NeekoNoNeko/hermes-source-copy`.
3. Select the **Desktop** component and confirm installation. Enable **原始 Markdown / LaTeX 复制** if necessary.

The repository includes a **prebuilt root `plugin.js`**, which the official installer detects as a standalone Desktop plugin. Git installation needs Git, but no Node.js, npm build, Python, or API key. There is no Agent plugin manifest. This is a Git-installable community repository; it does not claim inclusion in the official catalog. See the [official Git installation guide](https://hermes-agent.nousresearch.com/docs/user-guide/features/plugins).

**v1.0.8:** also maps standalone file `MEDIA:` directives to verified file cards, including scripts, documents and extensionless files. Surrounding text, a selected card and whole replies retain original source. Card selections copy the complete original directive, not a reconstructed Markdown link; copying never opens or runs the file.

**v1.0.7:** recognizes standalone image `MEDIA:` directives and image-delivery `#media:` links across loading, loaded and failed image states. Surrounding prose, lists and code can copy without the image blocking the reply. An image selected without proof of its original path still opens the source window; its filename or data URL is never treated as path proof.

**v1.0.6:** selections contained in one table cell now copy only the selected original content, completing necessary inline markup and whole formulas. Crossing cells or leaving a cell for surrounding prose still includes the complete touched table.

**v1.0.5:** fixes cold-copy loading and a stale in-flight read that could block refresh after a message completed. Temporary loading keeps the selection and shows a non-modal “not copied yet” notice; when ready, press Ctrl+C again. The plugin never asynchronously writes a delayed copy. Pointer-down prefetch starts earlier, and selection warmup no longer repeats full message matching. Actual failures still open the source window.

**v1.0.4:** fixes an extra list number when copying a phrase inside an ordered item. Partial single-item selections copy only the selected source with necessary inline formatting; complete items and selections spanning sibling items retain the original numbers. Literal numbers in selected prose are never stripped.

**v1.0.3:** restores copying of older replies retained after compaction by reading the stored display transcript. Delivered `#media:` file cards map to their complete original links, so a file card no longer prevents matching surrounding text or tables. The plugin installation/update command and right-click adapter have been removed; native right-click behavior is restored. Ctrl+C/Cmd+C source copying and the source window remain available.

## Updates

For this standalone Desktop plugin, the baseline SDK has **no automatic-update API**. The Agent/catalog update mechanism applies to Agent packages, not this Desktop-only repository. File hot reload loads changes already on disk; it does not pull GitHub updates.

Update through **Capabilities → Plugins → Install from Git**, using the same repository and enabling force reinstall for the Desktop component. The plugin contributes no install/update command and performs no automatic update.

## Copy rules and limits

- Plain text retains source characters, escapes, and internal whitespace and line breaks.
- Selecting `文字` inside `__一段文字__` produces `__文字__`. Partial bold, italic, strikethrough, links, and inline code use the original markers to complete the fragment.
- Touching any part of a formula copies the **entire original formula**, preserving `$...$`, `$$...$$`, `\(...\)`, or `\[...\]`.
- This includes exact literal formula runs and `.katex-error` spans. Chinese is not inherently invalid LaTeX: the baseline escapes CJK inline math as prose, while valid Chinese display math can render normally. Clipboard output always comes from the original formula.
- Complete ordered items and selections across sibling items retain their original number markers. A phrase inside a single ordered item does not gain a number, even when it starts at the first word. Quotes, unordered lists, headings, and code blocks retain their original markers. Selections contained in one table cell copy only the selected original content. Crossing cells or extending outside a cell copies the **entire original table**.
- Standalone file `MEDIA:` lines map to file cards using the complete target, verified basename and body order. Selecting a card copies its complete original `MEDIA:` line with original quotes and spacing. Known media links still copy their original Markdown. No file action runs during copying.
- Standalone `MEDIA:` image lines and image-delivery `#media:` links are matched in body order, without reading their files. Non-image selections can copy around them. If the selection touches an image, its display URL must exactly prove the original target; otherwise use the source window, including for whole-reply selections spanning that image. Ordinary Markdown images, other media and unsupported delivery syntax may still need the source window.
- Selections across messages in the same chat join in display order using two newlines, without role labels.
- Clipboard output is only `text/plain`; rich-text data cannot override the source.
- Inputs, terminals, settings, reasoning sections, and empty selections keep normal copying.

Syntax completion, whole-formula expansion and cross-cell table expansion extend some selections. Content and added markers come from the original source; a result may combine several source slices.

When source is still loading, copying is blocked with a non-modal notice that explicitly says nothing has been copied. The selection stays in place; press Ctrl+C again after the ready notice. Moving focus, clicking, copying elsewhere, changing sessions, pausing or unloading suppresses late notices/windows. Clipboard writes occur only during the new copy event, never after the background read.

Failed source reads, streaming messages, cross-chat selections, ambiguous repeated messages, and unsupported DOM structures block copying and open a **source window**. Choose a message, select its source, and copy normally, or use select-all/copy-whole-message buttons. Automatic copying failure leaves the previous clipboard unchanged.

HTML, inline images/audio/video, footnotes, unsupported special cards, and some complex code/media layouts may require the source window. Messages over 200,000 UTF-16 characters use this window; parsed source is limited to 1,000,000 characters per session read. Source means the focused session’s stored display transcript plus its qualified `session.history` tail. Stored reads include compacted/ancestor replies and are bounded to 20 pages of 500 raw rows or 1,000,000 body characters. A bridge-less client falls back to RPC; omitted or unread data requires the source window. DOM adaptation is centralized in `src/dom-adapter.js`; client upgrades may need adaptation.

Command palette:

- **源码复制：开启 / 暂停** — enable/pause interception. Pausing clears messages and restores normal copying.
- **源码复制：查看当前聊天原文** — explicitly open the source window, even while interception is paused.

Selecting part of a supported delivered file card copies its entire original Markdown link, including label and encoded destination. Identity requires the exact target, verified filename, card structure and message order; a basename alone is insufficient. No file is opened or downloaded during copying.

## Privacy and security

When enabled, the plugin reads the focused session's visible user/assistant bodies through `host.requestProfile(..., 'session.history', ...)` and the client's `window.hermesDesktop.api` bridge. The bridge is used only for `GET /api/sessions/<stored-id>/messages`, with explicit connection, profile and stored session, `include_compacted=true` and `inline_images=false`. Remote transport uses the existing Hermes connection; the plugin does not read credentials or make direct network requests.

Only the current session is cached in window memory. Session/profile/connection changes, pause, disable, unload, and hot reload clear the cache and reject stale pending replies. Body text is neither persisted nor logged. Reasoning, tool payloads, and backend metadata are not retained. Only the enabled/paused preference is persisted in plugin storage. No analytics, third-party uploads, direct network requests, or clipboard reads are implemented. Source is inserted using DOM text properties, never executed as HTML. Gateway error details are masked.

Hermes Desktop plugins have host privileges and **are not sandboxed**. This review does not guarantee the absence of every vulnerability. See [SECURITY.md](SECURITY.md) for scope and remaining limits. OS clipboard managers and paste destinations may retain explicitly copied text.

## Manual installation and removal

Clone this repository or extract the complete release ZIP. From that folder on Windows:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1
```

The script uses `HERMES_HOME`, otherwise an existing `%LOCALAPPDATA%\hermes\desktop-plugins`, otherwise `%USERPROFILE%\.hermes`. Custom home:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1 -HermesHome 'D:\HermesData'
```

It verifies bundle SHA256, rejects reparse points in source/target paths and nested target entries, and backs up previous installations under `<HermesHome>\desktop-plugin-backups`. SHA256 verifies consistency, not publisher authenticity. Prevent concurrent path changes while running scripts. Scripts do not modify chat records or other plugins.

On macOS/Linux, copy `dist/hermes-source-copy` into your Hermes Desktop plugin directory (`$HERMES_HOME/desktop-plugins/` or usually `~/.hermes/desktop-plugins/`), or use Git installation. PowerShell scripts target Windows only.

Uninstall through Hermes plugin management or:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\uninstall.ps1
```

Use the same `-HermesHome` if appropriate. Only `desktop-plugins/hermes-source-copy` is removed; backups and chat data are retained. Use **Reload desktop plugins** in the command palette if needed.

## Development and verification

Requires Node.js 22 or newer:

```sh
npm ci
npm run check
npm audit --registry=https://registry.npmjs.org
npm run package  # Windows only
```

Build produces identical root `plugin.js` and `dist/hermes-source-copy/plugin.js`, hashes, build metadata, and dependency licenses. Only `@hermes/plugin-sdk` is imported at runtime; parser dependencies are bundled. Commit rebuilt entries when changing source. ZIPs and SHA256 files are generated in `artifacts/` and excluded from Git.

Tests use real remark/KaTeX DOM to compare source character by character, and cover repeated content, nested formats, four math delimiters, reverse/cross-message selection, streaming, routing, stale replies, cleanup, source-window injection, bundle loading, and Windows installation/backup/uninstallation with link rejection. See [VERIFICATION.md](VERIFICATION.md) for actual results and limits.

v1.0.1 was also checked against visible messages in a running baseline Hermes window using synthetic copy events, including a previously failing math answer and a merged later text part. Native clipboard writing of the resulting formula was compared character for character through the SDK. Physical Ctrl+C/Cmd+C events, a real remote gateway, and other platforms still need manual acceptance tests. After installation, copy bold text, all four math delimiters, repeated paragraphs, and a table into a plain-text editor. Check input/terminal copying too, and repeat after upgrading Hermes.

v1.0.3 adds compaction/archive pagination, old/new/cross-reply copying, file-card identity checks, and removal regressions. The supplied table/file-card passage passes seven exact comparisons through the local upstream renderer and actual table/card components, with action/store dependencies isolated. The private excerpt is excluded from publication. Physical keyboard and final OS paste acceptance remain unverified in this release. Historical v1.0.1/v1.0.2 results are retained in VERIFICATION.md.

MIT licensed. Bundled licenses: [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt).
