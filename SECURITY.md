# Security and privacy review / 安全与隐私审查

Review date: 2026-10-07. Hermes source baseline: `ac28abc96c`.

## Findings and changes

Reviewed first-party runtime source, build/package/install/uninstall scripts, the generated ESM bundle, dependency advisories, and files intended for public Git publication.

- v1.0.2 aligns literal/error math only against complete ordered source projections. Error tooltips are never trusted as LaTeX. Ambiguous literal/formula candidates still fail closed; clipboard output is sliced from the original source.
- Original right-click Copy interception is restricted to the newly opened baseline menu for a chat-body selection. Its transient range is discarded on dismissal, outside clicks, scope changes, pause and unload. Detached or changed bodies are revalidated; link/image actions and unrelated menus are not retargeted. The clipboard write is initiated at menu activation with already available source, not after an asynchronous history request.
- The update palette command opens a fixed, documented `hermes://plugin/install?...&force=1` URL through `ctx.os.openExternal`. Hermes presents its own confirmation. There is no update polling, arbitrary repository input, remote-code loader, or silent self-replacement.

- No implemented analytics, third-party upload, direct runtime network requests, clipboard reads, shell execution, or dynamic code execution. The runtime data request is the connection/profile-qualified `session.history` RPC to the user's existing Hermes gateway.
- Source UI uses `textContent`/`textarea.value`; message HTML and link destinations are not executed or fetched. Regression tests verify literal display of malicious HTML and masking of gateway errors.
- Tightened retention to body/role/timestamp/model fields and a current-session cache. Focus/owner changes, pause, and unload clear it and reject stale pending replies. Paused interception skips automatic history reads; explicit source-view requests remain available.
- Parsing limits: 200,000 characters per message and 1,000,000 per session read. Ordered matching avoids repeated scans of candidate sets. Unsupported mappings open the source window.
- Windows scripts reject reparse points in ancestors and nested plugin entries. Tests verify refusing a nested junction without modifying its external target. Uninstall checks the exact plugin path. Update backups remain on disk and can contain the previous plugin package.
- `npm audit --registry=https://registry.npmjs.org` reported **0 known vulnerabilities**, including development dependencies, on the review date. The configured mirror lacked audit support; the official registry was used explicitly.
- Publication excludes local caches, chat data, credentials, logs, node_modules, and release staging. Runtime imports are limited to the SDK. Dependency versions/integrity are locked and bundled licenses included.
- v1.0.1 re-audit found a KaTeX advisory that the earlier audit response did not report. Updated KaTeX to the patched 0.18.2-or-later line and overrode transitive copies; all regression tests and the official-registry audit pass. See [GHSA-238p-pmpm-9mq7](https://github.com/advisories/GHSA-238p-pmpm-9mq7). KaTeX rendering code is not in this plugin's runtime bundle; Hermes renders formulas itself. This does not modify or audit the client's own KaTeX version.
- Live troubleshooting used temporary loopback-only diagnostics containing counts, lengths, and result categories, never message bodies. The server was closed and instrumentation removed; none is in the repository or release. The supplied user example stayed in an ignored local cache. Public renderer regression fixtures contain synthetic text only.

No unresolved security/privacy issue was found within this scope. This is code review and automated regression checking, **not a penetration test or a guarantee of no vulnerabilities**.

## Boundaries and reporting

Hermes plugins have host privileges and are not sandboxed. Modified plugins can access the host. SHA256 checks consistency, not authenticity; obtain the intended repository and review changes before updating.

Hermes owns remote transport, authentication, and response filtering; these are outside this review. A history response includes the focused session's visible transcript, not only selected text. Clearing references does not guarantee physical memory zeroization. The source window is accessible within the existing desktop session.

Install/uninstall is not race-proof against concurrent path modification. Use trusted directories, prevent concurrent changes, and avoid unnecessary elevation. Git installation uses Hermes's own installer.

The regression suite does not fully validate live client UI, physical keyboard events, remote gateways, or platform integrations. A focused v1.0.1 local check additionally used synthetic copy events in the running client and verified one SDK clipboard write. OS clipboard managers and paste destinations may retain copied message content.

Report vulnerabilities privately through GitHub **Security → Report a vulnerability** for this repository. If unavailable, open an issue asking for a private reporting channel without sensitive content or exploit details. Never attach real transcripts, credentials, or connection secrets.

## 中文摘要

审查了运行时源码、构建及安装/卸载脚本、生产 ESM 包、依赖漏洞报告和拟公开文件，在该范围内未发现未解决的安全或隐私问题。修复了暂停/切换时的缓存保留、过量元数据保留、网关错误详情展示和安装路径链接风险，补充了回归测试。官方 npm registry 审计报告为 0 个已知漏洞（含开发依赖）。

v1.0.2 只按完整正文及显示顺序核对错误/文本公式，不把错误提示当作源码；仍拒绝歧义匹配。右键适配仅处理刚打开的聊天选区菜单，关闭、切换、暂停和卸载时丢弃临时选区，复制前重新核对正文；不改变链接/图片和其他区域的菜单。更新命令只打开固定仓库的官方确认窗口，不轮询、不静默安装、不加载远程代码。

这不是无漏洞保证。Hermes 插件没有沙箱；连接和鉴权由 Hermes 管理。接口返回当前会话可见正文；释放缓存引用不保证物理内存清零。安装脚本不能防御其他程序同时篡改路径。v1.0.1 补充了本机窗口合成复制事件及一次 SDK 系统剪贴板验证，但不等同于全场景验收；物理键盘事件、远程网关和其他平台尚未验证。再次审计后同步更新 KaTeX 及传递依赖，审计为 0 个已知漏洞；不修改客户端自身的 KaTeX。临时诊断代码与用户样例不公开发布。请通过私密漏洞报告渠道反馈，勿公开聊天内容或密钥；渠道不可用时，仅发 issue 询问私密渠道。
