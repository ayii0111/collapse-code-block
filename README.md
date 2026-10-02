# collapse-code-block

Claude Code 的 mod：把 Edit / Write 工具的 diff 預設收合成一行，需要時再點開。

```
[▸ 展開] +3 −3 行
```

## 功能

- Edit / Write 的結果預設收合，只顯示增減行數（新增綠色、刪除紅色）。
- 點 `[▸ 展開]` 展開成 diff；展開後頂端與底部各有一顆 `[▴ 收合]`。
- 展開的區塊尾端超出畫面時，畫面右下會浮出一顆 `[▴ 收合]`，不用捲回頂端。
- `/collapse-code-block [on|off]` 切換是否預設收合；不帶參數就是切換。`off` 時完全照原樣顯示。
- 其他工具、出錯的 Edit / Write 不受影響。

## 需求

- Claude Code v2.1.287 以上（以 2.1.287 測試）。mods 的 API 可能隨版本變動。
- 終端機的全螢幕版面：點擊只在這個版面有效。可在 `~/.claude/settings.json` 的 `env` 設 `"CLAUDE_CODE_NO_FLICKER": "1"`。
  在一般主畫面版面，收合的那一行點不開，請用 `/collapse-code-block off`。

## 安裝

```
/plugin marketplace add ayii0111/custom-tools
/plugin install collapse-code-block@custom-tools
```

安裝後執行 `/reload-plugins` 或重啟 Claude Code。

## 移除

```
/plugin uninstall collapse-code-block@custom-tools
```

## 開發

```bash
claude --plugin-dir .      # 載入並熱重載
claude plugin validate .   # 檢查 manifest 與 hooks 模組
claude plugin test .       # 執行 tests/
```

已安裝的版本以 `version` 快取；改完要讓安裝端更新，需調高 `.claude-plugin/plugin.json` 的 `version`。

## 已知限制

- 增減數字本身不能點，只有方括號按鈕可以。
- 超過約 9000 字元的 diff 會截斷，並標示省略的行數。
- 浮出的收合鈕位在畫面內倒數第二列：最後一列疊著 Claude Code 自己的捲動鈕，點擊送不到。
