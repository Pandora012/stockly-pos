CREATE TYPE "HeldCartStatus" AS ENUM ('HELD', 'RESUMED', 'COMPLETED', 'DISCARDED');

CREATE TABLE "HeldCart" (
  "id" UUID NOT NULL PRIMARY KEY,
  "cashierId" UUID NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "label" VARCHAR(120) NOT NULL,
  "status" "HeldCartStatus" NOT NULL DEFAULT 'HELD',
  "discount" INTEGER NOT NULL DEFAULT 0,
  "resumeToken" UUID,
  "resumeExpiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HeldCart_discount_check" CHECK ("discount" BETWEEN 0 AND 2000000000),
  CONSTRAINT "HeldCart_resume_check" CHECK (
    ("status" = 'RESUMED' AND "resumeToken" IS NOT NULL AND "resumeExpiresAt" IS NOT NULL) OR
    ("status" <> 'RESUMED' AND "resumeToken" IS NULL AND "resumeExpiresAt" IS NULL)
  )
);
CREATE INDEX "HeldCart_cashierId_status_updatedAt_idx" ON "HeldCart"("cashierId", "status", "updatedAt");
CREATE INDEX "HeldCart_status_updatedAt_idx" ON "HeldCart"("status", "updatedAt");

CREATE TABLE "HeldCartItem" (
  "id" UUID NOT NULL PRIMARY KEY,
  "heldCartId" UUID NOT NULL REFERENCES "HeldCart"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "productId" UUID NOT NULL REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "quantity" INTEGER NOT NULL,
  "unitPriceSnapshot" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HeldCartItem_values_check" CHECK ("quantity" BETWEEN 1 AND 10000 AND "unitPriceSnapshot" BETWEEN 1 AND 1000000000)
);
CREATE UNIQUE INDEX "HeldCartItem_heldCartId_productId_key" ON "HeldCartItem"("heldCartId", "productId");
CREATE INDEX "HeldCartItem_productId_idx" ON "HeldCartItem"("productId");

ALTER TABLE "Sale" ADD COLUMN "heldCartId" UUID;
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_heldCartId_fkey" FOREIGN KEY ("heldCartId") REFERENCES "HeldCart"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "Sale_heldCartId_key" ON "Sale"("heldCartId");
