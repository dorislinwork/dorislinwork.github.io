# Doris Lin — 作品集網站

從 Cargo（doris-lin.com）搬過來的自架靜態站。**零套件依賴，不需要 `npm install`。**

上線網址：<https://dorislinwork.github.io>

---

## 最簡單的用法：開後台

在檔案總管裡雙擊 **`admin.cmd`**（或在這個資料夾執行 `admin.cmd`）。瀏覽器會自己打開，然後就都用滑鼠操作，不用碰命令列也不用手寫 JSON：

| 分頁 | 能做什麼 |
| --- | --- |
| **作品** | 調順序、改標題／年份／敘述／圖說、換首頁縮圖、改卡片顏色、設成草稿、補圖、移除 |
| **新增作品** | 把檔案拖進來、填標題就建立。轉檔（GIF → MP4、圖片 → WebP）與取卡片顏色都自動 |
| **版面設定** | `content/site.json` 的每個欄位都變成表單，欄位下面的灰字就是 json 裡自己的 `_說明` |
| **發布** | 產生 → 檢查 → commit → push，跟 `publish.cmd` 同一套 |

要關掉後台：在那個黑色視窗按 **Ctrl+C**。

三件值得知道的事：

- 後台**只有這台電腦連得到**（綁在 127.0.0.1）。它可以改檔案還能 push，所以刻意不讓同一個 wifi 上的人連進來。手機上改不了。
- 改完按「儲存」才會寫進 `content/*.json`。改壞了按「放棄變更」，已經存了就用 `git checkout content/`。
- 後台不是另一套邏輯，它就是下面那些指令的介面 —— 兩邊改的是同一份 `content/*.json`，混著用沒問題。

連接埠被占用（多半是已經開過一個沒關）就指定別的：`node tools/admin.mjs 4322`

---

