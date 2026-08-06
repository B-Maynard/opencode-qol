import { sentryVitePlugin } from "@sentry/vite-plugin"
import { defineConfig } from "vite"
import desktopPlugin from "./vite"

const sentry =
  process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT
    ? sentryVitePlugin({
        authToken: process.env.SENTRY_AUTH_TOKEN,
        org: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,
        telemetry: false,
        release: {
          name: process.env.SENTRY_RELEASE ?? process.env.VITE_SENTRY_RELEASE,
        },
        sourcemaps: {
          assets: "./dist/**",
          filesToDeleteAfterUpload: "./dist/**/*.map",
        },
      })
    : false

// Propagate backend PORT to the frontend SDK so `PORT=5000 bun dev` works end-to-end.
if (process.env.PORT && !process.env.VITE_OPENCODE_SERVER_PORT) {
  process.env.VITE_OPENCODE_SERVER_PORT = process.env.PORT
}

export default defineConfig({
  plugins: [desktopPlugin, sentry] as any,
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    port: Number(process.env.PORT ?? process.env.VITE_PORT ?? 3000),
  },
  build: {
    target: "esnext",
    sourcemap: true,
  },
})
