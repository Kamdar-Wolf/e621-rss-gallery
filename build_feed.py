#!/usr/bin/env python3
"""Transform e621's official Atom feed into picture-friendly RSS 2.0.

Pure Python stdlib; no credentials and no third-party packages needed.
Only Atom metadata and remote image links are published; image files are not stored.
"""
from datetime import datetime, timezone
from email.utils import format_datetime
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlencode, urljoin, urlsplit
from urllib.request import Request, urlopen
import re
import sys
import xml.etree.ElementTree as ET

TAGS = """~aaddcc ~barndog ~bestiality ~carthagetech ~crimsoncreaturecreations ~digitoxici ~dirty.paws ~dzat ~eipril ~feral_frenzy ~fluff-kevlar ~hioshiru ~inert-ren ~jishinu ~jocarra ~johnwulffe ~lenika ~lvl0 ~maisha_(artist) ~parooty ~pb472 ~piporete ~racf92 ~redraptor16 ~ruaidri ~the_giant_hamster ~trioami260 ~tyedie ~untied_verbeger ~va_art ~wolf_islander_(artist) ~yinglizi"""
UA = "KamdarE621RSS/1.0 (+https://github.com/Kamdar-Wolf)"
E621_ATOM = "https://e621.net/posts.atom?" + urlencode({"tags": TAGS, "_client": UA})
E621_SEARCH = "https://e621.net/posts?" + urlencode({"tags": TAGS})
AT = "{http://www.w3.org/2005/Atom}"
MEDIA = "http://search.yahoo.com/mrss/"
CONTENT = "http://purl.org/rss/1.0/modules/content/"
ET.register_namespace("media", MEDIA)
ET.register_namespace("content", CONTENT)


def localname(tag):
    return str(tag).split("}", 1)[-1].lower()


def child(node, name):
    return next((x for x in node if localname(x.tag) == name), None)


def child_text(node, name):
    x = child(node, name)
    return "" if x is None else "".join(x.itertext()).strip()


class Images(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.urls = []

    def handle_starttag(self, tag, attrs):
        if tag.lower() != "img":
            return
        a = dict(attrs)
        for key in ("src", "data-src", "data-original"):
            url = a.get(key, "").strip()
            if url:
                self.urls.append(url)
                break


def get_image(entry):
    candidates = []
    for node in entry.iter():
        if localname(node.tag) == "img":
            candidates.append(node.attrib.get("src") or node.attrib.get("data-src") or "")
    for kind in ("content", "summary"):
        el = child(entry, kind)
        if el is None:
            continue
        parser = Images()
        # Both literal nested XHTML <img> and escaped HTML in Atom are supported.
        parser.feed(ET.tostring(el, encoding="unicode"))
        parser.feed("".join(el.itertext()))
        candidates += parser.urls
    for u in candidates:
        if not u:
            continue
        absolute = urljoin("https://e621.net/", u.strip())
        parts = urlsplit(absolute)
        if parts.scheme == "https" and re.search(r"\.(?:jpe?g|png|gif|webp)$", parts.path, re.I):
            return absolute
    return ""


def atom_date(value):
    try:
        return format_datetime(datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc), usegmt=True)
    except (ValueError, TypeError):
        return format_datetime(datetime.now(timezone.utc), usegmt=True)


def fetch_atom():
    req = Request(E621_ATOM, headers={
        "User-Agent": UA,
        "Accept": "application/atom+xml, application/xml;q=0.9, */*;q=0.1"
    })
    with urlopen(req, timeout=35) as resp:
        print(f"e621 Atom HTTP {resp.status}, Content-Type: {resp.headers.get('Content-Type', 'unknown')}")
        return resp.read(8_000_000)


