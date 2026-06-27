# 測試說明

本測試針對 `utils.js` 中的純函式，使用 Node.js 內建 `node:test` 模組執行。

## 執行測試

```bash
npm test
```

## 測試覆蓋範圍

依 README 功能順序說明各測試的涵蓋內容。

---

### 1. `/remind` — 設定提醒

涉及函式：`parseRemindTime`、`calcReminderTime`、`formatEventDate`、`formatTaipeiTime`、`toMinutes`、`isDuplicateReminder`

#### `parseRemindTime(timeStr)`

解析使用者輸入的 `remind_time` 參數（`HH:MM` 格式）。

| 測試案例 | 輸入 | 預期結果 |
|---------|------|---------|
| null → 預設時間 | `null` | `{ hour: 22, minute: 0 }` |
| 空字串 → 預設時間 | `""` | `{ hour: 22, minute: 0 }` |
| 正常 HH:MM | `"18:30"` | `{ hour: 18, minute: 30 }` |
| 單位數小時 | `"9:05"` | `{ hour: 9, minute: 5 }` |
| 午夜 | `"00:00"` | `{ hour: 0, minute: 0 }` |
| 最大值 | `"23:59"` | `{ hour: 23, minute: 59 }` |
| 格式錯誤文字 | `"invalid"` | `null` |
| 小時超過 23 | `"25:00"` | `null` |
| 分鐘超過 59 | `"10:60"` | `null` |
| 缺少冒號 | `"1430"` | `null` |
| 多餘字元 | `"14:30:00"` | `null` |

#### `calcReminderTime(eventDateStr, remindHour, remindMinute, remindDateStr)`

計算提醒觸發的 UTC timestamp，核心邏輯為台灣時間（UTC+8）轉換。

| 測試案例 | 說明 |
|---------|------|
| 預設提醒時間 | 事件前一天 22:00 台灣時間 = 14:00 UTC |
| 自訂提醒時間 | 09:00 台灣時間 = 01:00 UTC，偏移計算正確 |
| 指定 remindDateStr | 使用指定日期而非自動計算前一天 |
| remindDateStr 與事件同日 | 同日 08:00 台灣 = 00:00 UTC |
| 跨月 | 月初事件，前一天正確回推到上月底 |
| 跨年 | 元旦事件，前一天正確回推到上一年底 |
| 非 8 位數 eventDateStr | 回傳 `null` |
| 含非數字的 eventDateStr | 回傳 `null` |
| 非 8 位數 remindDateStr | 回傳 `null` |
| 自訂分鐘數 | 22:30 台灣 = 14:30 UTC，分鐘正確傳遞 |
| remindHour < 8 隱式跨日 | 台灣 02:00 = 前一天 18:00 UTC，`setUTCHours` 負值自動往前一天 |

#### `isDuplicateReminder(reminders, { userId, eventDate, eventTime, message, remindTime, remindDate })`

判斷提醒列表中是否已存在相同使用者、日期、時間、內容、提醒設定的項目，供 `/remind` 與 `/remind-import` 共用。

| 測試案例 | 說明 |
|---------|------|
| 完全相同 | 六個欄位全部吻合 → `true` |
| 空列表 | 無任何提醒 → `false` |
| 不同使用者 | userId 不同 → `false` |
| 不同 eventDate | 日期不同 → `false` |
| 不同 eventTime | 事件時間不同 → `false` |
| 不同 message | 內容不同 → `false` |
| 不同 remindTime | 提醒時間不同 → `false` |
| 有 remindDate 且相同 | 指定提醒日期吻合 → `true` |
| 有 remindDate 但不同 | 指定提醒日期不符 → `false` |

#### `formatEventDate(dateStr)`

將 `YYYYMMDD` 格式轉為顯示用的 `YYYY/MM/DD`。

| 測試案例 | 輸入 | 預期結果 |
|---------|------|---------|
| 正常日期 | `"20260510"` | `"2026/05/10"` |
| 年底日期 | `"20231231"` | `"2023/12/31"` |
| 月初日期 | `"20260101"` | `"2026/01/01"` |

#### `formatTaipeiTime(ts)`

將 UTC timestamp 轉換為台灣時間（UTC+8）的顯示字串。

| 測試案例 | UTC 輸入 | 預期顯示（台灣時間） |
|---------|----------|-------------------|
| UTC+8 偏移正確 | 2026-05-10 14:00 UTC | `"2026/05/10 22:00"` |
| 跨日邊界 | 2026-05-10 16:30 UTC | `"2026/05/11 00:30"` |
| 前導零補足 | 2026-01-05 00:05 UTC | `"2026/01/05 08:05"` |
| 跨月邊界 | 2026-04-30 16:00 UTC | `"2026/05/01 00:00"` |

#### `toMinutes(hhmm)`

用於同日提醒時間與事件時間的大小比較（避免字串比較前導零問題）。

| 測試案例 | 輸入 | 預期結果 |
|---------|------|---------|
| 一般時間 | `"14:30"` | `870` |
| 午夜 | `"00:00"` | `0` |
| 23:59 | `"23:59"` | `1439` |
| 前導零 | `"08:05"` | `485` |
| 格式不合 | `"invalid"` | `NaN` |

