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
import time
import xml.etree.ElementTree as ET

def load_tags():
    """Load one search term per line from tags.txt. Ignore comments and duplicates."""
    filename = Path(__file__).with_name("tags.txt")
    terms, seen = [], set()
    for line_number, raw in enumerate(filename.read_text(encoding="utf-8-sig").splitlines(), 1):
        tag = raw.strip()
        if not tag or tag.startswith("#"):
            continue
        if any(character.isspace() for character in tag):
            raise ValueError(f"tags.txt line {line_number}: one tag per line, without spaces: {tag!r}")
        if tag not in seen:
            terms.append(tag)
            seen.add(tag)
    if not 1 <= len(terms) <= 320:
        raise ValueError(f"tags.txt must have 1 to 320 unique tags, found {len(terms)}")
    return terms


TAGS = load_tags()
UA = "KamdarE621RSS/1.2 (by Kamdar-Wolf on e621)"
# e621 allows up to 40 search terms in one request. Smaller chunks are
# deliberate to leave room for AND/negative filters and avoid oversized URLs.
CHUNK_SIZE = 25
MAX_ITEMS = 200
E621_SEARCH = "https://e621.net/posts"

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


def make_queries(tags):
    """Split OR tags across queries while repeating global AND/NOT filters.

    All current tags are OR (~tag). Plain and negative terms, if added later,
    must appear in every chunk to preserve search semantics.
    """
    common = [t for t in tags if not t.startswith("~")]
    alternatives = [t for t in tags if t.startswith("~")]
    if len(common) > 40:
        raise ValueError("Too many mandatory filter terms (max 40).")
    if not alternatives:
        return [common]
    capacity = min(CHUNK_SIZE, 40 - len(common))
    if capacity < 1:
        raise ValueError("No room for OR terms after mandatory filters.")
    return [common + alternatives[i:i + capacity]
            for i in range(0, len(alternatives), capacity)]


def sort_entry(entry):
    stamp = child_text(entry, "published") or child_text(entry, "updated")
    try:
        moment = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
        if moment.tzinfo is None:
            moment = moment.replace(tzinfo=timezone.utc)
        return moment.astimezone(timezone.utc).timestamp()
    except (ValueError, OverflowError, TypeError):
        return 0


def merge_atom_feeds(feeds):
    """Merge all results, de-duplicate by Atom ID, newest first."""
    merged = ET.Element(f"{{{AT[1:-1]}}}feed")
    unique = {}
    for raw in feeds:
        root = ET.fromstring(raw)
        if localname(root.tag) != "feed":
            raise RuntimeError("e621 did not return an Atom feed")
        for entry in root:
            if localname(entry.tag) != "entry":
                continue
            identity = child_text(entry, "id")
            if not identity:
                identity = next((node.get("href", "") for node in entry
                                 if localname(node.tag) == "link" and
                                 node.get("rel", "alternate") == "alternate"), "")
            if identity and identity not in unique:
                unique[identity] = entry
    ordered = sorted(unique.values(),
                     key=lambda entry: (sort_entry(entry), child_text(entry, "id")),
                     reverse=True)
    for entry in ordered[:MAX_ITEMS]:
        merged.append(entry)
    return ET.tostring(merged, encoding="utf-8", xml_declaration=True)


def fetch_atom(terms):
    url = "https://e621.net/posts.atom?" + urlencode({"tags": " ".join(terms), "_client": UA})
    req = Request(url, headers={
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
        queries = make_queries(["~tag" + str(i) for i in range(41)])
        assert len(queries) == 2
        assert sum(len(q) for q in queries) == 41
        assert all(len(q) <= 40 for q in queries)
        mixed = make_queries(["-gore", "rating:s"] +
                             ["~artist" + str(i) for i in range(60)])
        assert all(q[:2] == ["-gore", "rating:s"] for q in mixed)
        assert sum(len(q) - 2 for q in mixed) == 60
        duplicate = fixture.replace(b"Post/2", b"Post/3").replace(
            b"2026-11-13T00:07:41+01:00",
            b"2026-11-14T00:07:41+01:00")
        merged = merge_atom_feeds([fixture, duplicate])
        entries = [e for e in ET.fromstring(merged) if localname(e.tag) == "entry"]
        assert len(entries) == 3
        assert child_text(entries[0], "id").endswith("Post/3")
        print("SELF-TEST OK: batching, global filters, deduplication, chronological merge and previews")
        return

    queries = make_queries(TAGS)
    print(f"{len(TAGS)} tags -> {len(queries)} e621 Atom queries; max 40 terms each")
    responses = []
    for index, terms in enumerate(queries, 1):
        if index > 1:
            time.sleep(0.75)  # e621 rate-limit guidance: stay below 2 req/sec
        print(f"Downloading Atom batch {index}/{len(queries)} ({len(terms)} terms)")
        responses.append(fetch_atom(terms))
    # Do not publish a partial result if any upstream request failed.
    raw = merge_atom_feeds(responses)
    xml, n, pictures = build(raw)
    output = Path(__file__).parent / "public" / "feed.xml"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(xml)
    print(f"Done: {n} entries, {pictures} image previews -> {output}")


if __name__ == "__main__":
    main()
