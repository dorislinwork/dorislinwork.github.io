# Doris Lin — 作品集網站

從 Cargo（doris-lin.com）搬過來的自架靜態站。**零套件依賴，不需要 `npm install`。**

上線網址：<https://dorislinwork.github.io>

---

## 新增一個作品：三步

```bash
# 1. 把圖丟進 incoming\My-New-Work\
#    檔名決定頁面順序，建議 01.png、02.png、03.gif…

# 2. 建立作品（自動轉檔、讀尺寸、寫進 projects.json）
node tools/add-project.mjs My-New-Work --title "My New Work" --year 2026

# 3. 上線
publish.cmd "新增作品 My New Work"
```

**你不需要手寫 JSON。** 詳細參數見下面〈新增一個作品〉。

## 其他常用指令

```bash
node tools/serve.mjs . 8080        本機預覽（開 http://localhost:8080）
node build.mjs                    只重新產生網站，不上線
node tools/check.mjs .            檢查連結與標記
node tools/remove-project.mjs X   移除作品 X
publish.cmd "訊息"                產生 + 檢查 + commit + push
```

`publish.cmd` 任何一步失敗就會停下來，不會把壞掉的版本推上線。

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
│   └── js/site.js         信箱組裝、影片只播畫面內的
│
├── assets/media/          圖片與動畫（14 MB）
│
├── incoming/              新作品的原始檔放這裡（不進 repo）
├── publish.cmd            產生 + 檢查 + commit + push
│
├── tools/
│   ├── add-project.mjs              新增／更新作品（自動轉檔）
│   ├── remove-project.mjs           移除作品
│   ├── check.mjs                    檢查連結、圖片屬性、標題結構
│   ├── serve.mjs                    本機預覽伺服器
│   ├── convert-gifs.mjs             動畫 GIF → MP4（需要 ffmpeg）
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

### 1. 把原始檔放進 incoming

```
incoming\
└── My-New-Work\
    ├── 01.png       ← 順序照檔名排（自然排序，2 會排在 10 前面）
    ├── 02.png
    └── 03.gif
```

直接放**未壓縮的輸出檔**就好，腳本會壓。`incoming\` 不會進 repo，原始檔留在你電腦上當備份。

支援 png / jpg / webp / tif / bmp / gif / mp4 / webm / mov。

### 2. 執行 add-project

```bash
node tools/add-project.mjs My-New-Work --title "My New Work" --year 2026
```

它會自動：

- 用 ffprobe 讀出每個檔案的實際像素尺寸
- PNG／JPG → **WebP**；GIF／影片 → **MP4** 加一張 WebP 第一幀當 poster
- 照檔名排序組出 blocks
- 寫進 `content/projects.json` 並驗證 JSON 沒壞

常用參數：

| 參數 | 說明 |
| --- | --- |
| `--title "標題"` | 顯示標題（預設由 slug 推導） |
| `--year 2026` | |
| `--role "Personal work"` | 預設就是 Personal work |
| `--client "客戶名"` | |
| `--text "說明"` | 可重複，依順序排在最前面 |
| `--vimeo 1079279831` | 可重複，排在文字之後、圖片之前 |
| `--thumb 03.gif` | 指定首頁縮圖（預設用第一個檔案） |
| `--tags "3D,Animation"` | |
| `--width 2400` | 圖片輸出寬度上限，預設 1600 |
| `--hide-from-grid` | 有頁面但不在首頁網格 |
| `--draft` | 先不產生頁面 |
| `--end` | 放到列表最後（預設插在最前面） |
| `--dry` | 只顯示會做什麼，不寫入 |

**先加 `--dry` 跑一次看看對不對**，確認了再拿掉。

同一個 slug 再跑一次是「更新」，會保留你手動編輯過的欄位（例如圖說）。

### 3. 上線

```bash
publish.cmd "新增作品 My New Work"
```

網址會是 `work/My-New-Work.html`，首頁縮圖自動出現在最前面。

### 想微調的話

`add-project.mjs` 只是幫你把 JSON 寫好，寫完之後 `content/projects.json` 就是普通的資料檔，想加圖說、換順序、插小標題都直接改它，然後 `publish.cmd`。格式看下面。

### 移除作品

```bash
node tools/remove-project.mjs My-New-Work --dry   # 先看會刪什麼
node tools/remove-project.mjs My-New-Work
```

會從 `projects.json` 移除、刪掉 `assets/media/<slug>/` 與產生的頁面。`incoming\` 裡的原始檔不會動。

**只是想暫時下架**就不要用這個 —— 在那一筆加 `"draft": true` 即可，資料會留著。

### 讓某件作品在首頁佔更大版面

在 `content/projects.json` 那一筆加兩個欄位：

```json
{ "slug": "Tommy-s-Oddly-Love", "span": 3, "ratio": "4/3" }
```

| 欄位 | 說明 |
| --- | --- |
| `span` | 桌機要佔幾欄（總共 10 欄）。不寫就是 1 |
| `ratio` | 縮圖長寬比。`1` 正方（預設）、`3/4` 直立、`4/3` 橫式、`16/9` 寬幅 |

平板與手機的欄數會依比例自動換算並夾住上限，所以放大過的作品在窄螢幕不會爆版（例：桌機 10 欄的 `span: 3` → 平板 5 欄變 2 → 手機 2 欄變 1）。

新增作品時也可以直接給：`--span 3 --ratio 4/3`

> 舊站是固定 10 欄、每格一樣大，所以這是**新增的彈性，不是還原**。不填 `span` 的話首頁跟舊站一致。

### 導覽列行為

`content/site.json` 的 `header.hideOnScroll`：

- `true`（目前）—— 往下捲收起、往上捲出現，離開頂部後加白底
- `false` —— 單純 sticky，一直留在上面

舊站的 `#tag_menu` 是 `position: absolute`，會隨頁面捲走完全消失 —— **兩個選項都跟舊站不同**，這是取捨過的改進：長頁面（你有 50 個作品）沒有導覽列會很難回到上一層。

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

