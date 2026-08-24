/**
 * 🌟 LINE 外部預設瀏覽器自動跳轉模組 (LINE In-App Browser Auto Redirect)
 * 
 * 作用：
 * 1. 當用戶從 LINE 聊天室點擊連結時，自動跳轉使用手機/電腦的預設瀏覽器 (Safari / Chrome) 開啟。
 * 2. 避免用戶被困在 LINE 內嵌 Webview，遊玩時隨時可切換回 LINE 聊天，且享有原生瀏覽器的完整 GPU 硬體加速與 120Hz/60Hz 流暢度。
 */

export function handleLineRedirect() {
  const ua = navigator.userAgent || '';
  const isLine = /Line/i.test(ua);
  const currentUrl = new URL(window.location.href);

  // 若已具備 openExternalBrowser=1 參數，代表已處於跳轉指令中
  if (currentUrl.searchParams.get('openExternalBrowser') === '1') {
    return;
  }

  if (isLine) {
    // 1. 優先使用 LINE 官方跳轉參數 openExternalBrowser=1
    currentUrl.searchParams.set('openExternalBrowser', '1');
    const targetUrl = currentUrl.toString();

    // 針對 Android LINE 亦可搭配 Intent 協議直接呼叫 Chrome
    const isAndroid = /Android/i.test(ua);
    if (isAndroid) {
      const intentUrl = `intent://${location.host}${location.pathname}${location.search}${location.search ? '&' : '?'}openExternalBrowser=1#Intent;scheme=https;package=com.android.chrome;end`;
      try {
        window.location.href = intentUrl;
        return;
      } catch (e) {}
    }

    // iOS / Mac / PC LINE 跳轉
    window.location.replace(targetUrl);
  }
}

// 自動在載入時執行檢測
handleLineRedirect();
