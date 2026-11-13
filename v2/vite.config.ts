import {defineConfig} from "vite";
import react from "@vitejs/plugin-react";
import {readFileSync} from "node:fs";

// Include the exact hashed web assets from this build in the offline shell.
// API responses and third-party images are explicitly excluded.
function offlineShell(){
  return {
    name:"kamdar-offline-shell",
    apply:"build" as const,
    generateBundle(_options:unknown,bundle:Record<string,unknown>){
      const files=Object.keys(bundle)
        .filter(name=>/\.(?:js|css|svg|png|webp|woff2?)$/i.test(name))
        .map(name=>"/"+name);
      const precache=["/","/index.html",...files];
      const template=readFileSync(new URL("./apps/web/sw-template.js",import.meta.url),"utf8");
      this.emitFile({type:"asset",fileName:"sw.js",
        source:template.replace("__PRECACHE_URLS__",JSON.stringify(precache))});
    }
  };
}
export default defineConfig({
  root:"apps/web",
  plugins:[react(),offlineShell()],
  server:{host:"127.0.0.1",port:5173,strictPort:true,
    proxy:{"/api":{target:"http://127.0.0.1:3100",
      changeOrigin:false,rewrite:(path)=>path.replace(/^\/api/,"")}}},
  preview:{host:"127.0.0.1",port:4173},
  build:{outDir:"../../dist-web",emptyOutDir:true}
});
