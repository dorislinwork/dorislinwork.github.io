# Doris Lin — 作品集網站

從 Cargo（doris-lin.com）搬過來的自架靜態站。**零套件依賴，不需要 `npm install`。**

上線網址：<https://dorislinwork.github.io>

---

## 日常最常做的三件事

```bash
# 1. 改完內容後重新產生網站
node build.mjs

# 2. 本機預覽（然後開 http://localhost:8080）
node tools/serve.mjs . 8080

# 3. 推上線
git add -A && git commit -m "更新內容" && git push
```

---

## 資料夾說明

改東西**只需要動 `content/` 和 `src/`**，根目錄那些 `.html` 都是產生出來的，直接改會在下次 build 被覆蓋。

```
├── build.mjs              產生器：讀 content/ → 寫出所有頁面
├── download-media.mjs     把 Cargo 上的圖抓到本機
│
├── content/               ← 內容都在這裡
│   ├── site.json          名字、顏色、字體、hero 文字、Information 頁
│   ├── projects.json      50 個作品
│   └── _source/           舊站匯出的原始資料（保存用，不會被讀取）
│
├── src/                   ← 樣式與腳本原始碼
│   ├── css/site.css       版面
│   ├── css/effects.css    逐字浮現、stagger、wiggle
│   ├── js/effects.js      上面那些效果的邏輯
│   └── js/site.js         信箱組裝
│
├── tools/
│   ├── check.mjs                    檢查連結、圖片屬性、標題結構
│   ├── serve.mjs                    本機預覽伺服器
│   ├── import-cargo-export.mjs      匯出資料 → projects.json
│   └── export-cargo-v4.browser.js   貼進瀏覽器 Console 用的匯出腳本
│
├── dev/effects-test.html  效果測試頁（改動畫後用這頁確認）
│
└── 以下是 build 產生的，不要手動改：
    index.html  information.html  404.html
    work/*.html  sitemap.xml  robots.txt
    assets/css/  assets/js/
```

---

## 新增一個作品

打開 `content/projects.json`，在 `projects` 陣列加一筆：

```json
{
  "slug": "My-New-Project",
  "title": "My New Project",
  "year": "2026",
  "role": "Personal work",
  "tags": [],
  "summary": "一句話，只用於搜尋結果的描述，不會顯示在頁面上",
  "thumb": { "hash": "...", "file": "cover.png", "w": 1000, "h": 800 },
  "blocks": [
    { "type": "text", "text": "第一段說明文字。" },
    { "type": "embed", "provider": "vimeo", "id": "1079279831", "autoplay": true, "loop": true },
    { "type": "media", "file": "01.png", "w": 1600, "h": 2000, "caption": "圖說" },
    { "type": "heading", "level": "h2", "text": "Credit" },
    { "type": "text", "text": "Design & Animation : Doris Lin" }
  ]
}
```

然後 `node build.mjs`。網址會是 `work/My-New-Project.html`，首頁縮圖自動出現。

### blocks 的四種型別

| type | 用途 | 欄位 |
| --- | --- | --- |
| `text` | 一段文字 | `text` |
| `heading` | 小標題（Styleframe、Credit 這類） | `level`（h2/h3）、`text` |
| `media` | 圖片或影片檔 | `file`、`w`、`h`、`caption`、`alt` |
| `embed` | Vimeo 影片 | `provider`、`id`、`autoplay`、`loop` |

**順序就是頁面上的順序**，所以圖文交錯要怎麼排就照著寫。

其他可用欄位：`draft: true` 不產生這一頁；`hideFromGrid: true` 有頁面但不出現在首頁網格（`Reel` 就是這樣）。

### 讓圖片跟著滑鼠轉

在 `media` 加 `eye`：

```json
{ "type": "media", "file": "eye.png", "eye": { "rollspeed": 0.5, "range": 1, "rotation": 0 } }
```

- `rollspeed` 0～1，越小跟得越慢（阻尼越重）
- `range` 轉動幅度，1 是完整跟隨
- `rotation` 起始角度（度）

這是從舊站的 `eyeroll.js` 移植的。舊站其實沒有在用，但功能留著。

---

## 改風格

全部在 `content/site.json`：

