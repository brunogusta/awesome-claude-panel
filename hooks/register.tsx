import type { Register } from 'claude-code'

import { forgetGit } from './core/cache'
import { guarded, trace, traceVerbose } from './core/trace'
import { finishTurn, startTurn, trackToolCall } from './core/activity'
import { PANE_ID, closePane, onOverlay, renderPane, resetSessionPane, scrollBy, setCellSize } from './pane'

const EDITING = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

export const register: Register = (on, options) => {
  setCellSize(options)

  on('ui.fault', ($, e, next) => {
    void trace($, 'ui-fault', { fault: JSON.stringify(e).slice(0, 800) })

    return next(e)
  })

  on('session.start', async ($, e, next) => {
    void trace($, 'session-start', { surface: (e as { surface?: unknown }).surface, cwd: (e as { cwd?: unknown }).cwd })
    await $.command.register({ name: 'panel', description: 'Abre o painel lateral com o que o Claude mexeu' })

    return next(e)
  })

  on('command.run', { command: 'panel' }, async $ => {
    void trace($, 'command-run')
    await $.ui.open({ id: PANE_ID, title: 'Painel' })

    return { text: 'Painel aberto.' }
  })

  on('ui.render', { component: 'Pane', requestId: 'panel' }, ($, e) => guarded($, 'ui.render', () => renderPane($, e as never)))

  on('ui.scroll', { component: 'Pane', requestId: PANE_ID }, ($, e) => {
    void traceVerbose($, 'ui-scroll', { by: e.by, offset: e.offset, bodyRows: e.bodyRows, contentRows: e.contentRows, origin: e.origin.kind })
    scrollBy($, e.by)

    return {}
  })

  on('ui.message', ($, e, next) => (e.component === 'Pane' ? guarded($, 'ui.message', () => onOverlay($, e)) : next(e)) as never)

  on('ui.close', async ($, e, next) => {
    void trace($, 'ui-close', { id: e.id, origin: (e as { origin?: unknown }).origin })
    if (e.id === PANE_ID) await closePane($)

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    void trace($, 'session-end', { reason: (e as { reason?: unknown }).reason })
    resetSessionPane()
    await closePane($)

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    void traceVerbose($, 'tool', { tool: e.tool })
    await trackToolCall($, e)
    try {
      return await next(e)
    } finally {
      if (EDITING.has(e.tool)) {
        forgetGit()
        $.ui.invalidate('ui.render')
      }
    }
  })

  on('turn.start', async ($, e, next) => {
    await startTurn($)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    try {
      return await next(e)
    } finally {
      forgetGit()
      await finishTurn($)
    }
  })
}
