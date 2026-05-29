-- CreateTable: ExtractedAudio（完全解耦，不关联抖音账号）
CREATE TABLE "ExtractedAudio" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "localUserId" INTEGER NOT NULL,
    "sourceAwemeId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "durationSec" INTEGER NOT NULL,
    "mediaPath" TEXT NOT NULL,
    "coverPath" TEXT,
    "mediaSize" BIGINT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "hiddenAt" DATETIME
);

-- CreateIndex
CREATE INDEX "ExtractedAudio_localUserId_idx" ON "ExtractedAudio"("localUserId");
CREATE INDEX "ExtractedAudio_sourceAwemeId_idx" ON "ExtractedAudio"("sourceAwemeId");