## 媒體：已完全脫離 Cargo

`media.source` 已經設為 `"local"`，所有圖片與動畫都在 `assets/media/` 裡。**網站不再依賴 Cargo，停用訂閱不會影響這個站。**

容量 **14 MB**：94 個 WebP + 20 個 MP4。

### 搬移過程發現的 Cargo CDN 行為

重新抓圖時會用到，也解釋了為什麼舊站那麼重：

| 網址形式 | 結果 |
| --- | --- |
| `/w/1200/q/82/i/HASH/x.png` | 回原始 PNG，**`w` 與 `q` 完全無效**（3010 KB） |
| `/w/1200/q/82/f/webp/i/HASH/x.png` | 真的縮放並轉檔（125 KB，少 96%） |

動畫 GIF 是例外 —— Cargo 完全不處理，加 `f/webp` 也是回原檔，`f/mp4` 不支援（回 400）。所以 20 個 GIF 是用 ffmpeg 在本機轉的：**96.2 MB → 4.4 MB，省 95.4%**。

### 重新抓圖或調整品質

```bash
node download-media.mjs                # 靜態圖，自動轉 WebP
node download-media.mjs --width 2400   # 想要更大的圖
node download-media.mjs --dry          # 只列出要抓什麼
node tools/convert-gifs.mjs            # 動畫 GIF → MP4 + WebP poster
```

已存在的檔案會跳過，所以可以安全重跑。

檔名規則：靜態圖 `x.png` → `x.webp`；動畫 `x.gif` → `x.mp4` 外加 `x.webp` 當 poster。`projects.json` 裡仍然存原始檔名，build 會自己換。

`convert-gifs.mjs` 需要 ffmpeg。用 winget 裝的話不必改 PATH，腳本會自己去 `%LOCALAPPDATA%\Microsoft\WinGet\Packages` 找：

```powershell
winget install Gyan.FFmpeg
```

影片不受影響 —— 34 支動畫都是 Vimeo 嵌入，本來就不在 Cargo 上。

---

## 部署

repo 與 remote 都設好了（`origin` → `dorislinwork/dorislinwork.github.io`），已經推上去過。之後每次更新：

```bash
git add -A && git commit -m "更新內容" && git push
```

約一分鐘生效。

Pages 設定在 repo 的 Settings → Pages：Source `Deploy from a branch`、branch `main` / `(root)`。`.nojekyll` 已放好，GitHub 不會對檔案做 Jekyll 處理。

> **`_archive-v1/` 刻意排除在 repo 外**（寫在 `.gitignore`）。Pages 會把 repo 裡所有檔案公開，那是最初方向錯誤的版本，推上去會變成可瀏覽的頁面。本機還留著。

### 想改用 doris-lin.com 這個網域

這個網域目前是**透過 Cargo 購買**的（DNS TXT 有 `cargo-domain=purchased`），NS 指向 `ns1/ns2.cargo.site`。要搬到 GitHub Pages 得先把網域轉出或改 DNS 代管，這件事牽涉 Cargo 帳號 —— **取消訂閱前務必先確認網域不會一起失去。**

搬好之後：根目錄放一個 `CNAME` 檔案（內容只寫網域），DNS 加四筆 A 記錄指向 `185.199.108.153`、`185.199.109.153`、`185.199.110.153`、`185.199.111.153`，`www` 加 CNAME 指向 `dorislinwork.github.io`。

---

## 已內建

- **逐字浮現**：所有 `h1` 自動套用，捲到才播。`0.9s cubic-bezier(0.16, 1, 0.3, 1)`
- **`.stagger-item`**：標題播完接著整段淡入
- **`.wiggle-text`**：滑過／點到逐字跳動（原站只吃 hover，這版觸控與鍵盤也會觸發）
- **emoji 安全**：用 `Intl.Segmenter` 拆字，標題裡的 🥨 不會裂掉
- **JS 壞掉也看得到文字**：隱藏樣式只有在 JS 確認要播時才加上
- **響應式圖片**：每張圖給兩種寬度的 `srcset`，手機不載大圖
- **影片只播畫面內的**：首頁 20 支循環影片捲出畫面就暫停，避免同時解碼
- **無障礙**：跳過導覽、鍵盤焦點外框、`aria-label` 保留完整句子（螢幕閱讀器不會逐字念）、尊重「減少動態效果」
- **SEO**：`sitemap.xml`、`robots.txt`、Open Graph 分享卡片

改完動畫後用 `dev/effects-test.html` 確認，那頁把每個效果都獨立列出來並寫了該看到什麼。

送出前跑一次檢查：

```bash
node tools/check.mjs .
```

會驗連結、錨點、圖片的 `alt` 與 `width`/`height`、每頁 h1 數量、CSS 變數有沒有漏定義。
