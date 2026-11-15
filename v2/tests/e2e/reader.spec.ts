import {expect,test,type Page} from "@playwright/test";
const article="Ukázkový článek čtečky 2.0";
const password=process.env.E2E_PASSWORD||"example-e2e-long-password-1234";
const offlinePassword="offline-test-secret-very-long-4567";
async function signIn(page:Page){
 await page.goto("/");
 await expect(page.getByRole("button",{name:"Přihlásit se"})).toBeVisible();
 await page.getByLabel("Uživatelské jméno").fill("owner");
 await page.getByLabel("Heslo",{exact:true}).fill(password);
 await page.getByRole("button",{name:"Přihlásit se"}).click();
 await expect(page.getByRole("button",{name:"Otevřít "+article})).toBeVisible();
}
test("login, demo RSS article and two-page media gallery",async({page})=>{
 await page.route("https://images.example.org/**",route=>route.fulfill({
  contentType:"image/png",body:Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLTTAAAAABJRU5ErkJggg==","base64")
 }));
 await signIn(page);
 await page.getByRole("button",{name:"Otevřít "+article}).click();
 const reader=page.getByRole("dialog",{name:"Detail příspěvku"});
 await expect(reader.getByRole("heading",{name:article})).toBeVisible();
 await expect(reader.getByText("1 / 2")).toBeVisible();
 await reader.getByRole("button",{name:"Další médium"}).click();
 await expect(reader.getByText("2 / 2")).toBeVisible();
 await reader.getByRole("button",{name:"Zvětšit obrázek"}).click();
 await expect(page.getByRole("dialog",{name:"Zvětšený obrázek 2"})).toBeVisible();
 await page.keyboard.press("Escape");
 await expect(page.getByRole("dialog",{name:"Zvětšený obrázek 2"})).toHaveCount(0);
});
test("navigation works in emulated Android",async({page,isMobile})=>{
 test.skip(!isMobile,"Mobile viewport only");
 await signIn(page);
 await page.getByRole("button",{name:"Otevřít navigaci"}).click();
 await expect(page.getByRole("button",{name:/Nepřečtené/})).toBeVisible();
 await page.getByRole("button",{name:/Nepřečtené/}).click();
 await expect(page.getByRole("heading",{name:"Nepřečtené"})).toBeVisible();
});
test("PWA shell and encrypted vault survive offline restart",async({page,context,browserName,isMobile})=>{
 test.skip(browserName!=="chromium"||isMobile,"Desktop Chromium PWA only");
 await signIn(page);
 await expect.poll(async()=>page.evaluate(async()=>{
  await navigator.serviceWorker.ready;
  return (await caches.keys()).some(k=>k.startsWith("kr-app-shell-"));
 }),{timeout:20000}).toBeTruthy();
 await page.getByRole("button",{name:"Zapnout offline články"}).click();
 const dialog=page.getByRole("dialog",{name:"Šifrovaná offline knihovna"});
 await dialog.getByLabel("Offline heslo (minimálně 12 znaků)").fill(offlinePassword);
 await dialog.getByLabel("Potvrdit offline heslo").fill(offlinePassword);
 await dialog.getByRole("button",{name:"Vytvořit trezor"}).click();
 await expect(dialog).toHaveCount(0);
 await expect(page.getByRole("button",{name:"Otevřít "+article})).toBeVisible();
 await page.getByRole("button",{name:"Odhlásit"}).click();
 await expect(page.getByRole("heading",{name:"Odemknout offline knihovnu"})).toBeVisible();
 await context.setOffline(true);
 await page.reload();
 await expect(page.getByRole("heading",{name:"Odemknout offline knihovnu"})).toBeVisible();
 await page.getByLabel("Samostatné offline heslo").fill(offlinePassword);
 await page.getByRole("button",{name:"Odemknout bez serveru"}).click();
 await expect(page.getByText("Offline knihovna je odemčená jen místním heslem.")).toBeVisible();
 await expect(page.getByRole("button",{name:"Otevřít "+article})).toBeVisible();
});