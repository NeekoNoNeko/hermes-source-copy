# Hermes Source Copy

[English](README.md) | [简体中文](README.zh-CN.md)

Select text in a Hermes Desktop chat and press **Ctrl+C** (**Cmd+C** on macOS), or choose the original right-click menu's **Copy**, to copy its original Markdown and LaTeX. The plugin preserves original syntax and opens a source window when it cannot identify a selection accurately.

An independent community **Desktop-only** plugin, using the [official ESM SDK](https://hermes-agent.nousresearch.com/docs/developer-guide/desktop-plugin-sdk). Compatibility baseline: official Hermes Desktop commit `ac28abc96c`. No client modification, model calls, or backend plugin are required. The plugin interface currently uses Chinese labels; the English and Chinese documentation cover the same features.

## Install from Git (recommended)

1. Open **Capabilities → Plugins → Install from Git** in Hermes Desktop.
2. Enter `NeekoNoNeko/hermes-source-copy` or `https://github.com/NeekoNoNeko/hermes-source-copy`.
3. Select the **Desktop** component and confirm installation. Enable **原始 Markdown / LaTeX 复制** if necessary.

Alternatively: [Install in Hermes](hermes://plugin/install?repo=NeekoNoNeko/hermes-source-copy). If your browser cannot open this link, use the dialog above.

The repository includes a **prebuilt root `plugin.js`**, which the official installer detects as a standalone Desktop plugin. Git installation needs Git, but no Node.js, npm build, Python, or API key. There is no Agent plugin manifest. This is a Git-installable community repository; it does not claim inclusion in the official catalog. See the [official Git installation guide](https://hermes-agent.nousresearch.com/docs/user-guide/features/plugins).

**v1.0.2:** supports formulas displayed literally after CJK preprocessing and KaTeX error spans. A failed formula no longer prevents matching the rest of an otherwise supported message. Right-click **Copy** uses the same source mapping as Ctrl+C, including selection snapshots retained across menu focus changes. Matching still requires exact source and provable display order; unresolved duplicates use the source window.

## Updates

For this standalone Desktop plugin, the baseline SDK has **no automatic-update API**. The Agent/catalog update mechanism applies to Agent packages, not this Desktop-only repository. File hot reload loads changes already on disk; it does not pull GitHub updates.

Use [Update in Hermes](hermes://plugin/install?repo=NeekoNoNeko/hermes-source-copy&force=1), or (after installing v1.0.2) the command **源码复制：更新插件（官方安装窗口）**. Both open Hermes's official install confirmation with the repository filled in and force reinstall selected. Confirm the Desktop component to update. This uses the [documented `force=1` install link](https://hermes-agent.nousresearch.com/docs/developer-guide/desktop-plugin-sdk#distributing-with-an-install-link); it never silently downloads or executes an update. Alternatively, use the existing Install from Git dialog and enable force reinstall.

## Copy rules and limits

- Plain text retains source characters, escapes, and internal whitespace and line breaks.
- Selecting `文字` inside `__一段文字__` produces `__文字__`. Partial bold, italic, strikethrough, links, and inline code use the original markers to complete the fragment.
- Touching any part of a formula copies the **entire original formula**, preserving `$...$`, `$$...$$`, `\(...\)`, or `\[...\]`.
- This includes exact literal formula runs and `.katex-error` spans. Chinese is not inherently invalid LaTeX: the baseline escapes CJK inline math as prose, while valid Chinese display math can render normally. Clipboard output always comes from the original formula.
- Lists, quotes, headings, and code blocks retain their original markers. Selecting table cells copies the **entire original table**.
- Selections across messages in the same chat join in display order using two newlines, without role labels.
- Clipboard output is only `text/plain`; rich-text data cannot override the source.
- Inputs, terminals, settings, reasoning sections, and empty selections keep normal copying.

Syntax completion and whole-formula/table expansion extend some selections. Content and added markers come from the original source; a result may combine several source slices.

Unavailable source, streaming messages, cross-chat selections, ambiguous repeated messages, and unsupported DOM structures block copying and open a **source window**. Choose a message, select its source, and copy normally, or use select-all/copy-whole-message buttons. Automatic copying failure leaves the previous clipboard unchanged.

HTML, images/attachments, footnotes, special cards, and some complex code/media layouts may require the source window. Messages over 200,000 UTF-16 characters use this window; parsed source is limited to 1,000,000 characters per session read. Source means visible message bodies returned by `session.history`; omitted API data cannot be recovered. DOM adaptation is centralized in `src/dom-adapter.js`; client upgrades may need adaptation.

Command palette:

- **源码复制：开启 / 暂停** — enable/pause interception. Pausing clears messages and restores normal copying.
- **源码复制：查看当前聊天原文** — explicitly open the source window, even while interception is paused.
- **源码复制：更新插件（官方安装窗口）** — open the prefilled official update confirmation.

The original right-click menu adapter targets the baseline's selection **Copy** item, identified by its DOM structure, copy icon and localized label (English and Chinese are tested). Link/image actions remain available. A source range stays in memory only while that menu is open and is revalidated before copying. DOM adapters are centralized; other client versions or unknown menu labels may require adaptation.

## Privacy and security

When enabled, the plugin reads the focused session's visible user/assistant bodies through `host.requestProfile(..., 'session.history', ...)`, explicitly qualified by connection, profile, and session. Remote requests use your existing Hermes connection to its configured gateway.

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

v1.0.2 passes 81 Windows tests and the supplied failing passage against the actual upstream renderer. The real Hermes context menu was exercised with synthetic source and event gestures; source handed to the SDK matched exactly and the menu closed. Native clipboard readback did not pass in this run (Windows access failure; client readback did not match), so final OS paste behavior remains an acceptance check. Details are recorded in VERIFICATION.md.

MIT licensed. Bundled licenses: [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt).
