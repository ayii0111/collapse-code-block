import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

const PLUGIN = 'collapse-edits'

const EDIT = {
  tool_use_id: 'toolu_edit',
  tool: 'Edit',
  isErrored: false,
  output: {
    filePath: '/tmp/demo.ts',
    oldString: 'const a = 1',
    newString: 'const a = 2\nconst b = 3',
    originalFile: 'const a = 1\n',
    structuredPatch: [
      {
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 2,
        lines: ['-const a = 1', '+const a = 2', '+const b = 3'],
      },
    ],
    userModified: false,
    replaceAll: false,
  },
}

const WRITE = {
  tool_use_id: 'toolu_write',
  tool: 'Write',
  isErrored: false,
  output: {
    type: 'create',
    filePath: '/tmp/new.ts',
    content: 'export const x = 1\nexport const y = 2',
    structuredPatch: [],
    originalFile: null,
  },
}

const SURFACES = ['terminal', 'desktop'] as const
const ENGINE = '引擎原本的繪製'

// 測試裡沒有引擎自己的繪製，mod 交回 next(e) 時由這個 hook 代答
const engine = (on: On) => {
  on('ui.render', { component: 'ToolResult' }, ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>{ENGINE}</Text>
  })
}

const run = (args: string) => ({
  command: PLUGIN,
  args,
  origin: { kind: 'composer' } as const,
  presentation: { isFullscreen: true, columns: 120 },
})

test('Edit 的結果預設收合成一行，按下後展開 diff，再按收回', async $ => {
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({
      plugin: PLUGIN,
      surface,
      component: 'ToolResult',
      props: EDIT,
      requestId: `${EDIT.tool_use_id}-${surface}`,
    })

    expect((await ui.find({ key: 'toggle' }))?.props.label).toBe(
      '▸ +2 −1 行（點擊展開）',
    )
    expect(await ui.find({ type: 'Code' })).toBeUndefined()

    await ui.press({ key: 'toggle' })

    expect((await ui.find({ key: 'toggle' }))?.props.label).toBe(
      '▾ +2 −1 行（點擊收合）',
    )
    expect((await ui.find({ type: 'Code' }))?.props).toMatchObject({
      format: 'diff',
      source: '@@ -1,1 +1,2 @@\n-const a = 1\n+const a = 2\n+const b = 3',
    })

    await ui.press({ key: 'toggle' })

    expect(await ui.find({ type: 'Code' })).toBeUndefined()
    await ui.unmount()
  }
})

test('展開後底部有收合鈕，按下收回', async $ => {
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({
      plugin: PLUGIN,
      surface,
      component: 'ToolResult',
      props: EDIT,
      requestId: `fold-${surface}`,
    })

    expect(await ui.find({ key: 'fold' })).toBeUndefined()
    await ui.press({ key: 'toggle' })
    expect(await ui.find({ key: 'fold' })).toBeDefined()
    expect(await ui.find({ key: 'float' })).toBeUndefined()

    await ui.press({ key: 'fold' })

    expect(await ui.find({ type: 'Code' })).toBeUndefined()
    await ui.unmount()
  }
})

const LONG = {
  ...WRITE,
  output: {
    ...WRITE.output,
    // 檔尾換行不算一行
    content: `${Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join('\n')}\n`,
  },
}