```json
"theme": {
  "bg": "#ffffff",
  "ink": "#000000",
  "accent": "#f02"
},
"grid": {
  "columns": 10,
  "columnsTablet": 5,
  "columnsMobile": 2
}
```

改完 `node build.mjs`。這些值會被寫成 CSS 變數注入每一頁，`src/css/site.css` 只讀變數，所以不用去翻 CSS。

換字體改 `fonts` 那一區。**`mundial` 是 Adobe Typekit（kit `kln0qcj`），kit 綁網域** —— 新網域要先到 [Adobe Fonts 後台](https://fonts.adobe.com/my_fonts#web_projects-section) 把 `dorislinwork.github.io` 和 `localhost` 加進這個 web project，否則字體不會載入。

---

## ⚠️ 圖片還依賴 Cargo，這件事要處理

目前 `site.json` 的 `media.source` 是 `"cargo"`，圖片直接連 Cargo 的 CDN。網站能跑，但**一旦停掉 Cargo 訂閱，所有圖片會全部失效**。

要真正獨立：

```bash
node download-media.mjs        # 抓 94 個檔案到 assets/media/
```

然後把 `site.json` 的 `media.source` 改成 `"local"`，再 `node build.mjs`。

> Cargo 的圖片網址是參數化的：`freight.cargo.site/w/<寬度>/q/<品質>/i/<hash>/<檔名>`。
> 所以 `projects.json` 只存 hash 與檔名，要什麼尺寸都能組出來，不必抓原始大檔。
> 想抓更大的圖：`node download-media.mjs --width 2400`。

影片不受影響 —— 34 支動畫都是 Vimeo 嵌入，本來就不在 Cargo 上。

---

## 部署

repo 與 remote 已經設定好了（`origin` 指向 `dorislinwork/dorislinwork.github.io`），第一次上線只剩：

1. 到 <https://github.com/new> 建 repo，名稱填 **`dorislinwork.github.io`**，設為 **Public**（免費帳號的 Pages 需要 public），**不要**勾任何初始化選項
2. `git push -u origin main`
3. Settings → Pages → Source 選 `Deploy from a branch`、branch `main` / `(root)` → Save

之後每次更新就是 `git add -A && git commit -m "..." && git push`，約一分鐘生效。

`.nojekyll` 已經放好，GitHub 不會對檔案做 Jekyll 處理。

### 想改用 doris-lin.com 這個網域

這個網域目前是**透過 Cargo 購買**的（DNS TXT 有 `cargo-domain=purchased`），NS 指向 `ns1/ns2.cargo.site`。要搬到 GitHub Pages 得先把網域轉出或改 DNS 代管，這件事牽涉 Cargo 帳號，**取消訂閱前務必先確認網域不會一起失去**。

搬好之後：根目錄放一個 `CNAME` 檔案（內容只寫網域），DNS 加四筆 A 記錄指向 `185.199.108.153`、`185.199.109.153`、`185.199.110.153`、`185.199.111.153`，`www` 加 CNAME 指向 `dorislinwork.github.io`。

---

## 已內建

- **逐字浮現**：所有 `h1` 自動套用，捲到才播。`0.9s cubic-bezier(0.16, 1, 0.3, 1)`
- **`.stagger-item`**：標題播完接著整段淡入
- **`.wiggle-text`**：滑過／點到逐字跳動（原站只吃 hover，這版觸控與鍵盤也會觸發）
- **emoji 安全**：用 `Intl.Segmenter` 拆字，標題裡的 🥨 不會裂掉
- **JS 壞掉也看得到文字**：隱藏樣式只有在 JS 確認要播時才加上
- **響應式圖片**：每張圖給兩種寬度的 `srcset`，手機不載大圖
- **無障礙**：跳過導覽、鍵盤焦點外框、`aria-label` 保留完整句子（螢幕閱讀器不會逐字念）、尊重「減少動態效果」
- **SEO**：`sitemap.xml`、`robots.txt`、Open Graph 分享卡片

改完動畫後用 `dev/effects-test.html` 確認，那頁把每個效果都獨立列出來並寫了該看到什麼。

送出前跑一次檢查：

```bash
node tools/check.mjs .
```

會驗連結、錨點、圖片的 `alt` 與 `width`/`height`、每頁 h1 數量、CSS 變數有沒有漏定義。