## 用指令新增一個作品：三步

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
admin.cmd                         開後台（推薦，什麼都能做）
node tools/serve.mjs . 8080        本機預覽（開 http://localhost:8080）
node build.mjs                    只重新產生網站，不上線
node tools/check.mjs .            檢查連結與標記
node tools/set-card-colors.mjs    補首頁色塊顏色（新增作品後會自動跑）
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
├── admin.cmd              開後台
├── publish.cmd            產生 + 檢查 + commit + push
│
├── tools/
│   ├── admin.mjs                    後台：伺服器與 API
│   ├── admin-ui.html                後台：介面（只有後台在跑時才有用）
│   ├── add-project.mjs              新增／更新作品（自動轉檔）
│   ├── remove-project.mjs           移除作品
│   ├── check.mjs                    檢查連結、圖片屬性、標題結構
│   ├── set-card-colors.mjs          從縮圖取平均色，算首頁滑過的色塊顏色
│   ├── serve.mjs                    本機預覽伺服器
│   ├── convert-gifs.mjs             動畫 GIF → MP4（需要 ffmpeg）
│   ├── import-cargo-export.mjs      匯出資料 → projects.json
│   ├── export-cargo-v4.browser.js   貼進瀏覽器 Console 用的匯出腳本
│   │
│   ├── lib-media.mjs                轉檔規則與編碼參數（add-project 與後台共用）
│   ├── lib-json.mjs                 讀寫 content/*.json 而不破壞排版（見下）
│   ├── lib-mime.mjs                 副檔名 → Content-Type（serve 與後台共用）
│   └── lib-ffmpeg.mjs               找 ffmpeg／ffprobe
│
├── dev/effects-test.html  效果測試頁（改動畫後用這頁確認）
│
└── 以下是 build 產生的，不要手動改：
    index.html  information.html  404.html
    work/*.html  sitemap.xml  robots.txt
    assets/css/  assets/js/
```

### 寫 content/*.json 一定要走 lib-json.mjs

`site.json` 是**手排的** —— 區塊之間有空行、`nav` 那種短物件寫成一行，而且到處都是 `_說明`。直接用 `JSON.stringify(obj, null, 2)` 存回去會把排版整份沖成機器格式，那個檔案就再也不能靠手改，git 記錄也會被沒意義的重排洗掉。

`projects.json` 相反，它一直都是機器產生的（縮排 2、沒有空行），`JSON.stringify` 剛好一字不差。

所以：

```js
import { writeJson, writeSiteJson } from './lib-json.mjs';
writeJson(PROJECTS, data);      // projects.json：機器格式
writeSiteJson(SITE, data);      // site.json：照原本的手排風格
```

兩個都會沿用檔案原本的行尾，而且都是「先寫暫存檔 → parse 驗證 → 才換掉本尊」，寫壞了本尊還是完好的。

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

### 首頁版面

2026-08-20 起首頁改成參考 [bito.tv](https://bito.tv) 的版型（舊站是 10 欄小方格）：

- 12 欄網格，每件作品佔 4 欄 → **一行三格**。1100px 以下一行兩格、620px 以下一行一格
- 縮圖比例 `631 / 348`（Bito 的原始值），左右邊界 40px，內容寬度上限 1600px 居中
- 一部分縮圖是**佔兩列高的直式卡**，版面才不是死板的方格
- 滑過縮圖時，**該件作品自己的顏色**由上往下蓋住整張圖，標題與年份延遲 0.3 秒浮現。手機不用色塊，標題顯示在圖片下方

要調整就改 `content/site.json` 的 `grid`（每個欄位都有 `_說明`）：

| 欄位 | 說明 |
| --- | --- |
| `span` | 桌機每件佔幾欄。`4` = 一行三格、`6` = 一行兩格、`3` = 一行四格 |
| `spanTablet` / `spanMobile` | 1100px 以下、620px 以下各佔幾欄 |
| `ratio` | 縮圖比例。`631 / 348` 寬幅、`1` 正方、`4 / 3` 橫式、`3 / 4` 直立 |
| `gutter` / `pad` / `maxWidth` | 欄距、左右邊界、內容寬度上限。**本站 1rem = 10px** |
| `tall.enabled` | `false` = 取消直式高卡，全部一樣大 |
| `showTitles` | `false` = 完全不顯示標題文字 |

**個別作品**想跟其他人不一樣，在 `content/projects.json` 那一筆加：

```json
{ "slug": "Tommy-s-Oddly-Love", "span": 8, "ratio": "4 / 3", "cardColor": "#f02" }
```

| 欄位 | 說明 |
| --- | --- |
| `span` | 這一件在桌機佔幾欄（12 欄裡）。也可加 `spanTablet` / `spanMobile` |
| `ratio` | 這一件的縮圖比例 |
| `cardColor` | 滑過時的色塊顏色。不寫的話由 `tools/set-card-colors.mjs` 自動取色 |
| `cardColorDark` | `true` = 色塊上的文字用黑色（淺色底才需要） |

新增作品時也可以直接給：`--span 8 --ratio "4 / 3"`

### 滑過縮圖的色塊顏色

每件作品的顏色是**從它自己的縮圖取平均色**再拉飽和度算出來的，存在 `projects.json` 的 `cardColor`。

```
node tools/set-card-colors.mjs           只補還沒有顏色的（add-project.mjs 會自動跑）
node tools/set-card-colors.mjs --force   全部重算
node tools/set-card-colors.mjs --dry     只看結果不寫檔
```

**不喜歡某一件的顏色就直接改 `projects.json` 裡的 `cardColor`**，這支工具不會覆蓋已經填好的值（除非加 `--force`）。淺色底看不清白字時加 `"cardColorDark": true` 讓文字變黑。

先算好存進 json 而不是每次 build 現算，是為了讓 `build.mjs` 保持零依賴、幾百毫秒跑完，而且顏色是設計決定，存成資料才改得動。

### 哪幾件會變成直式高卡

`build.mjs` 自己挑，規則是：

1. **原本就是直式的作品優先**（比例低於 `tall.portraitMax`，預設 0.95）—— 那樣不必把直式圖裁成橫式，是同一套素材下最省裁切的分配
2. 其餘每隔 `tall.minGap` 件放一張
3. 高卡在三欄之間輪替，一列最多兩張
4. 挑完會**模擬 CSS 自動排版驗證不留空洞** —— 高卡佔兩列，位置沒排好就會在網格中間留下永久空格

build 會印出結果（例：`首頁 49 張縮圖、一行 3 格、11 張直式高卡、20 列、無空格`）。如果出現 `⚠ N 個空格`就是有問題，跟我說或把 `tall.enabled` 設成 false。

> 直式高卡的圖是**裁切**的。Bito 之所以好看是因為他們每件作品在後台另外備了直式素材；這裡只有一套。想做到那樣得針對高卡的作品重新輸出直式構圖。

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
  "columns": 12,
  "span": 4,
  "ratio": "631 / 348"
}
```

改完 `node build.mjs`。這些值會被寫成 CSS 變數注入每一頁，`src/css/site.css` 只讀變數，所以不用去翻 CSS。首頁網格的完整說明見上面〈首頁版面〉。

換字體改 `fonts` 那一區。`mundial` 是 Adobe Typekit（kit `kln0qcj`），目前只用在圖說（`--font-caption`），標題與正文是 DM Sans。

> 2026-08-20 實測：這個 kit 的 CSS 與字體檔用 `dorislinwork.github.io` 或隨便一個網域當 referer 都回 200，**實際上沒有鎖網域**，所以 `mundial` 在線上應該正常載入。Adobe 文件上寫 kit 要綁網域，如果哪天真的掉字了，就到 [Adobe Fonts 後台](https://fonts.adobe.com/my_fonts#web_projects-section) 把網域和 `localhost` 加進這個 web project。

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
