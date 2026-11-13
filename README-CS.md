# e621 RSS s náhledy – návod

Tato sada převádí původní kanál e621 `/posts.atom` na RSS 2.0 se značkami `media:thumbnail` a `enclosure`. Obrázky **nestahuje ani neukládá** na GitHub; jsou to odkazy na e621.

## Instalace přes GitHub

1. Na GitHubu vytvoř nové **veřejné** úložiště `e621-rss-gallery` (nepoužívej existující úložiště se skripty).
2. Nahraj obsah rozbaleného ZIPu do kořene úložiště. Důležité: podsložka `.github/workflows/` musí být skutečně zachována. Pokud GitHub při nahrávání složky neudrží, vytvoř soubor `.github/workflows/publish.yml` ručně přes **Add file → Create new file** a vlož obsah souboru z balíčku. Dále je potřeba nahrát `build_feed.py` a `public/index.html`.
3. V **Settings → Pages → Build and deployment → Source** zvol `GitHub Actions`.
4. V **Actions → Publish e621 RSS with image previews → Run workflow** spusť první běh.
5. Pokud skončí zeleným zaškrtnutím, otevři `https://UZIVATEL.github.io/e621-rss-gallery/feed.xml` (nahraď UZIVATEL svým uživatelským jménem) a vlož tuto adresu do Folo nebo Inoreaderu.

## Diagnostika

- Pokud běh selže na `HTTP Error 403`, e621 blokuje i GitHub Actions a není vhodné to dál obcházet výměnou `User-Agent`. Stejný generátor lze spustit na vlastním PC a výstup veřejně publikovat. Přístup počítače k API přes prohlížeč ale zatím neprokazuje přístup z Pythonu.
- Pokud skript vypíše `NO embedded images`, e621 změnilo formát obsahu Atom a je potřeba upravit parsování, než RSS vydáme.
- Veřejné úložiště i jeho seznam značek může vidět kdokoli. Použití GitHub Pages podléhá pravidlům pro obsah, včetně materiálu pro dospělé.
- GitHub může plánovanou úlohu ve veřejném úložišti vypnout po 60 dnech nečinnosti. V tom případě je nutné ji znovu povolit nebo aktualizovat úložiště.
- Automatický běh je plánován jednou za hodinu (17. minuta UTC), může se zpozdit.

## Záložní řešení

Pokud selže přístup z GitHub Actions, použij generátor na Windows a publikuj `public/feed.xml` přes zvolený hosting; nezaručujeme funkci konkrétního klienta, dokud se neověří načítání náhledů na straně RSS čtečky.
