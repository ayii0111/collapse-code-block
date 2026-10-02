import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

const PLUGIN = 'collapse-code-block'

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

    // 收合行：[▸ 展開] +2（綠） −1（紅） 行，只有方括號那顆可點
    expect((await ui.find({ key: 'toggle' }))?.props.label).toBe('[▸ 展開]')
    expect((await ui.find({ type: 'Text', text: '+2' }))?.props.color).toBe(
      'green',
    )
    expect((await ui.find({ type: 'Text', text: '−1' }))?.props.color).toBe(
      'red',
    )
    expect(await ui.find({ type: 'Text', text: '行' })).toBeDefined()
    expect(await ui.find({ type: 'Code' })).toBeUndefined()

    await ui.press({ key: 'toggle' })

    expect((await ui.find({ key: 'toggle' }))?.props.label).toBe('[▴ 收合]')
    expect((await ui.find({ key: 'fold' }))?.props.label).toBe('[▴ 收合]')
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

test('尾端被畫面截掉時收合鈕疊畫在畫面內倒數第二列，尾端入畫面後消失', async $ => {
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

  const placed = async (ui: Awaited<ReturnType<typeof open>>) =>
    (await ui.findAll({ type: 'Box' })).find(
      box => box.props.position === 'absolute' && box.props.right === 0,
    )

  // 畫面最後一列是第 13 列：收合鈕疊畫在倒數第二列（第 12 列）靠右，
  // 代碼不切開、底部的收合鈕照常在
  for (const [id, props, onScreen] of [
    ['cut', LONG, { first: 0, last: 13, of: 42 }],
    // 引擎排出的列數和行數不一致（長行折行、段落分隔列）也照樣疊畫
    ['wrapped', LONG, { first: 0, last: 13, of: 50 }],
    ['two', TWO, { first: 0, last: 13, of: 30 }],
  ] as const) {
    const cut = await open(id, props, onScreen)
    expect((await placed(cut))?.props).toMatchObject({ top: 12, right: 0 })
    expect(await cut.findAll({ type: 'Code' })).toHaveLength(1)
    expect(await cut.find({ key: 'fold' })).toBeDefined()
    await cut.press({ key: 'float' })
    expect(await cut.find({ type: 'Code' })).toBeUndefined()
    await cut.unmount()
  }

  // 兩段 diff 合在同一個 Code 裡
  const two = await open('two-whole', TWO, null)
  expect((await two.find({ type: 'Code' }))?.props.source).toBe(
    '@@ -1,1 +1,1 @@\n-a\n+A\n@@ -9,1 +9,1 @@\n-b\n+B',
  )
  await two.unmount()

  for (const [id, onScreen] of [
    ['end', { first: 20, last: 41, of: 42 }],
    ['top', { first: 0, last: 1, of: 42 }],
    ['off', null],
  ] as const) {
    const whole = await open(id, LONG, onScreen)
    expect(await placed(whole)).toBeUndefined()
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

    // 新檔整份都算新增：只有綠色的 +2，沒有紅色的刪除數
    expect((await ui.find({ key: 'toggle' }))?.props.label).toBe('[▸ 展開]')
    expect((await ui.find({ type: 'Text', text: '+2' }))?.props.color).toBe(
      'green',
    )
    expect(await ui.find({ type: 'Text', text: /−/ })).toBeUndefined()

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

test('/collapse-code-block off 之後照原樣顯示，on 之後恢復收合', async ($, on) => {
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
