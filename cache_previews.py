#!/usr/bin/env python3
"""Store only small preview thumbnails as same-origin static files for the RSS reader.
Images remain linked to their original e621 post. This is an optional publishing
strategy; public redistribution may be subject to creators' rights and host terms.
"""
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from html import escape
import hashlib
import time
import xml.etree.ElementTree as ET

BASE = "https://kamdar-wolf.github.io/e621-rss-gallery/"
RSS = Path("public/feed.xml")
DIR = Path("public/thumbs")
UA = "KamdarE621RSS/1.1 (by Kamdar-Wolf on e621)"
CONTENT = "{http://purl.org/rss/1.0/modules/content/}"
MEDIA = "{http://search.yahoo.com/mrss/}"
ET.register_namespace("media", "http://search.yahoo.com/mrss/")
ET.register_namespace("content", "http://purl.org/rss/1.0/modules/content/")

def valid_image(data):
    if data.startswith(b"\xff\xd8\xff"):
        return ".jpg", "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png", "image/png"
    if data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return ".webp", "image/webp"
    return None

def download_thumb(url):
    host = urlsplit(url).hostname
    if host not in ("static1.e621.net", "static1.e926.net"):
        return None, "untrusted host"
    stem = hashlib.sha256(url.encode("utf-8")).hexdigest()[:24]
    for ext in (".jpg", ".png", ".webp"):
        p = DIR / (stem + ext)
        if p.exists() and valid_image(p.read_bytes()[:16]):
            return (p, p.stat().st_size, "image/" + ("jpeg" if ext == ".jpg" else ext[1:])), None
    req = Request(url, headers={
        "User-Agent": UA, "Accept": "image/jpeg,image/png,image/webp",
        "Referer": "https://e621.net/"
    })
    try:
        time.sleep(0.75)  # keep under e621's request rate guidance
        with urlopen(req, timeout=22) as response:
            raw = response.read(1_000_001)
        if len(raw) > 1_000_000:
            return None, "thumbnail exceeds 1 MB"
        detected = valid_image(raw)
        if not detected:
            return None, "not a recognized image"
        ext, mime = detected
        path = DIR / (stem + ext)
        path.write_bytes(raw)
        return (path, len(raw), mime), None
    except (HTTPError, URLError, TimeoutError, OSError) as err:
        return None, str(err)[:120]

def main():
    DIR.mkdir(parents=True, exist_ok=True)
    root = ET.parse(RSS)
    items = root.findall("./channel/item")
    done, failures, keep = 0, [], set()
    for item in items:
        enclosure = item.find("enclosure")
        if enclosure is None:
            failures.append((item.findtext("title"), "no enclosure"))
            continue
        url = enclosure.get("url", "")
        result, error = download_thumb(url)
        if not result:
            failures.append((item.findtext("title"), error))
            continue
        path, size, mime = result
        keep.add(path.name)
        relative = "thumbs/" + path.name
        public_url = BASE + relative
        enclosure.set("url", public_url)
        enclosure.set("length", str(size))
        enclosure.set("type", mime)
        thumbnail = item.find(MEDIA + "thumbnail")
        if thumbnail is not None:
            thumbnail.set("url", public_url)
        media = item.find(MEDIA + "content")
        if media is not None:
            media.set("url", public_url)
            media.set("type", mime)
        link = item.findtext("link") or "https://e621.net/"
        html = ('<p><a href="' + escape(link, quote=True) + '">' +
                '<img src="' + escape(public_url, quote=True) +
                '" alt="Náhled příspěvku"></a></p>' +
                '<p><a href="' + escape(link, quote=True) +
                '">Otevřít originál na e621</a></p>')
        for node in (item.find("description"), item.find(CONTENT + "encoded")):
            if node is not None:
                node.text = html
        done += 1

    # Keep static output bounded to items in the latest feed.
    for p in DIR.iterdir():
        if p.is_file() and p.name not in keep:
            p.unlink()

    report = [
        f"Items in RSS: {len(items)}",
        f"Local thumbnails: {done}",
        f"Failed thumbnails: {len(failures)}",
        f"Storage: {sum(p.stat().st_size for p in DIR.iterdir() if p.is_file())} bytes",
        "",
        *[f"{title}: {error}" for title, error in failures[:20]]
    ]
    Path("public/image-test.txt").write_text("\n".join(report) + "\n", encoding="utf-8")
    print("\n".join(report))
    if done == 0:
        raise RuntimeError("No images downloaded: refusing to publish an empty gallery.")
    root.write(RSS, encoding="utf-8", xml_declaration=True)

if __name__ == "__main__":
    main()
