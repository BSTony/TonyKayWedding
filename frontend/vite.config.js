// Author: Tony Hsieh
// Date: 2026-08-27
// Version: 2.3.10
import { defineConfig } from 'vite';
import { resolve } from 'path';

const now = new Date();
const buildTime = now.toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei' }) + ' ' + 
  now.toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit' });

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify('v2.3.10'),
    __BUILD_TIME__: JSON.stringify(buildTime)
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        nickname: resolve(import.meta.dirname, 'nickname.html'),
        lobby: resolve(import.meta.dirname, 'lobby.html'),
        game: resolve(import.meta.dirname, 'game.html'),
        tournament: resolve(import.meta.dirname, 'tournament.html'),
        ranked: resolve(import.meta.dirname, 'ranked.html'),
        ranking: resolve(import.meta.dirname, 'ranking.html'),
        host: resolve(import.meta.dirname, 'host.html'),
      }
    }
  }
});
