import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  root: ".",
  server: {
    middlewareMode: true
  },
  build: {
    outDir: "dist/client",
    emptyOutDir: true
  }
});
