import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // 載入 .env 檔案中 VITE_ 開頭的環境變數 (在 Vercel 中，會自動讀取 VERCEL_ENV)
  const env = loadEnv(mode, process.cwd(), 'VITE_');

  // 將所有 VITE_ 開頭的變數，以字串形式定義到 process.env 中
  const processEnv = {};
  for (const key in env) {
    processEnv[`process.env.${key}`] = JSON.stringify(env[key]);
  }

  return {
    plugins: [react()],
    // 這是最關鍵的一步：確保所有 VITE_ 變數在編譯時被硬編碼進程式碼
    define: processEnv,
  };
});
