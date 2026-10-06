# Security and privacy review / 安全与隐私审查

Review date: 2026-10-06. Hermes source baseline: `ac28abc96c`.

## Findings and changes

Reviewed first-party runtime source, build/package/install/uninstall scripts, the generated ESM bundle, dependency advisories, and files intended for public Git publication.

- No implemented analytics, third-party upload, direct runtime network requests, clipboard reads, shell execution, or dynamic code execution. The runtime data request is the connection/profile-qualified `session.history` RPC to the user's existing Hermes gateway.
- Source UI uses `textContent`/`textarea.value`; message HTML and link destinations are not executed or fetched. Regression tests verify literal display of malicious HTML and masking of gateway errors.
- Tightened retention to body/role/timestamp/model fields and a current-session cache. Focus/owner changes, pause, and unload clear it and reject stale pending replies. Paused interception skips automatic history reads; explicit source-view requests remain available.
- Parsing limits: 200,000 characters per message and 1,000,000 per session read. Ordered matching avoids repeated scans of candidate sets. Unsupported mappings open the source window.
- Windows scripts reject reparse points in ancestors and nested plugin entries. Tests verify refusing a nested junction without modifying its external target. Uninstall checks the exact plugin path. Update backups remain on disk and can contain the previous plugin package.
- `npm audit --registry=https://registry.npmjs.org` reported **0 known vulnerabilities**, including development dependencies, on the review date. The configured mirror lacked audit support; the official registry was used explicitly.
- Publication excludes local caches, chat data, credentials, logs, node_modules, and release staging. Runtime imports are limited to the SDK. Dependency versions/integrity are locked and bundled licenses included.

No unresolved security/privacy issue was found within this scope. This is code review and automated regression checking, **not a penetration test or a guarantee of no vulnerabilities**.

## Boundaries and reporting

Hermes plugins have host privileges and are not sandboxed. Modified plugins can access the host. SHA256 checks consistency, not authenticity; obtain the intended repository and review changes before updating.

Hermes owns remote transport, authentication, and response filtering; these are outside this review. A history response includes the focused session's visible transcript, not only selected text. Clearing references does not guarantee physical memory zeroization. The source window is accessible within the existing desktop session.

Install/uninstall is not race-proof against concurrent path modification. Use trusted directories, prevent concurrent changes, and avoid unnecessary elevation. Git installation uses Hermes's own installer.

Live client UI, OS clipboard, actual remote gateways, and platform integrations are outside the automated DOM/SDK tests. OS clipboard managers and paste destinations may retain copied message content.

Report vulnerabilities privately through GitHub **Security → Report a vulnerability** for this repository. If unavailable, open an issue asking for a private reporting channel without sensitive content or exploit details. Never attach real transcripts, credentials, or connection secrets.

## 中文摘要

审查了运行时源码、构建及安装/卸载脚本、生产 ESM 包、依赖漏洞报告和拟公开文件，在该范围内未发现未解决的安全或隐私问题。修复了暂停/切换时的缓存保留、过量元数据保留、网关错误详情展示和安装路径链接风险，补充了回归测试。官方 npm registry 审计报告为 0 个已知漏洞（含开发依赖）。

这不是无漏洞保证。Hermes 插件没有沙箱；连接和鉴权由 Hermes 管理。接口返回当前会话可见正文；释放缓存引用不保证物理内存清零。安装脚本不能防御其他程序同时篡改路径。真实客户端、系统剪贴板和远程网关尚未人工验收。请通过私密漏洞报告渠道反馈，勿公开聊天内容或密钥；渠道不可用时，仅发 issue 询问私密渠道。
