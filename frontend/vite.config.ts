import { defineConfig, loadEnv } from 'vite';

/**
 * Docker Desktop монтирует исходники с Windows-хоста (bind mount), и inotify
 * внутри контейнера иногда теряет события изменения файлов. Из-за этого
 * dev-сервер продолжал отдавать старые модули: код на диске был исправлен,
 * а браузер выполнял предыдущую версию (например, старый парсинг очереди,
 * из-за которого у оператора отображалось «0 талонов», хотя в БД талоны есть).
 * Опрос файловой системы держит dev-сервер синхронным с рабочей копией.
 *
 * Прокси /api → бэкенд: все запросы к /api/* перенаправляются на бэкенд
 * через тот же origin (port 5173). Это необходимо, чтобы SameSite=Lax cookie
 * корректно передавалась браузером — при кросс-доменных запросах (5173 vs 8080)
 * браузер блокирует cookie, из-за чего после логина сессия не подхватывалась.
 */

export default defineConfig(({ mode }) => ({
  define: {
    'import.meta.env.PUBLIC_APP_BASE_URL': JSON.stringify(
      loadEnv(mode, process.cwd(), '').PUBLIC_APP_BASE_URL ||
        process.env.PUBLIC_APP_BASE_URL ||
        ''
    ),
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    watch: {
      usePolling: true,
      interval: 300,
      ignored: ['**/node_modules/**', '**/.git/**'],
    },
    proxy: {
      '/health': {
        target: 'http://backend:8080' ? (process.env.VITE_BACKEND_TARGET || 'http://localhost:8080') : 'http://backend:8080',
        changeOrigin: true,
      },
      '/ready': {
        target: 'http://backend:8080' ? (process.env.VITE_BACKEND_TARGET || 'http://localhost:8080') : 'http://backend:8080',
        changeOrigin: true,
      },
      '/api': {
        target: 'http://backend:8080' ? (process.env.VITE_BACKEND_TARGET || 'http://localhost:8080') : 'http://backend:8080',
        changeOrigin: true,
      },
      '/grafana': {
        target: 'http://grafana:3000' ? (process.env.VITE_GRAFANA_TARGET || 'http://localhost:3001') : 'http://grafana:3000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
}));
