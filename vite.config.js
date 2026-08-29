import { defineConfig } from "vite"

export default defineConfig({
  server: {
    host: true,
    port: 3000,
    strictPort: false,
    // Allow the v0 / Vercel sandbox preview hosts (e.g. *.vercel.run)
    allowedHosts: true,
  },
  preview: {
    host: true,
    allowedHosts: true,
  },
})
