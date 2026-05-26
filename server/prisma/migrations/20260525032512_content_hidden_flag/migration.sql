-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Content" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "douyinAccountId" INTEGER NOT NULL,
    "awemeId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "desc" TEXT,
    "authorSecUid" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "durationSec" INTEGER NOT NULL,
    "publishAt" DATETIME NOT NULL,
    "archivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "coverPath" TEXT,
    "mediaPath" TEXT,
    "mediaSize" BIGINT,
    "originUrl" TEXT,
    "originUrlExpiredAt" DATETIME,
    "rawMeta" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "errorMsg" TEXT,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "hiddenAt" DATETIME,
    CONSTRAINT "Content_douyinAccountId_fkey" FOREIGN KEY ("douyinAccountId") REFERENCES "DouyinAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Content" ("archivedAt", "authorName", "authorSecUid", "awemeId", "coverPath", "desc", "douyinAccountId", "durationSec", "errorMsg", "id", "kind", "mediaPath", "mediaSize", "originUrl", "originUrlExpiredAt", "publishAt", "rawMeta", "status", "title") SELECT "archivedAt", "authorName", "authorSecUid", "awemeId", "coverPath", "desc", "douyinAccountId", "durationSec", "errorMsg", "id", "kind", "mediaPath", "mediaSize", "originUrl", "originUrlExpiredAt", "publishAt", "rawMeta", "status", "title" FROM "Content";
DROP TABLE "Content";
ALTER TABLE "new_Content" RENAME TO "Content";
CREATE INDEX "Content_douyinAccountId_publishAt_idx" ON "Content"("douyinAccountId", "publishAt");
CREATE INDEX "Content_durationSec_idx" ON "Content"("durationSec");
CREATE INDEX "Content_status_idx" ON "Content"("status");
CREATE INDEX "Content_hidden_idx" ON "Content"("hidden");
CREATE UNIQUE INDEX "Content_douyinAccountId_awemeId_kind_key" ON "Content"("douyinAccountId", "awemeId", "kind");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
