import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const tweakcnPreview = (): Plugin => ({
  name: "tweakcn-live-preview",
  apply: "serve",
  transformIndexHtml: () => [{ tag: "script", attrs: { src: "https://tweakcn.com/live-preview.min.js" }, injectTo: "head" }],
});

export default defineConfig({
  plugins: [react(), tailwindcss(), tweakcnPreview()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "./src") } },
  server: { proxy: { "/api": "http://localhost:8787" } },
});
