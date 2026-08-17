// 版本與建置資訊
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'v2.1.0';
export const BUILD_TIME = typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : new Date().toLocaleDateString('zh-TW');

console.log(
  `%c🏸 KAY & TONY WEDDING %c ${APP_VERSION} (${BUILD_TIME}) `,
  'background:#7c3aed; color:#fff; font-weight:bold; padding:2px 8px; border-radius:4px 0 0 4px;',
  'background:#1e1b4b; color:#a78bfa; padding:2px 8px; border-radius:0 4px 4px 0; border:1px solid #7c3aed;'
);

// 自動於畫面底部插入版本標籤
document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('app-version-badge')) return;
  const badge = document.createElement('div');
  badge.id = 'app-version-badge';
  badge.innerHTML = `<span>🏷️ ${APP_VERSION}</span> • <span>${BUILD_TIME}</span>`;
  badge.style.cssText = `
    position: fixed;
    bottom: 6px;
    right: 8px;
    font-size: 10px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: rgba(255, 255, 255, 0.45);
    background: rgba(15, 23, 42, 0.65);
    backdrop-filter: blur(4px);
    padding: 2px 8px;
    border-radius: 12px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    pointer-events: none;
    z-index: 99999;
    letter-spacing: 0.3px;
  `;
  document.body.appendChild(badge);
});
