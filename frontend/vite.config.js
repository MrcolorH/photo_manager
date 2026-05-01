/*
 * @Author: wangjl41 wangjl41@asiainfo.com
 * @Date: 2026-05-01 03:26:09
 * @LastEditors: wangjl41 wangjl41@asiainfo.com
 * @LastEditTime: 2026-05-01 04:18:21
 * @FilePath: /相机管理后台/frontend/vite.config.js
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 9900,
    proxy: {
      '/api': {
        target: 'http://localhost:9901',
        changeOrigin: true
      },
      '/uploads': {
        target: 'http://localhost:9901',
        changeOrigin: true
      }
    }
  }
})
