-- Speed up ordered media galleries and image-only thumbnail selection.
CREATE INDEX IF NOT EXISTS entry_media_gallery_idx ON entry_media(entry_id,position,id);
CREATE INDEX IF NOT EXISTS entry_media_preview_idx ON entry_media(entry_id,position,id) WHERE kind='image';
