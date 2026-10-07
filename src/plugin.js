import { host, PALETTE_AREA } from '@hermes/plugin-sdk'
import { startController } from './controller.js'

export default {
  id: 'hermes-source-copy',
  name: '原始 Markdown / LaTeX 复制',
  defaultEnabled: true,
  register(ctx) {
    const controller = startController(host, ctx)
    ctx.registerMany([
      { id: 'toggle', area: PALETTE_AREA, data: {
        id: 'hermes-source-copy.toggle', label: '源码复制：开启 / 暂停',
        keywords: ['markdown', 'latex', 'copy', '源码', '复制'], run: controller.commands.toggle
      } },
      { id: 'raw', area: PALETTE_AREA, data: {
        id: 'hermes-source-copy.raw', label: '源码复制：查看当前聊天原文',
        keywords: ['markdown', 'latex', 'source', '原文'], run: controller.commands.openRaw
      } },
      { id: 'update', area: PALETTE_AREA, data: {
        id: 'hermes-source-copy.update', label: '源码复制：更新插件（官方安装窗口）',
        keywords: ['update', '更新', 'markdown', 'latex'], run: controller.commands.update
      } }
    ])
  }
}
