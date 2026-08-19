# 個人作品集網站

純靜態網站，沒有 build 步驟、沒有套件依賴。用瀏覽器打開 `index.html` 就能看，推上 GitHub 就能上線。

```
portfolio/
├── index.html              首頁（Hero、精選作品、能力、關於摘要、聯絡）
├── about.html              關於／完整履歷
├── 404.html                找不到頁面
├── work/
│   ├── project-01.html     專案內頁 ×4
│   ├── project-02.html
│   ├── project-03.html
│   └── project-04.html
├── assets/
│   ├── css/site.css        所有樣式（顏色與字級集中在最上面的 :root）
│   ├── js/site.js          主題切換、進場動畫、手機選單
│   └── img/                圖片（目前是可替換的佔位圖）
├── robots.txt
├── sitemap.xml
└── .nojekyll               告訴 GitHub Pages 不要跑 Jekyll
```

---

## 一、先做這幾件事（把佔位內容換成你的）

HTML 裡所有要替換的地方都標了 `✏️ 替換`，用編輯器搜尋這個符號就能一個一個處理。

### 1. 名字與基本資料

| 要改什麼 | 在哪裡 |
| --- | --- |
| 名字（導覽列、頁尾、`<title>`） | `index.html`、`about.html`、`work/*.html`、`404.html` |
| 一句話定位、自我介紹 | `index.html` 的 `.hero-title` 與 `.lede` |
| 現職／專長／合作方式 | `index.html` 的 `.hero-meta` |
| 完整經歷、學歷、獲獎 | `about.html` 的 `.timeline` 區塊 |

要一次改掉所有頁面的名字，可以在專案資料夾開終端機執行：

```bash
# 把 Doris Lin 換成你的名字
grep -rl "Doris Lin" --include="*.html" . | xargs sed -i "s/Doris Lin/你的名字/g"
```

### 2. 信箱

搜尋 `data-user` 會找到兩處（`index.html` 與 `about.html`）：

```html
<a class="contact-mail mailto" data-user="hello" data-domain="example.com">hello@example.com</a>
```

把 `data-user` 換成 `@` 前面那段、`data-domain` 換成後面那段。這樣拆開寫是為了讓爬垃圾信地址的機器人抓不到，`mailto:` 連結會由 JS 在瀏覽器端組起來。

### 3. 社群連結

搜尋 `socials`，把 `href="#"` 換成實際網址。用不到的整行 `<li>` 直接刪掉。

### 4. 圖片

`assets/img/` 目前放的是自動產生的 SVG 佔位圖，請換成你的實際作品圖。

| 檔名 | 用途 | 建議尺寸 |
| --- | --- | --- |
| `project-0X-thumb.*` | 首頁作品縮圖 | 1200 × 900（4:3） |
| `project-0X-hero.*` | 專案頁滿版主視覺 | 1920 × 1080（16:9） |
| `project-0X-01.*` | 專案頁橫式過程圖 | 1600 × 1000 |
| `project-0X-02/03.*` | 專案頁並排直式圖 | 1000 × 1250 |
| `portrait.*` | 個人照 | 1000 × 1000（正方） |
| `og-cover.*` | 社群分享縮圖 | 1200 × 630 |
| `favicon.svg` | 瀏覽器頁籤小圖 | 64 × 64 |

換圖時記得：

- 檔名可以沿用（副檔名改成 `.jpg` / `.webp` 就好），但要一併修改 HTML 裡的 `src`
- **一定要更新 `<img>` 上的 `width` 與 `height`**，數字填實際像素。這兩個屬性讓瀏覽器先保留空間，避免圖片載入時版面亂跳
- 也要更新 `alt`，用一句話描述圖片內容（給搜尋引擎和使用螢幕閱讀器的人看）
- 上傳前把照片壓過：長邊不超過 2000px、用 `.webp` 或品質 80 的 `.jpg`，單張控制在 300KB 以內

---

## 二、想改風格

打開 `assets/css/site.css`，最上面的 `:root` 就是整站的設計變數：

```css
--accent: #B8482A;   /* 主色：連結、強調、數字 */
--bg:     #F8F5F0;   /* 底色 */
--ink:    #14110E;   /* 主文字 */
```

