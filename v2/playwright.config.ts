import {defineConfig,devices} from "@playwright/test";
export default defineConfig({
 testDir:"tests/e2e",timeout:45000,expect:{timeout:12000},fullyParallel:false,
 workers:1,retries:process.env.CI?1:0,
 reporter:process.env.CI?[["github"],["html",{open:"never"}]]:"list",
 use:{baseURL:"http://127.0.0.1:5173",trace:"retain-on-failure",screenshot:"only-on-failure",serviceWorkers:"allow"},
 projects:[
  {name:"chromium-desktop",use:{...devices["Desktop Chrome"]}},
  {name:"firefox-desktop",use:{...devices["Desktop Firefox"]}},
  {name:"android-emulation",use:{...devices["Pixel 7"]}}
 ],outputDir:"test-results"
});