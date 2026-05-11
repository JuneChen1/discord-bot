# Discord Bot 指令說明

### `/remind`

設定提醒，將在指定日期（預設事件前一天）的指定時間（預設為 22:00 台灣時間）自動發送到指定頻道。

| 參數 | 必填 | 說明 |
|------|------|------|
| date | 是 | 事件日期，格式 `YYYYMMDD`，例如 `20260510` |
| message | 是 | 提醒內容 |
| time | 否 | 事件時間，格式 `HH:MM`，例如 `14:30` |
| remind_time | 否 | 提醒發送時間，格式 `HH:MM`，預設 `22:00` |
| remind_date | 否 | 提醒發送日期，格式 `YYYYMMDD`，預設為事件前一天 |

同一日期時間若已有相同內容的提醒，將不會重複建立。

---

### `/reminders`

查看你所有待發送的提醒，包含事件日期、提醒時間、內容、頻道及 ID。

---

### `/remind-edit`

透過 ID 編輯已設定的提醒，至少需提供一個要修改的欄位。

| 參數 | 必填 | 說明 |
|------|------|------|
| id | 是 | 提醒 ID（可從 `/reminders` 查詢） |
| message | 否 | 新的提醒內容 |
| date | 否 | 新的事件日期，格式 `YYYYMMDD` |
| time | 否 | 新的事件時間，格式 `HH:MM` |
| remind_date | 否 | 新的提醒日期，格式 `YYYYMMDD` |
| remind_time | 否 | 新的提醒時間，格式 `HH:MM` |

未填寫的欄位將保留原有值，只能編輯自己的提醒。

---

### `/remind-delete`

刪除一個或多個待發送的提醒。

| 參數 | 必填 | 說明 |
|------|------|------|
| id | 是 | 提醒 ID，多個 ID 用空白隔開（ID 可從建立時的訊息底部或 `/reminders` 查詢） |

---

### `/remind-import`

從 CSV 檔案批次匯入提醒，一次建立多筆。

| 參數 | 必填 | 說明 |
|------|------|------|
| file | 是 | CSV 附件，欄位依序為 `date`、`message`、`time`、`remind_time`、`remind_date`（後三欄選填） |

CSV 格式請查看 [reminders_template.csv](reminders_template.csv)。

同一日期時間若已有相同內容的提醒，該列將跳過並在結果中標示失敗。

---

### `/help`

列出所有可用指令與簡短說明。

---

## 本地端運作說明

### 啟動步驟

1. 複製 `.env.example` 為 `.env`，填入必要的環境變數：

   ```
   DISCORD_TOKEN=你的 Bot Token
   REMINDER_CHANNEL_ID=（選填）提醒發送頻道 ID
   DATA_DIR=（選填）資料儲存路徑
   ```

2. 安裝相依套件：

   ```bash
   npm install
   ```

3. 啟動 Bot：

   ```bash
   npm start
   ```

---

Bot 啟動時會自動讀取 `reminders.json`，將其中所有尚未到期的提醒重新排程。

- **已過期**的提醒（提醒時間早於啟動時間）會在啟動時自動刪除。
- **提醒資料儲存位置**：預設為專案根目錄的 `reminders.json`，可透過環境變數 `DATA_DIR` 指定其他路徑。
- **提醒發送頻道**：預設為執行指令的頻道，可透過環境變數 `REMINDER_CHANNEL_ID` 指定固定頻道，設定後所有提醒一律發送至該頻道。
- 若需手動新增提醒，可直接編輯 `reminders.json`，格式與 `/remind-import` CSV 欄位對應，重啟 Bot 後即會生效。