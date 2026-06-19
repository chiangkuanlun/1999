# 1999 案件智慧分派

Angular 21 + Express SSR 的多機關 1999 案件管理 MVP。系統可維護使用機關與責任局處、匯入參考案例，並以 Gemini 或本地文字相似度自動分派新進案件。

## 功能

- 使用機關 CRUD、啟停與個別自動分派門檻
- 責任局處 CRUD、啟停、權責、關鍵字與聯絡資訊
- 單筆新增及 UTF-8 CSV 批次匯入參考案例
- 中文 bigram、英文詞元、Jaccard 案例相似度與關鍵字比對
- 有 `GEMINI_API_KEY` 時優先使用 Gemini，失敗時自動切回本地案例比對
- 保存候選局處、信心分數、理由、命中參考案例與案件軌跡
- 低信心案件進入人工覆核，管理者可人工改派及填寫理由
- 案件狀態、處理回覆與基本統計
- JSON 原子寫入持久化，不需額外資料庫套件

## 本機啟動

```bash
npm install
npm run dev
```

開發環境預設位於 <http://localhost:3000>。正式 SSR build：

```bash
npm run build
npm run serve:ssr:app
```

## 環境變數

```env
GEMINI_API_KEY=your-key
CASE_ROUTING_DATA=/absolute/path/case-routing.json
PORT=4000
```

未設定 `GEMINI_API_KEY` 時，系統仍可使用本地參考案例及權責關鍵字分派。資料檔預設為 `data/case-routing.json`，該路徑已加入 `.gitignore`。

## CSV 格式

```csv
department_code,case_no,title,description
PWD,REF-001,道路坑洞,中正路出現大型坑洞影響行車安全
EPD,REF-002,夜間噪音,工地深夜施工影響居民安寧
```

必要欄位為 `department_code`、`title`、`description`；`case_no` 選填。亦支援 `局處代碼`、`案件編號`、`標題`、`案件內容` 中文欄位名稱。

## 測試

```bash
npm test -- --watch=false
npm run build
```

## API 摘要

| Method | Path | 用途 |
|---|---|---|
| GET / POST | `/api/organizations` | 查詢／建立機關 |
| PUT | `/api/organizations/:id` | 更新機關、門檻與狀態 |
| GET / POST | `/api/departments` | 查詢／建立責任局處 |
| PUT / DELETE | `/api/departments/:id` | 更新／停用責任局處 |
| GET / POST | `/api/reference-cases` | 查詢／建立參考案例 |
| POST | `/api/reference-cases/import` | CSV 批次匯入 |
| GET / POST | `/api/cases` | 查詢／建立並分派案件 |
| POST | `/api/cases/:id/dispatch` | 人工改派 |
| POST | `/api/cases/:id/status` | 更新狀態與處理說明 |
| GET | `/api/stats` | 機關案件統計 |

## 產品化注意事項

目前 JSON store 適合單一 Node instance 的內網 MVP。多 instance 或大量案件部署前，建議換成 PostgreSQL、加入正式 migration、SSO/RBAC、完整 audit log、個資保存政策、匯入檔案掃毒及非同步工作佇列。
