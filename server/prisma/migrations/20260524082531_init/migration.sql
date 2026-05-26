-- CreateTable
CREATE TABLE "LocalUser" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "LocalSession" (
    "token" TEXT NOT NULL PRIMARY KEY,
    "userId" INTEGER NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LocalSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "LocalUser" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserSetting" (
    "userId" INTEGER NOT NULL PRIMARY KEY,
    "archiveRoot" TEXT NOT NULL,
    "shortVideoSec" INTEGER NOT NULL DEFAULT 60,
    "downloadConcurrency" INTEGER NOT NULL DEFAULT 3,
    "syncIntervalMin" INTEGER NOT NULL DEFAULT 0,
    "fallbackToOnlineUrl" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserSetting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "LocalUser" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DouyinAccount" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "localUserId" INTEGER NOT NULL,
    "secUid" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "cookieEnc" TEXT,
    "cookieSource" TEXT NOT NULL,
    "isValid" BOOLEAN NOT NULL DEFAULT true,
    "lastCheckAt" DATETIME,
    "pushToken" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DouyinAccount_localUserId_fkey" FOREIGN KEY ("localUserId") REFERENCES "LocalUser" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Content" (
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
    CONSTRAINT "Content_douyinAccountId_fkey" FOREIGN KEY ("douyinAccountId") REFERENCES "DouyinAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ContentLink" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "contentId" INTEGER NOT NULL,
    "linkKind" TEXT NOT NULL,
    "folderId" TEXT,
    "mixId" TEXT,
    "linkedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ContentLink_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "Content" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Mix" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "douyinAccountId" INTEGER NOT NULL,
    "mixId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "authorSecUid" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "coverPath" TEXT,
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "publishAt" DATETIME,
    "rawMeta" TEXT NOT NULL,
    "archivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Mix_douyinAccountId_fkey" FOREIGN KEY ("douyinAccountId") REFERENCES "DouyinAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DownloadTask" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "contentId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "targetPath" TEXT NOT NULL,
    "bytesDone" BIGINT NOT NULL DEFAULT 0,
    "bytesTotal" BIGINT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "lastError" TEXT,
    "enqueuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    CONSTRAINT "DownloadTask_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "Content" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "LocalUser_username_key" ON "LocalUser"("username");

-- CreateIndex
CREATE INDEX "LocalSession_userId_idx" ON "LocalSession"("userId");

-- CreateIndex
CREATE INDEX "LocalSession_expiresAt_idx" ON "LocalSession"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "DouyinAccount_secUid_key" ON "DouyinAccount"("secUid");

-- CreateIndex
CREATE UNIQUE INDEX "DouyinAccount_pushToken_key" ON "DouyinAccount"("pushToken");

-- CreateIndex
CREATE INDEX "DouyinAccount_localUserId_idx" ON "DouyinAccount"("localUserId");

-- CreateIndex
CREATE INDEX "Content_douyinAccountId_publishAt_idx" ON "Content"("douyinAccountId", "publishAt");

-- CreateIndex
CREATE INDEX "Content_durationSec_idx" ON "Content"("durationSec");

-- CreateIndex
CREATE INDEX "Content_status_idx" ON "Content"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Content_douyinAccountId_awemeId_kind_key" ON "Content"("douyinAccountId", "awemeId", "kind");

-- CreateIndex
CREATE INDEX "ContentLink_linkKind_idx" ON "ContentLink"("linkKind");

-- CreateIndex
CREATE UNIQUE INDEX "ContentLink_contentId_linkKind_folderId_mixId_key" ON "ContentLink"("contentId", "linkKind", "folderId", "mixId");

-- CreateIndex
CREATE UNIQUE INDEX "Mix_douyinAccountId_mixId_key" ON "Mix"("douyinAccountId", "mixId");

-- CreateIndex
CREATE INDEX "DownloadTask_status_idx" ON "DownloadTask"("status");
