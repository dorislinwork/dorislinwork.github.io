# incoming — 新作品的原始檔放這裡

## 怎麼用

1. 在這個資料夾底下建一個以作品網址命名的資料夾，例如 `My-New-Work`
2. 把圖片、GIF 或影片丟進去。**檔名決定頁面上的順序**，所以建議命名成
   `01.png`、`02.png`、`03.gif`…（會用自然排序，`2` 排在 `10` 前面）
3. 回到專案根目錄執行：

   ```
   node tools/add-project.mjs My-New-Work --title "My New Work" --year 2026
   ```

4. `publish.cmd "新增作品 My New Work"`

支援 png / jpg / webp / tif / bmp / gif / mp4 / webm / mov。
腳本會自動壓成 WebP（靜態）或 MP4（動態），所以這裡可以直接放未壓縮的輸出檔。

## 這裡的檔案不會進 repo

只有這個 README 會。原始檔留在你電腦上當備份，不會被上傳，
所以不用擔心 repo 變大。要清空隨時可以直接刪。
