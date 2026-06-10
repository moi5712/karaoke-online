# Styles 結構說明

此目錄採「theme/token/base/components/utilities」分層。

## 檔案分工

- `themes.css`
  - 主題原始變數（`--ds-*`），由 `data-theme` 控制深淺色。
- `tokens.css`
  - Tailwind `@theme` 對應層，將 `--ds-*` 映射為 `--color-*` 等語意 token。
- `base.css`
  - 僅放全域基礎規則（reset、typography、focus、layout root 等）。
- `components/*.css`
  - 元件專屬樣式（例如 `range.css`、`idle-mic.css`、`knob.css`）。
- `utilities/*.css`
  - 可重用 utility class 與 keyframes（例如 scrollbar、animation）。

## 維護原則

- 優先使用 Tailwind utility；只有 utility 難以表達時才新增 CSS。
- 新增規則時先判斷層級：
  - 全域影響 -> `base.css`
  - 元件專用 -> `components/*.css`
  - 可重複使用工具類 -> `utilities/*.css`
- 保持 `src/index.css` 載入順序：
  - `themes.css` -> `tokens.css` -> `tailwindcss` -> 其餘拆分檔。
