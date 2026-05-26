CREATE TABLE "LocalFolder" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "localUserId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LocalFolder_localUserId_fkey" FOREIGN KEY ("localUserId") REFERENCES "LocalUser" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "FolderItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "folderId" INTEGER NOT NULL,
    "contentId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FolderItem_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "LocalFolder" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FolderItem_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "Content" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "LocalFolder_localUserId_idx" ON "LocalFolder"("localUserId");
CREATE UNIQUE INDEX "FolderItem_folderId_contentId_key" ON "FolderItem"("folderId", "contentId");
CREATE INDEX "FolderItem_contentId_idx" ON "FolderItem"("contentId");