改這幾行整站就會跟著變。深色模式的對應值在下方 `@media (prefers-color-scheme: dark)` 與 `:root[data-theme="dark"]` 兩個區塊——**兩邊都要改**，前者負責跟隨系統，後者負責右上角的手動切換按鈕。

換字體：改 `--font-display`（大標題，目前是襯線體）與 `--font-sans`（正文），並同步更新每個 HTML 檔 `<head>` 裡的 Google Fonts 連結。

---

## 三、新增一個作品

1. 複製 `work/project-01.html` → `work/project-05.html`，把裡面的文字與圖片路徑換掉
2. 在檔案最下方的「下一個專案」把 `href` 指向下一個要串的專案頁
3. 回到 `index.html`，複製一整個 `<a class="work-card">…</a>` 區塊貼在後面，改掉 `href`、圖片、標題、年份、標籤
4. 到 `sitemap.xml` 補上一行

刪除作品就是反過來：刪掉 `work/` 裡的檔案、`index.html` 的卡片、`sitemap.xml` 的那一行，並確認沒有其他頁面的「下一個專案」還指向它。

---

## 四、本機預覽

最簡單的方式是直接雙擊 `index.html`。不過用本機伺服器開會更接近上線後的狀態（`404.html` 與絕對路徑才會正常）：

```bash
# 在 portfolio 資料夾執行，然後開 http://localhost:8080
npx serve -l 8080 .
```

---

## 五、部署到 GitHub Pages

### 第一次上線

1. 到 <https://github.com/new> 建一個 repo。**Repository name 要填 `你的帳號.github.io`**（例如帳號是 `dorislin`，就填 `dorislin.github.io`），設為 Public，不要勾任何初始化選項。

2. 在 `portfolio` 資料夾執行（把 `你的帳號` 換掉）：

   ```bash
   git init -b main
   git add .
   git commit -m "First version of my portfolio"
   git remote add origin https://github.com/你的帳號/你的帳號.github.io.git
   git push -u origin main
   ```

3. 到 repo 的 **Settings → Pages**，Source 選 `Deploy from a branch`，branch 選 `main` / `(root)`，按 Save。

4. 等一兩分鐘，網站就在 `https://你的帳號.github.io` 上線了。

> 用 `你的帳號.github.io` 這個名字的好處是網址最短，而且不需要處理子路徑問題。如果你想用別的 repo 名稱（例如 `portfolio`），網址會變成 `你的帳號.github.io/portfolio/`，這時要把 `404.html` 裡開頭是 `/` 的三個路徑改成相對路徑。

### 之後每次更新

```bash
git add .
git commit -m "更新作品內容"
git push
```

推上去約一分鐘後自動生效。

### 上線後補這三件事

1. `index.html` 的 `<link rel="canonical">` 和 `og:image` 換成實際網址
2. `robots.txt` 與 `sitemap.xml` 裡的 `https://example.github.io` 全部換成實際網址
3. 用手機開一次確認版面正常

### 想用自己的網域

在 repo 根目錄新增一個檔名為 `CNAME` 的檔案（沒有副檔名），內容只寫網域，例如：

```
dorislin.design
```

然後到網域商後台加 DNS 記錄：

- 根網域（`dorislin.design`）：加四筆 `A` 記錄，指向 `185.199.108.153`、`185.199.109.153`、`185.199.110.153`、`185.199.111.153`
- `www` 子網域：加一筆 `CNAME` 指向 `你的帳號.github.io`

DNS 生效可能要幾小時。生效後回到 Settings → Pages 勾選 **Enforce HTTPS**。

---

## 六、已經內建的東西

- **深／淺色模式**：預設跟隨系統，右上角按鈕可手動切換，選擇會記在瀏覽器裡
- **響應式**：字級用 `clamp()` 平滑縮放，手機版導覽會收成漢堡選單
- **無障礙**：跳過導覽連結、鍵盤焦點外框、圖片 `alt`、`aria` 標註；尊重「減少動態效果」系統設定
- **進場動畫**：捲到畫面內才淡入。任何元素加上 `data-reveal` 屬性即生效；加 `data-reveal="now"` 則不延遲
- **列印樣式**：`about.html` 直接 Ctrl+P 就是一份乾淨的履歷
- **SEO 基本盤**：`<title>`、`description`、Open Graph 分享卡片、`sitemap.xml`、`robots.txt`
