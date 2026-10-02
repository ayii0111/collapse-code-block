import { atom, memberOf, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Hunk } from '../types'

const COMMAND = 'collapse-edits'
const SOURCE_LIMIT = 9000
const LINE_LIMIT = 400

const isCollapsing = atom(
  { plugin: 'collapse-edits', key: 'isCollapsing' } as const,
  true,
)
const isOpen = atom({ plugin: 'collapse-edits', key: 'isOpen' } as const, false)

type Change = {
  path: string
  hunks: Hunk[]
  content: string | null
}

const isHunk = (value: unknown): value is Hunk => {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const hunk = value as Record<string, unknown>

  return (
    typeof hunk.oldStart === 'number' &&
    typeof hunk.newStart === 'number' &&
    Array.isArray(hunk.lines) &&
    hunk.lines.every(line => typeof line === 'string')
  )
}

const toChange = (output: unknown): Change | null => {
  if (typeof output !== 'object' || output === null) {
    return null
  }

  const record = output as Record<string, unknown>

  if (typeof record.filePath !== 'string') {
    return null
  }

  const patch = Array.isArray(record.structuredPatch)
    ? record.structuredPatch
    : []

  return {
    path: record.filePath,
    hunks: patch.filter(isHunk),
    content: typeof record.content === 'string' ? record.content : null,
  }
}

// Code 的 source 只接受 tab 與換行這兩種控制字元
const clean = (line: string) =>
  line.replace(/[\u0000-\u0008\u000a-\u001f\u007f]/g, '').slice(0, LINE_LIMIT)

const isMarker = (line: string) => line.startsWith('\\')

const count = (hunks: Hunk[], sign: string) =>
  hunks.reduce(
    (sum, hunk) =>
      sum + hunk.lines.filter(line => line.startsWith(sign)).length,
    0,
  )

const header = (hunk: Hunk, lines: string[]) => {
  const body = lines.filter(line => !isMarker(line))
  const oldLines = body.filter(line => !line.startsWith('+')).length
  const newLines = body.filter(line => !line.startsWith('-')).length

  return `@@ -${hunk.oldStart},${oldLines} +${hunk.newStart},${newLines} @@`
}

// 超過 Code 長度上限時在行界截斷，並依實際留下的行數重算 hunk 標頭
const toDiff = (hunks: Hunk[]) => {
  const parts: string[] = []
  let room = SOURCE_LIMIT
  let omitted = 0

  for (const hunk of hunks) {
    const kept: string[] = []

    for (const raw of hunk.lines) {
      const line = clean(raw)

      if (room < line.length + 1) {
        room = 0
        omitted += 1
      } else {
        room -= line.length + 1
        kept.push(line)
      }
    }

    if (kept.some(line => !isMarker(line))) {
      parts.push(header(hunk, kept), ...kept)
    }
  }

  return { source: parts.join('\n'), omitted }
}

const toSource = (content: string) => {
  const lines = content.split('\n').map(clean)
  const kept: string[] = []
  let room = SOURCE_LIMIT

  for (const line of lines) {
    if (room < line.length + 1) {
      break
    }

    room -= line.length + 1
    kept.push(line)
  }

  return { source: kept.join('\n'), omitted: lines.length - kept.length }
}

const summarize = (change: Change) => {
  if (change.hunks.length > 0) {
    return `+${count(change.hunks, '+')} −${count(change.hunks, '-')} 行`
  }

  if (change.content !== null) {
    return `${change.content.split('\n').length} 行`
  }

  return '無差異'
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: '切換 Edit/Write 的 diff 是否預設收合',
      argumentHint: '[on|off]',
    })

    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const now = await update($, isCollapsing, was =>
      arg === 'on' ? true : arg === 'off' ? false : !was,
    )

    return {
      text: now
        ? 'collapse-edits：Edit/Write 的 diff 預設收合。'
        : 'collapse-edits：已停用，Edit/Write 照原樣顯示。',
    }
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    const { tool, output, isErrored } = e.props

    if ((tool !== 'Edit' && tool !== 'Write') || isErrored) {
      return next(e)
    }

    const change = toChange(output)

    if (change === null || !(await read($, isCollapsing))) {
      return next(e)
    }

    const member = memberOf(isOpen, e)
    const open = await read($, member)
    const toggle = () => update($, member, was => !was)
    const summary = summarize(change)
    const { Box, Button, Code, Text } = $.ui.resolve(e)

    if (!open) {
      return (
        <Box>
          <Button
            key="toggle"
            plain
            dimColor
            label={`▸ ${summary}（點擊展開）`}
            onPress={toggle}
          />
        </Box>
      )
    }

    const body =
      change.hunks.length > 0
        ? toDiff(change.hunks)
        : toSource(change.content ?? '')

    return (
      <Box flexDirection="column">
        <Button
          key="toggle"
          plain
          dimColor
          label={`▾ ${summary}（點擊收合）`}
          onPress={toggle}
        />
        {body.source !== '' &&
          (change.hunks.length > 0 ? (
            <Code key="body" source={body.source} format="diff" path={change.path} />
          ) : (
            <Code key="body" source={body.source} path={change.path} startLine={1} />
          ))}
        {body.omitted > 0 && (
          <Text dimColor>… 另有 {body.omitted} 行未顯示</Text>
        )}
      </Box>
    )
  })
}
