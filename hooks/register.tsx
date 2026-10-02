import { atom, memberOf, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Hunk } from '../types'

const COMMAND = 'collapse-edits'
const SOURCE_LIMIT = 9000
const LINE_LIMIT = 400
const SEPARATOR = '⋮'

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

// 展開後的一列代碼；oldNo/newNo 是這一列在舊檔、新檔的行號
type Line = { text: string; hunk: number; oldNo: number; newNo: number }

type Body = { lines: Line[]; omitted: number; isDiff: boolean }

// 畫面上的一列：一行代碼，或 diff 兩個段落之間的分隔列（null）
type Item = Line | null

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

// Code 在 diff 的每兩個段落之間多畫一列分隔，列號要把它算進去
const toItems = (lines: Line[]) =>
  lines.flatMap((line, index): Item[] => {
    const before = lines[index - 1]

    return before !== undefined && before.hunk !== line.hunk
      ? [null, line]
      : [line]
  })

// 一段連續的列重新組成 unified diff；從 hunk 中間切開時標頭依切點重算
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

const summarize = (change: Change) => {
  if (change.hunks.length > 0) {
    return `+${count(change.hunks, '+')} −${count(change.hunks, '-')} 行`
  }

  if (change.content !== null) {
    return `${toLines(change.content).length} 行`
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

    const body = toBody(change)
    const items = toItems(body.lines)
    // 頂端一列、收合鈕一列，有省略時再多一列；收合鈕不論在中間或底部都只佔一列，
    // 所以總列數固定，才能拿 onScreen 的列號對回代碼行
    const rows = items.length + 2 + (body.omitted > 0 ? 1 : 0)
    // 區塊尾端被畫面下緣截掉時，收合鈕改插在畫面內的倒數第二列：
    // 最後一列疊著引擎自己的捲動鈕那一層，點擊送不到。
    // 列數對不上（例如長行折行）就不插，留在底部
    const floatAt =
      onScreen &&
      onScreen.of === rows &&
      onScreen.last >= 3 &&
      onScreen.last < rows - 1
        ? onScreen.last - 1
        : null
    // 暫時的診斷紀錄：確認引擎回報的列數與推算是否一致
    $.ui.log(
      `rows=${rows} lines=${body.lines.length} floatAt=${floatAt} onScreen=${JSON.stringify(onScreen)}`,
      { to: 'debug' },
    )
    const split =
      floatAt === null ? items.length : Math.min(floatAt - 1, items.length)

    const code = (key: string, lines: Line[]) => {
      const first = lines[0]

      if (first === undefined) {
        return null
      }

      return body.isDiff ? (
        <Code key={key} source={toDiff(lines)} format="diff" path={change.path} />
      ) : (
        <Code
          key={key}
          source={lines.map(line => line.text).join('\n')}
          path={change.path}
          startLine={first.newNo}
        />
      )
    }

    // Code 只在自己內部的段落之間畫分隔列；切點落在分隔列上時由這裡補畫，
    // 總列數才不會隨切點變動
    const piece = (key: string, part: Item[]) => {
      const lines = part.filter((item): item is Line => item !== null)

      return (
        <Box flexDirection="column">
          {part[0] === null && <Text dimColor>{SEPARATOR}</Text>}
          {code(key, lines)}
          {part.length > 1 && part[part.length - 1] === null && (
            <Text dimColor>{SEPARATOR}</Text>
          )}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Button
          key="toggle"
          plain
          dimColor
          label={`▾ ${summary}（點擊收合）`}
          onPress={toggle}
        />
        {piece('body', items.slice(0, split))}
        {floatAt !== null && (
          <Box justifyContent="flex-end">
            <Button key="float" label="▴ 收合" onPress={toggle} />
          </Box>
        )}
        {piece('rest', items.slice(split))}
        {body.omitted > 0 && (
          <Text dimColor>… 另有 {body.omitted} 行未顯示</Text>
        )}
        {floatAt === null && (
          <Button
            key="fold"
            plain
            dimColor
            label={`▴ ${summary}（點擊收合）`}
            onPress={toggle}
          />
        )}
      </Box>
    )
  })
}