const TWO = {
  ...EDIT,
  output: {
    ...EDIT.output,
    structuredPatch: [
      { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+A'] },
      { oldStart: 9, oldLines: 1, newStart: 9, newLines: 1, lines: ['-b', '+B'] },
    ],
  },
}

type Shown ={ first: number; last: number; of: number }

test('尾端被畫面截掉時收合鈕插在畫面內倒數第二列，尾端入畫面後回到底部', async $ => {
  const open = async (id: string, props: object, onScreen: Shown | null) => {
    const ui = await $.ui.mount({
      plugin: PLUGIN,
      surface: 'terminal',
      component: 'ToolResult',
      props: { ...(props as typeof LONG), onScreen },
      requestId: id,
    })
    await ui.press({ key: 'toggle' })

    return ui
  }

  // 40 行 + 頂端一列 + 收合鈕一列 = 42 列；畫面最後一列是第 13 列，
  // 收合鈕插在倒數第二列（第 12 列），靠右
  const cut = await open('cut', LONG, { first: 0, last: 13, of: 42 })
  const row = (await cut.findAll({ type: 'Box' })).find(
    box => box.props.justifyContent === 'flex-end',
  )
  expect(row?.children).toHaveLength(1)
  const pieces = await cut.findAll({ type: 'Code' })
  expect(pieces).toHaveLength(2)
  expect(pieces[0]?.props).toMatchObject({
    startLine: 1,
    source: Array.from({ length: 11 }, (_, i) => `line ${i + 1}`).join('\n'),
  })
  expect(pieces[1]?.props).toMatchObject({ startLine: 12 })
  expect(await cut.find({ key: 'float' })).toBeDefined()
  expect(await cut.find({ key: 'fold' })).toBeUndefined()
  await cut.press({ key: 'float' })
  expect(await cut.find({ type: 'Code' })).toBeUndefined()
  await cut.unmount()

  // 兩段 diff 之間有一列分隔：2 行 + 分隔 + 2 行，加頭尾共 7 列。
  // 切點落在分隔列前後時由 mod 補畫分隔列，總列數不變
  for (const [last, sources] of [
    [4, ['@@ -1,1 +1,1 @@\n-a\n+A', '@@ -9,1 +9,1 @@\n-b\n+B']],
    [5, ['@@ -1,1 +1,1 @@\n-a\n+A', '@@ -9,1 +9,1 @@\n-b\n+B']],
    [3, ['@@ -1,1 +1,0 @@\n-a', '@@ -2,0 +1,1 @@\n+A\n@@ -9,1 +9,1 @@\n-b\n+B']],
  ] as const) {
    const two = await open(`two-${last}`, TWO, { first: 0, last, of: 7 })
    const drawn = await two.findAll({ type: 'Code' })
    expect(drawn.map(one => one.props.source)).toEqual(sources)
    expect(await two.findAll({ type: 'Text', text: '⋮' })).toHaveLength(
      last === 3 ? 0 : 1,
    )
    expect(await two.find({ key: 'float' })).toBeDefined()
    await two.unmount()
  }

  // 從 hunk 中間切開時，兩段各自是合法的 diff
  const diff = await open('diff', EDIT, { first: 0, last: 3, of: 5 })
  const hunks = await diff.findAll({ type: 'Code' })
  expect(hunks.map(one => one.props.source)).toEqual([
    '@@ -1,1 +1,0 @@\n-const a = 1',
    '@@ -2,0 +1,2 @@\n+const a = 2\n+const b = 3',
  ])
  await diff.unmount()

  for (const [id, onScreen] of [
    ['end', { first: 20, last: 41, of: 42 }],
    ['top', { first: 0, last: 2, of: 42 }],
    ['wrapped', { first: 0, last: 13, of: 44 }],
    ['off', null],
  ] as const) {
    const whole = await open(id, LONG, onScreen)
    expect(await whole.findAll({ type: 'Code' })).toHaveLength(1)
    expect(await whole.find({ key: 'float' })).toBeUndefined()
    expect(await whole.find({ key: 'fold' })).toBeDefined()
    await whole.unmount()
  }
})

test('Write 新檔沒有 patch 時，展開顯示檔案內容', async $ => {
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({
      plugin: PLUGIN,
      surface,
      component: 'ToolResult',
      props: WRITE,
      requestId: `${WRITE.tool_use_id}-${surface}`,
    })

    expect((await ui.find({ key: 'toggle' }))?.props.label).toBe(
      '▸ 2 行（點擊展開）',
    )

    await ui.press({ key: 'toggle' })

    expect((await ui.find({ type: 'Code' }))?.props).toMatchObject({
      source: WRITE.output.content,
      path: '/tmp/new.ts',
    })
    await ui.unmount()
  }
})

test('其他工具、出錯的呼叫不接管', async ($, on) => {
  engine(on)

  for (const props of [
    { ...EDIT, tool: 'Bash', output: { stdout: 'ok', stderr: '' } },
    { ...EDIT, isErrored: true, output: 'String to replace not found' },
  ]) {
    const ui = await $.ui.mount({
      plugin: PLUGIN,
      surface: 'terminal',
      component: 'ToolResult',
      props,
    })

    expect(await ui.find({ key: 'toggle' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: ENGINE })).toBeDefined()
    await ui.unmount()
  }
})

test('/collapse-edits off 之後照原樣顯示，on 之後恢復收合', async ($, on) => {
  engine(on)

  const off = await $.command.run(run('off'))
  expect(off?.text).toContain('已停用')

  const plain = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'ToolResult',
    props: EDIT,
  })
  expect(await plain.find({ key: 'toggle' })).toBeUndefined()
  expect(await plain.find({ type: 'Text', text: ENGINE })).toBeDefined()
  await plain.unmount()

  const back = await $.command.run(run('on'))
  expect(back?.text).toContain('預設收合')

  const folded = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'ToolResult',
    props: EDIT,
  })
  expect(await folded.find({ key: 'toggle' })).toBeDefined()
  await folded.unmount()
})
