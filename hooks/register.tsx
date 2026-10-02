import { atom, memberOf, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Hunk } from '../types'

const COMMAND = 'collapse-code-block'
const SOURCE_LIMIT = 9000
const LINE_LIMIT = 400
const EXPAND = '[▸ 展開]'
const COLLAPSE = '[▴ 收合]'
const ADDED = 'green'
const REMOVED = 'red'

const isCollapsing = atom(
  { plugin: 'collapse-code-block', key: 'isCollapsing' } as const,
  true,
)
const isOpen = atom({ plugin: 'collapse-code-block', key: 'isOpen' } as const, false)

type Change = {
  path: string
  hunks: Hunk[]
  content: string | null
}

// 展開後的一列代碼；oldNo/newNo 是這一列在舊檔、新檔的行號
type Line = { text: string; hunk: number; oldNo: number; newNo: number }

type Body = { lines: Line[]; omitted: number; isDiff: boolean }

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

// 檔尾的換行不算一行：Code 不會為它多畫一列
const toLines = (content: string) => {
  const lines = content.split('\n')

  return lines.length > 1 && lines[lines.length - 1] === ''
    ? lines.slice(0, -1)
    : lines
}

const count = (hunks: Hunk[], sign: string) =>
  hunks.reduce(
    (sum, hunk) =>
      sum + hunk.lines.filter(line => line.startsWith(sign)).length,
    0,
  )

// 超過 Code 長度上限的部分不畫，只回報省略了幾行
const toBody = (change: Change): Body => {
  const lines: Line[] = []
  let room = SOURCE_LIMIT
  let omitted = 0

  const take = (line: Line) => {
    if (room < line.text.length + 1) {
      room = 0
      omitted += 1
    } else {
      room -= line.text.length + 1
      lines.push(line)
    }
  }

  if (change.hunks.length === 0) {
    const source = change.content === null ? [] : toLines(change.content)
    source.forEach((raw, index) =>
      take({ text: clean(raw), hunk: 0, oldNo: index + 1, newNo: index + 1 }),
    )

    return { lines, omitted, isDiff: false }
  }

  change.hunks.forEach((hunk, index) => {
    let oldNo = hunk.oldStart
    let newNo = hunk.newStart

    // `\ No newline at end of file` 不佔畫面列
    for (const raw of hunk.lines.filter(line => !line.startsWith('\\'))) {
      take({ text: clean(raw), hunk: index, oldNo, newNo })
      oldNo += raw.startsWith('+') ? 0 : 1
      newNo += raw.startsWith('-') ? 0 : 1
    }
  })

  return { lines, omitted, isDiff: true }
}

// 留下的列重新組成 unified diff；hunk 被截短時標頭依實際行數重算
const toDiff = (lines: Line[]) => {
  const parts: string[] = []
  let from = 0

  while (from < lines.length) {
    const first = lines[from]

    if (first === undefined) {
      break
    }

    let to = from

    while (lines[to]?.hunk === first.hunk) {
      to += 1
    }

    const texts = lines.slice(from, to).map(line => line.text)
    const oldLines = texts.filter(text => !text.startsWith('+')).length
    const newLines = texts.filter(text => !text.startsWith('-')).length

    parts.push(
      `@@ -${first.oldNo},${oldLines} +${first.newNo},${newLines} @@`,
      ...texts,
    )
    from = to
  }

  return parts.join('\n')
}

// 增減行數；新建的檔案沒有 patch，整份內容都算新增
const summarize = (change: Change) => {
  if (change.hunks.length > 0) {
    return {
      added: count(change.hunks, '+'),
      removed: count(change.hunks, '-'),
    }
  }

  if (change.content !== null) {
    return { added: toLines(change.content).length, removed: null }
  }

  return null
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
        ? 'collapse-code-block：Edit/Write 的 diff 預設收合。'
        : 'collapse-code-block：已停用，Edit/Write 照原樣顯示。',
    }
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    const { tool, output, isErrored, onScreen } = e.props

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

    // 只有方括號那顆 Button 可點；Button 的文字只有單色，增減數字另用 Text 上色
    const bar = (key: string, label: string) => (
      <Box gap={1}>
        <Button key={key} plain label={label} onPress={toggle} />
        {summary === null && <Text dimColor>無差異</Text>}
        {summary !== null && <Text color={ADDED}>+{summary.added}</Text>}
        {summary !== null && summary.removed !== null && (
          <Text color={REMOVED}>−{summary.removed}</Text>
        )}
        {summary !== null && <Text dimColor>行</Text>}
      </Box>
    )

    if (!open) {
      return bar('toggle', EXPAND)
    }

    const body = toBody(change)
    // 區塊尾端被畫面下緣截掉時，在畫面內的倒數第二列疊畫一顆收合鈕，不佔列：
    // 最後一列疊著引擎自己的捲動鈕那一層，點擊送不到
    const floatAt =
      onScreen && onScreen.last >= 2 && onScreen.last < onScreen.of - 1
        ? onScreen.last - 1
        : null

    return (
      <Box flexDirection="column">
        {bar('toggle', COLLAPSE)}
        {body.lines.length > 0 &&
          (body.isDiff ? (
            <Code
              key="body"
              source={toDiff(body.lines)}
              format="diff"
              path={change.path}
            />
          ) : (
            <Code
              key="body"
              source={body.lines.map(line => line.text).join('\n')}
              path={change.path}
              startLine={1}
            />
          ))}
        {body.omitted > 0 && (
          <Text dimColor>… 另有 {body.omitted} 行未顯示</Text>
        )}
        {bar('fold', COLLAPSE)}
        {floatAt !== null && (
          <Box position="absolute" top={floatAt} right={0}>
            <Button key="float" plain label={COLLAPSE} onPress={toggle} />
          </Box>
        )}
      </Box>
    )
  })
}