def build(raw):
    root = ET.fromstring(raw)
    entries = [el for el in root if localname(el.tag) == "entry"]
    if not entries:
        raise RuntimeError("Atom feed contained no <entry> items; nothing published.")

    rss = ET.Element("rss", version="2.0")
    channel = ET.SubElement(rss, "channel")
    ET.SubElement(channel, "title").text = "e621 – sledovaní autoři (obrázky)"
    ET.SubElement(channel, "link").text = E621_SEARCH
    ET.SubElement(channel, "description").text = "e621 Atom transformed into RSS with image enclosures and thumbnails"
    ET.SubElement(channel, "language").text = "cs"
    ET.SubElement(channel, "ttl").text = "60"

    image_count = 0
    for entry in entries:
        title = child_text(entry, "title") or "e621 příspěvek"
        identity = child_text(entry, "id")
        link = ""
        for el in entry:
            if localname(el.tag) == "link" and el.attrib.get("rel", "alternate") in ("alternate", ""):
                link = el.attrib.get("href", "")
                if link:
                    break
        link = urljoin("https://e621.net/", link or identity)
        when = child_text(entry, "published") or child_text(entry, "updated")
        image = get_image(entry)
        if image:
            image_count += 1

        item = ET.SubElement(channel, "item")
        ET.SubElement(item, "title").text = title
        ET.SubElement(item, "link").text = link
        ET.SubElement(item, "guid", isPermaLink="false").text = identity or link
        ET.SubElement(item, "pubDate").text = atom_date(when)
        if image:
            body = (f'<p><a href="{xml_attr(link)}"><img src="{xml_attr(image)}" '
                    f'alt="Náhled příspěvku e621" /></a></p>'
                    f'<p><a href="{xml_attr(link)}">Otevřít původní příspěvek</a></p>')
        else:
            body = f'<p><a href="{xml_attr(link)}">Otevřít původní příspěvek</a></p>'
        ET.SubElement(item, "description").text = body
        ET.SubElement(item, f"{{{CONTENT}}}encoded").text = body
        if image:
            mimetype = "image/" + ("jpeg" if image.lower().split("?")[0].endswith((".jpg", ".jpeg")) else image.rsplit(".", 1)[-1].split("?", 1)[0].lower())
            ET.SubElement(item, "enclosure", {"url": image, "type": mimetype, "length": "0"})
            ET.SubElement(item, f"{{{MEDIA}}}thumbnail", {"url": image})
            ET.SubElement(item, f"{{{MEDIA}}}content", {"url": image, "type": mimetype, "medium": "image"})

    if image_count == 0:
        raise RuntimeError(f"Found {len(entries)} Atom entries but NO embedded images: refusing empty gallery publication.")
    return ET.tostring(rss, encoding="utf-8", xml_declaration=True), len(entries), image_count


def xml_attr(s):
    return (str(s).replace("&", "&amp;").replace('"', "&quot;")
            .replace("<", "&lt;").replace(">", "&gt;"))


def main():
    if len(sys.argv) == 2 and sys.argv[1] == "--self-test":
        fixture = b'''<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><id>tag:e621.net,2026:Post/1</id><title>Test 1</title><updated>2026-11-13T00:07:41+01:00</updated><link href="https://e621.net/posts/1"/><content type="html">&lt;p&gt;&lt;img src="https://static1.e621.net/data/preview/ab/cd/test.jpg"/&gt;&lt;/p&gt;</content></entry><entry><id>tag:e621.net,2026:Post/2</id><title>Test 2</title><updated>2026-11-13T00:07:41+01:00</updated><link href="https://e621.net/posts/2"/><content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><img src="https://static1.e621.net/data/preview/ab/cd/test2.webp" /></div></content></entry></feed>'''
        xml, total, pictures = build(fixture)
        parsed = ET.fromstring(xml)
        assert total == pictures == 2
        assert len(parsed.findall("channel/item/enclosure")) == 2
        print("SELF-TEST OK: 2 entries and 2 valid image enclosures")
        return

    raw = fetch_atom()
    xml, n, pictures = build(raw)
    output = Path(__file__).parent / "public" / "feed.xml"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(xml)
    print(f"Done: {n} entries, {pictures} image previews -> {output}")


if __name__ == "__main__":
    main()
