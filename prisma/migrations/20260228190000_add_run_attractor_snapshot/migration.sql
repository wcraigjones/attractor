ALTER TABLE "Run"
  ADD COLUMN "attractorContentPath" TEXT,
  ADD COLUMN "attractorContentVersion" INTEGER,
  ADD COLUMN "attractorContentSha256" TEXT;

CREATE INDEX "Run_attractorContentVersion_idx" ON "Run"("attractorContentVersion");