---

### 2. `/reminders` — 查看提醒

涉及函式：`formatEventDate`、`formatTaipeiTime`

上述函式已在 `/remind` 區塊完整測試，不重複列出。

---

### 3. `/reminders-range` — 區間查詢提醒

涉及函式：`filterRemindersByRange`

#### `filterRemindersByRange(reminders, userId, fromStr, toStr)`

依事件日期區間篩選提醒，只回傳指定使用者的資料，結果依 `eventDate` 升冪排序。`toStr` 為空字串時無上限。

| 測試案例 | 說明 |
|---------|------|
| 有 from 和 to | 只回傳區間內的提醒（含邊界） |
| 無 to（空字串） | 回傳 from 當天（含）之後所有提醒 |
| from 等於 to | 只回傳當天的提醒 |
| 不同使用者 | 其他使用者的提醒不回傳 |
| 區間內無符合 | 回傳空陣列 |
| 空 reminders | 回傳空陣列 |
| 結果排序 | 多筆結果依 eventDate 升冪排列 |
| 跨月區間 | 跨越月份邊界的區間正確篩選 |

---

### 4. `/remind-edit` — 編輯提醒

涉及函式：`applyReminderEdits`

#### `applyReminderEdits(existing, patches)`

將 `patches` 套用到現有提醒物件，`patches` 中存在的 key 覆蓋舊值，不存在的 key 保留 `existing` 的值。

| 測試案例 | 說明 |
|---------|------|
| 無 patches | 所有欄位保留 existing 的值 |
| 只改 message | 僅 message 改變，其餘保留 |
| 只改 date | 僅 dateStr 改變，其餘保留 |
| 只改 time | 僅 timeStr 改變，其餘保留 |
| 只改 remindDate | 僅 remindDateStr 改變，其餘保留 |
| 只改 remindTime | 僅 remindTimeRaw 改變，其餘保留 |
| 同時改多個欄位 | 多個欄位同時更新，未指定的保留 |
| existing 無 remindDate | remindDateStr 預設為空字串 `""` |
| patch remindDate 為空字串 | 清除提醒日期，remindDateStr 為 `""` |
| patch time 為空字串 | 清除事件時間，timeStr 為 `""` |

---

### 5. `/remind-delete` — 刪除提醒

涉及函式：`formatEventDate`

已在 `/remind` 區塊完整測試。

---

### 6. `/remind-import` — 批次匯入

涉及函式：`parseCSVLine`、`isDuplicateReminder`（其餘與 `/remind` 共用）

#### `parseCSVLine(line)`

解析 CSV 單行，支援帶引號欄位（欄位內含逗號時用雙引號包圍）；`""` 為引號跳脫；引號未關閉回傳 `null`。

| 測試案例 | 輸入 | 預期結果 |
|---------|------|---------|
| 基本三欄 | `"20260510,hello,14:30"` | `["20260510", "hello", "14:30"]` |
| 帶引號欄位（含逗號） | `'20260510,"hello, world",14:30'` | `["20260510", "hello, world", "14:30"]` |
| 尾端空欄位 | `"20260510,hello,,"` | `["20260510", "hello", "", ""]` |
| 全空欄位 | `","` | `["", ""]` |
| 引號包圍但無逗號 | `'"20260510","hello"'` | `["20260510", "hello"]` |
| 五欄完整格式 | `"20260510,會議,14:30,21:00,20260509"` | `["20260510", "會議", "14:30", "21:00", "20260509"]` |
| `""` 跳脫引號 | `'20260510,"say ""hi"""'` | `["20260510", "say \"hi\""]` |
| 引號未關閉 | `'20260510,"未關閉'` | `null` |

#### 手動驗收用 CSV fixture

`test/fixtures/remind-import-test.csv` 是給 `/remind-import` 手動測試用的範例附件，內含 4 筆會成功匯入的案例與 8 筆分別觸發不同錯誤訊息的案例（缺欄位、日期格式錯誤、提醒時間格式錯誤、提醒日期格式錯誤、提醒日期晚於事件日期、同天提醒時間晚於事件時間、提醒時間已過期、重複提醒）。直接把這個檔案當附件丟給 `/remind-import` 即可驗證所有分支。

---

### 7. `/help` — 查看說明

本指令為靜態訊息輸出，無純函式邏輯，不需單元測試。

---

## 檔案結構

```
discord-bot/
├── index.js          # Bot 主程式（Discord.js 整合）
├── utils.js          # 可測試的純函式
├── utils.test.js     # 單元測試
├── test.md           # 本測試說明文件
└── package.json
```

## 技術說明

- **測試框架**：Node.js 內建 `node:test` + `node:assert/strict`（Node.js ≥ 20，無需安裝額外套件）
- **測試範圍**：純函式（無副作用、不依賴 Discord.js 或檔案 I/O）
- **未測試項目**：Discord 指令處理器與排程邏輯（需要 Discord.js mock，超出目前範圍）
