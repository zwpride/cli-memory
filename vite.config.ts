import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { codeInspectorPlugin } from "code-inspector-plugin";
import pkg from "./package.json" with { type: "json" };

const backendPort = Number(process.env.CC_SWITCH_PORT || 17666);

export default defineConfig(({ command, mode }) => {
  const isWebMode = mode === "web";
  const platformSuffix = isWebMode ? "web" : "tauri";

  return {
    root: "src",
    plugins: [
      command === "serve" &&
        codeInspectorPlugin({
          bundler: "vite",
        }),
      react(),
    ].filter(Boolean),
    base: "./",
    build: {
      outDir: "../dist",
      emptyOutDir: true,
    },
    server: {
      port: 3000,
      strictPort: true,
      proxy: {
        "/api": {
          target: `http://127.0.0.1:${backendPort}`,
          changeOrigin: true,
          ws: true,
        },
      },
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
        "@platform/bootstrap": path.resolve(
          __dirname,
          `./src/platform/bootstrap.${platformSuffix}.ts`,
        ),
        "@platform/transport-impl": path.resolve(
          __dirname,
          `./src/lib/transport/transport.impl.${platformSuffix}.ts`,
        ),
        "@platform/updater-impl": path.resolve(
          __dirname,
          `./src/lib/updater.${platformSuffix}.ts`,
        ),
        "@platform/platform-paths-impl": path.resolve(
          __dirname,
          `./src/lib/platform-paths.${platformSuffix}.ts`,
        ),
      },
    },
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    clearScreen: false,
    envPrefix: ["VITE_", "TAURI_"],
  };
});
