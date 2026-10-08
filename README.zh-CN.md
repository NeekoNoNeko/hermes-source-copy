# Hermes 原始 Markdown / LaTeX 复制

[English](README.md) | [简体中文](README.zh-CN.md)

在 Hermes Desktop 聊天正文中选中文字，按 **Ctrl+C**（macOS 为 **Cmd+C**），复制对应的原始 Markdown / LaTeX。插件保留原始语法，无法准确定位时打开源码窗口。

社区制作的独立 **Desktop 插件**，使用[官方 ESM SDK](https://hermes-agent.nousresearch.com/docs/developer-guide/desktop-plugin-sdk)。兼容基线为官方 Hermes Desktop 提交 `ac28abc96c`。无需修改客户端、调用模型或安装后端插件。插件界面目前使用中文标签，中英文说明覆盖相同功能。

## 从 Git 安装（推荐）

1. 打开 **Capabilities → Plugins → Install from Git（从 Git 安装）**。
2. 填写 `NeekoNoNeko/hermes-source-copy` 或 `https://github.com/NeekoNoNeko/hermes-source-copy`。
3. 选择 **Desktop** 组件并确认安装。必要时开启“原始 Markdown / LaTeX 复制”。

仓库根目录包含**预先打包的 `plugin.js`**，官方安装器据此识别独立 Desktop 插件。从 Git 安装需要 Git，但无需 Node.js、npm 构建、Python 或 API 密钥。仓库不含 Agent 插件清单。这是可通过 Git 安装的社区仓库，并不代表已被官方目录收录。参见[官方 Git 安装说明](https://hermes-agent.nousresearch.com/docs/user-guide/features/plugins)。

**v1.0.3：**补读含压缩存档的显示历史，修复旧回复无法复制；支持 `#media:` 文件卡片还原完整原始链接，避免卡片导致整条正文或表格无法匹配。移除插件安装/更新命令与右键复制适配，右键恢复客户端原有行为。保留 Ctrl+C/Cmd+C 源码复制及原文窗口。

## 更新

对于本插件这种独立 Desktop 插件，兼容基线的 SDK **没有自动更新接口**。Agent/目录插件的更新机制针对 Agent 包，不适用于这个仅包含 Desktop 的仓库。文件热重载只加载本地文件变化，不会从 GitHub 拉取新版。

更新请在 **Capabilities → Plugins → Install from Git（从 Git 安装）** 使用同一仓库地址，开启 Desktop 组件的强制重装。插件不再提供安装/更新命令，也不自动更新。

## 复制规则与边界

- 普通文字保留原文字符、转义、选区内部空格和换行。
- 从 `__一段文字__` 中选择“文字”，得到 `__文字__`；部分加粗、斜体、删除线、链接和行内代码用原始标记补齐。
- 触及公式任意部分时复制**整条原始公式**，保留 `$...$`、`$$...$$`、`\(...\)`、`\[...\]` 原始写法。
- 支持可逐字符核对的公式文本及 `.katex-error` 区域。中文本身不等于 LaTeX 无效：基线会把含中文的行内公式转为普通文字，有效的中文块级公式仍可能正常渲染。复制结果始终取自原始公式。
- 列表、引用、标题和代码块保留原始标记；选择表格单元格时复制**完整原始表格**。
- 同一聊天跨消息选择按显示顺序用两个换行连接，不加角色标签。
- 剪贴板仅写入 `text/plain`，避免富文本覆盖源码。
- 输入框、终端、设置页、推理区和空选区保持原有复制行为。

语法补齐、完整公式和整张表格会扩展选区；正文和补齐标记均来自原文，结果可能由多个原始片段组成。

原文未就绪、消息正在生成、选区跨聊天、重复消息无法唯一定位或 DOM 不支持时，插件阻止复制并打开**源码窗口**。选择消息和任意原文后正常复制，或使用全选/复制整条消息按钮。自动复制失败时，原有剪贴板保持不变。

HTML、内嵌图片/音频/视频、脚注、不支持的特殊卡片及部分复杂代码/媒体布局可能需要源码窗口。单条超过 200,000 UTF-16 字符的消息通过该窗口复制；每次会话读取的解析总量上限为 1,000,000 字符。原文取自聚焦会话的持久化显示历史及明确归属的 `session.history` 实时尾段。存档读取包含压缩前及祖先会话的回复，限制为 20 页、每页 500 条原始行或 1,000,000 正文字符。无原生桥接时回退 RPC；接口省略或未读入的数据需要原文窗口。DOM 适配集中在 `src/dom-adapter.js`，客户端升级后可能需要适配。

命令面板：

- **源码复制：开启 / 暂停**：暂停时清除消息缓存，恢复普通复制。
- **源码复制：查看当前聊天原文**：主动打开源码窗口，暂停拦截时也可使用。

选中受支持的文件卡片任意部分，复制完整原始 Markdown 链接，保留原始标签与编码后的地址。匹配同时核对目标路径、文件名、卡片结构及消息顺序，不能仅凭同名文件猜测；复制期间不打开、不下载文件。

## 隐私与安全

启用后，通过 `host.requestProfile(..., 'session.history', ...)` 及客户端原生 `window.hermesDesktop.api` 桥接读取聚焦会话的用户/助手正文。桥接只用于 `GET /api/sessions/<stored-id>/messages`，明确指定连接、配置和存储会话，设置 `include_compacted=true`、`inline_images=false`。远程传输沿用已有 Hermes 连接；插件不读取凭据、不直接发起网络请求。

只在窗口内存缓存当前会话。切换会话/配置/连接、暂停、禁用、卸载或热重载会清缓存并拒绝过期异步结果。正文不持久保存、不写日志；不保留推理、工具载荷或后端元数据。插件存储仅保存开启/暂停偏好。没有统计分析、第三方上传、直接网络请求或剪贴板读取。源码通过 DOM 文本属性展示，不作为 HTML 执行；网关错误详情会被隐藏。

Hermes Desktop 插件有宿主权限，**没有沙箱隔离**。本次审查不能保证不存在任何漏洞。范围及剩余限制见 [SECURITY.md](SECURITY.md)。系统剪贴板历史工具和粘贴目标可能保留用户主动复制的文本。

## 手动安装与卸载

克隆仓库或解压完整安装包。Windows 用户在项目/解压目录运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1
```

脚本依次使用 `HERMES_HOME`、已有 `%LOCALAPPDATA%\hermes\desktop-plugins`、`%USERPROFILE%\.hermes`。自定义目录：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1 -HermesHome 'D:\HermesData'
```

安装时校验打包文件 SHA256，拒绝源/目标路径及目标子项的重解析点（链接），备份已有安装至 `<HermesHome>\desktop-plugin-backups`。SHA256 检查一致性，不是发布者签名。执行脚本期间应避免其他程序修改相关路径。脚本不改聊天记录或其他插件。

macOS/Linux 可将 `dist/hermes-source-copy` 复制到实际 Desktop 插件目录（`$HERMES_HOME/desktop-plugins/` 或通常为 `~/.hermes/desktop-plugins/`），也可用 Git 安装。PowerShell 脚本仅面向 Windows。

可在 Hermes 插件管理页卸载，或运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\uninstall.ps1
```

自定义目录使用相同的 `-HermesHome`。仅移除 `desktop-plugins/hermes-source-copy`，保留备份及聊天数据。必要时在命令面板执行 **Reload desktop plugins**。

## 开发和验证

需要 Node.js 22 或更新版本：

```sh
npm ci
npm run check
npm audit --registry=https://registry.npmjs.org
npm run package  # 仅 Windows
```

构建生成内容一致的根目录 `plugin.js` 和 `dist/hermes-source-copy/plugin.js`、校验和、构建信息及第三方许可。运行时仅导入 `@hermes/plugin-sdk`，解析依赖全部打包。修改源码时必须提交重新构建的入口。ZIP 及 SHA256 文件生成于 `artifacts/`，不纳入 Git。

测试用真实 remark/KaTeX DOM 逐字符核对结果，覆盖重复内容、嵌套格式、四种公式、反向/跨消息选择、流式输出、连接路由、过期结果、清理、源码窗口注入、生产包加载，以及 Windows 安装/备份/卸载和链接拒绝。实际结果和限制见 [VERIFICATION.md](VERIFICATION.md)。

v1.0.1 还在正在运行的基线 Hermes 窗口中用合成复制事件验证了可见消息，覆盖此前失败的数学回答和合并回答中的后段。产生的公式通过 SDK 写入系统剪贴板，逐字符比较通过。物理 Ctrl+C/Cmd+C 按键、真实远程网关及其他平台仍需人工验收。安装后将加粗文字、四种公式、重复段落和表格复制到纯文本编辑器核对，并确认输入框/终端照常复制；升级 Hermes 后再次检查。

v1.0.3 补充压缩存档分页、旧/新/跨回复复制、文件卡片身份核对和功能移除回归。用户提供的表格/文件卡片回答，通过本地官方渲染流程及实际表格、卡片组件的七项逐字符比较；组件的操作和状态依赖被隔离。私人片段不公开发布。本版本尚未验收物理按键及最终系统粘贴；v1.0.1/v1.0.2 历史记录保留在 VERIFICATION.md。

MIT 许可证。打包依赖许可见 [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt)。
