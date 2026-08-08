# 土地測量資料分享系統－GitHub Pages 版本

這是與原 ASP.NET Core 網站完全分開的靜態版本。它保留原地圖介面，並以 Supabase 提供會員登入、共同資料庫、照片儲存與即時同步。CT2 檔案只在瀏覽器解析，原檔不會上傳。

## 1. 建立 Supabase

1. 建立一個免費 Supabase project。
2. 開啟 SQL Editor，貼上並執行 `supabase/schema.sql`。
3. 到 Authentication → URL Configuration，把 GitHub Pages 網址加入 Site URL 與 Redirect URLs。
4. 到 Project Settings → API Keys，複製 Project URL 與 Publishable key。
5. 將兩個值填入 `js/config.js`。請勿使用 Secret key 或 `service_role` key。

## 2. 發布到 GitHub Pages

1. 在 GitHub 建立新的 repository，不要使用原網站的 repository。
2. 把這個資料夾的內容上傳到 repository 根目錄。
3. 到 Settings → Pages。
4. Source 選擇 Deploy from a branch，Branch 選 `main`、資料夾選 `/ (root)`。
5. 發布後網址為 `https://你的帳號.github.io/repository名稱/`。

## 3. 會員與共同編輯

- 會員可在登入頁建立帳號；是否要求 Email 驗證由 Supabase Authentication 設定控制。
- 所有已登入會員都可查看、新增、修改及永久刪除共同點位和備註。
- 多人同時開啟網站時，新增、修改與刪除會透過 Realtime 自動同步。
- 照片存於私有 Storage bucket，頁面使用有時效的簽署網址顯示。

## 注意

- GitHub Pages 只負責網頁，Supabase 負責會員與資料。
- 原 ASP.NET Core 網站及其 PostgreSQL 資料庫不會被這個版本修改。
- 原資料庫內容不會自動出現在新站；若要搬移，需另做一次資料匯入。
- 地籍段圖層目前會保持空白，因為原 ZIP 沒有包含段界資料；其他核心功能可獨立運作。
