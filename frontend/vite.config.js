import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        nickname: resolve(import.meta.dirname, 'nickname.html'),
        lobby: resolve(import.meta.dirname, 'lobby.html'),
        game: resolve(import.meta.dirname, 'game.html'),
        tournament: resolve(import.meta.dirname, 'tournament.html'),
        ranking: resolve(import.meta.dirname, 'ranking.html'),
        host: resolve(import.meta.dirname, 'host.html'),
      }
    }
  }
});
