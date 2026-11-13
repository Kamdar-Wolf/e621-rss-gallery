import {defineConfig} from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  root:"apps/web",
  plugins:[react()],
  server:{host:"127.0.0.1",port:5173,strictPort:true},
  preview:{host:"127.0.0.1",port:4173},
  build:{outDir:"../../dist-web",emptyOutDir:true}
});
