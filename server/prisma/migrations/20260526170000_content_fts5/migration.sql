CREATE VIRTUAL TABLE IF NOT EXISTS content_search USING fts5(
  title,
  "desc",
  authorName,
  content='Content',
  content_rowid='id',
  tokenize='trigram'
);

INSERT INTO content_search(rowid, title, "desc", authorName)
SELECT id, title, COALESCE("desc", ''), authorName
FROM Content;

CREATE TRIGGER IF NOT EXISTS content_search_ai AFTER INSERT ON Content BEGIN
  INSERT INTO content_search(rowid, title, "desc", authorName)
  VALUES (new.id, new.title, COALESCE(new."desc", ''), new.authorName);
END;

CREATE TRIGGER IF NOT EXISTS content_search_ad AFTER DELETE ON Content BEGIN
  INSERT INTO content_search(content_search, rowid, title, "desc", authorName)
  VALUES ('delete', old.id, old.title, COALESCE(old."desc", ''), old.authorName);
END;

CREATE TRIGGER IF NOT EXISTS content_search_au AFTER UPDATE ON Content BEGIN
  INSERT INTO content_search(content_search, rowid, title, "desc", authorName)
  VALUES ('delete', old.id, old.title, COALESCE(old."desc", ''), old.authorName);
  INSERT INTO content_search(rowid, title, "desc", authorName)
  VALUES (new.id, new.title, COALESCE(new."desc", ''), new.authorName);
END;
