import { defineConfig } from 'vite'

// Project Pages: https://omegarusdev.github.io/apex-auto-racer/
// Local / preview keep root base.
const pagesBase = process.env.GITHUB_PAGES === 'true' ? '/apex-auto-racer/' : '/'

export default defineConfig({
  base: pagesBase,
  build: {
    target: 'es2022',
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: false,
      },
      format: {
        comments: false,
      },
    },
  },
})
