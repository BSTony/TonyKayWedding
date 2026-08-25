/**
 * 🌟 LINE 外部預設瀏覽器自動跳轉模組 (LINE In-App Browser Safe Redirect)
 * 
 * 僅在首頁入口 (index.html) 檢測 LINE 內嵌環境，並引導至 Safari / Chrome 開啟。
 * 絕不在進行中的遊戲或大廳內強制干擾路由。
 */

export function handleLineRedirect() {
  const ua = navigator.userAgent || '';
  // 嚴格精準匹配 LINE / LIFF App 專屬識別碼，避免誤判 "online" 等關鍵字
  const isLine = /\bLine\/|\bLIFF\b/i.test(ua);
  const currentUrl = new URL(window.location.href);

  // 若已具備 openExternalBrowser=1 參數，或非 LINE 內嵌瀏覽器，立即退出
  if (!isLine || currentUrl.searchParams.get('openExternalBrowser') === '1') {
    return;
  }

  // 加上 LINE 官方外部跳轉參數
  currentUrl.searchParams.set('openExternalBrowser', '1');
  const targetUrl = currentUrl.toString();

  try {
    window.location.replace(targetUrl);
  } catch (e) {
    window.location.href = targetUrl;
  }
}
