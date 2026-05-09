import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
const buildId=process.env.APP_BUILD_ID||String(Date.now())
const versionAssetPlugin=()=>({name:'version-asset',generateBundle(){this.emitFile({type:'asset',fileName:'version.json',source:JSON.stringify({buildId})})}})
export default defineConfig({
  define:{'import.meta.env.VITE_APP_BUILD_ID':JSON.stringify(buildId)},
  plugins: [react(), tailwindcss(), versionAssetPlugin()],
  test: { environment: 'jsdom', setupFiles: './src/test/setup.js' },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8002', changeOrigin: true },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 5174,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8002', changeOrigin: true },
    },
  },
})
