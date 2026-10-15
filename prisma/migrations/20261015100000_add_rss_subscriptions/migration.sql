-- CreateTable
CREATE TABLE "rss_subscriptions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "intervalMinutes" INTEGER NOT NULL DEFAULT 30,
    "lastFetchedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rss_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rss_pushed_items" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "guid" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "link" TEXT,
    "publishedAt" TIMESTAMP(3),
    "pushedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rss_pushed_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rss_subscriptions_url_key" ON "rss_subscriptions"("url");

-- CreateIndex
CREATE UNIQUE INDEX "rss_pushed_items_subscriptionId_guid_key" ON "rss_pushed_items"("subscriptionId", "guid");

-- CreateIndex
CREATE INDEX "rss_pushed_items_subscriptionId_pushedAt_idx" ON "rss_pushed_items"("subscriptionId", "pushedAt");

-- AddForeignKey
ALTER TABLE "rss_pushed_items" ADD CONSTRAINT "rss_pushed_items_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "rss_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
