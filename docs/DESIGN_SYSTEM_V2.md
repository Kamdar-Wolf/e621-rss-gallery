# Kamdar Reader 2.0 – design systém a grafické akceptační podmínky
*Rozpracovaná specifikace, 13. 11. 2026. Nejde o pixelovou kopii cizí služby.*

## Identita
- Profesionální, věcná a obrazově orientovaná čtečka; vlastní značka Kamdar Reader.
- Priorita: čitelnost, rychlé posouvání, konzistentní stavy a malé množství zbytečných animací.
- Desktop: třípanelové uspořádání zdroje / timeline-galerie / detail. Mobil: sidebar jako drawer, detail celoobrazovkový.

## Návrhové tokeny
| Token | Dark | Light | Účel |
|---|---|---|---|
| background | #0B101B | #F6F8FC | plocha |
| surface | #101827 | #FFFFFF | sidebar/panel |
| card | #151F2F | #FFFFFF | karty |
| hover | #1C2A3D | #F0F5FC | zvýraznění |
| border | #28364A | #DCE5F0 | oddělovače |
| text | #EDF3FC | #152238 | primární čitelnost |
| muted | #99A8BE | #62738C | metadata |
| accent | #8FB5FF | #2456BA | výběr/odkazy |
| accent-background | #223957 | #E4EDFF | aktivní pozadí |

**Pozor:** Hodnoty jsou pracovní návrh; kontrast na konkrétních komponentech je nutné ověřit proti WCAG 2.2 AA.

## Typografie a prostor
- Primární: Inter nebo dostupné systémové sans-serif; možnost patkového písma v dlouhém reader režimu.
- Text: 12–16 px podle hustoty, nadpisy 20–34 px, line-height článků 1.6–1.8.
- Spacing tokeny: 4, 8, 12, 16, 24, 32, 48 px.
- Corner radius: 8, 10, 14, 20 px.
- Touch target: aspoň 44×44 CSS px v mobilním finálním rozhraní.

## Minimální komponentová knihovna
- App shell, sidebar se stromem a počty, searchbox, toolbar, context menu.
- Reader card pro varianty article/image/audio/video; stav read/unread/star/saved.
- Image tile, lightbox, multi-image gallery, zoom toolbar, fit/cover toggle.
- Article detail, rich reader (bez cizích skriptů), source metadata a attribution.
- Feed health, import wizard, empty/loading/error states, retry action.
- Modal/dialog, destructive action confirmation, toast, filter chips, list virtualizer.
- Rule builder AND/OR/NOT s testovacím náhledem, tag selector, advanced search.

## Stavové varianty
Každá komponenta má: default, hover, focus-visible, selected, disabled, loading, empty, failure/retry. Čteno/nečteno rozlišovat mimo barvy i kontrastem a ikonou; kompaktní seznam musí stále umožnit plné ovládání klávesnicí.

## Obrazové zdroje
- Umožnit masonry i pravidelnou mřížku; nastavit počet sloupců, fit/cover, maximální náhled a odstupy.
- Zobrazit kvalitní dostupný preview, ale nikdy neprezentovat umělé zvětšení jako originální rozlišení.
- Neúspěšné náhledy musí mít důvod chyby (403/404/timeout/zablokováno), otevření zdrojového URL a retry.
- GIF/animace: opt-in autoplay. Komiksy: kontinuální režim, jedna/dvě strany, RTL.

## Mobil
- 390px layout musí fungovat bez horizontálního posuvu; 2 sloupce galerie, jedno-panelový reader.
- Výběr zdroje a návrat musí zachovat pozici ve feedu.
- Gesta swipe nesmí překrývat standardní scroll/zoom nebo akce pro přístupnost.
- Offline stav výslovně vysvětlovat; nic nepředstírat.

## Grafický akceptační test
1. Vykreslit obrazovky ve 1440, 1024, 768, 390 a 320 CSS px.
2. Změřit barevný kontrast všech kombinací, zkontrolovat dynamické zvětšení textu 200 %.
3. Ověřit tab/shift-tab, enter/space, Esc, focus po zavření dialogu, screen reader labels.
4. Ověřit galerii s 0/1/50/500 položkami a smíšenými poměry stran.
5. Ověřit články s velmi dlouhými titulky, chybějícími obrázky a neplatným HTML.
6. Zajistit preference reduced motion a nezávislost na externě načítaném fontu.
7. Pro každý nový komponent schválit vizuální regresní snímky desktop/mobil/light/dark.

**Současný stav:** První React UI a návrhové tokeny jsou v `apps/web/src/styles.css`. Finální systém komponent a vysoko-věrné prototypy zatím čekají na další UX etapu.
