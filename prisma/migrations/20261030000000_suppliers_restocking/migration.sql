CREATE TYPE "PurchaseStatus" AS ENUM ('DRAFT', 'ORDERED', 'RECEIVED');

CREATE TABLE "Supplier" (
  "id" UUID NOT NULL PRIMARY KEY,
  "name" VARCHAR(160) NOT NULL,
  "contactPerson" VARCHAR(120) NOT NULL DEFAULT '',
  "phone" VARCHAR(30) NOT NULL DEFAULT '',
  "email" VARCHAR(255) NOT NULL DEFAULT '',
  "address" VARCHAR(500) NOT NULL DEFAULT '',
  "notes" VARCHAR(1000) NOT NULL DEFAULT '',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "Supplier_isActive_name_idx" ON "Supplier"("isActive", "name");

CREATE TABLE "PurchaseOrder" (
  "id" UUID NOT NULL PRIMARY KEY,
  "poNumber" VARCHAR(64) NOT NULL,
  "supplierId" UUID NOT NULL REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "supplierNameSnapshot" VARCHAR(160) NOT NULL,
  "createdById" UUID NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "receivedById" UUID REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "status" "PurchaseStatus" NOT NULL DEFAULT 'DRAFT',
  "version" INTEGER NOT NULL DEFAULT 0,
  "totalAmount" INTEGER NOT NULL,
  "orderedAt" TIMESTAMP(3),
  "receivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PurchaseOrder_total" CHECK ("totalAmount" > 0 AND "totalAmount" <= 2000000000),
  CONSTRAINT "PurchaseOrder_state" CHECK (
    ("status" = 'DRAFT' AND "orderedAt" IS NULL AND "receivedAt" IS NULL AND "receivedById" IS NULL) OR
    ("status" = 'ORDERED' AND "orderedAt" IS NOT NULL AND "receivedAt" IS NULL AND "receivedById" IS NULL) OR
    ("status" = 'RECEIVED' AND "orderedAt" IS NOT NULL AND "receivedAt" IS NOT NULL AND "receivedById" IS NOT NULL)
  )
);
CREATE UNIQUE INDEX "PurchaseOrder_poNumber_key" ON "PurchaseOrder"("poNumber");
CREATE INDEX "PurchaseOrder_supplierId_createdAt_idx" ON "PurchaseOrder"("supplierId", "createdAt");
CREATE INDEX "PurchaseOrder_status_createdAt_idx" ON "PurchaseOrder"("status", "createdAt");

CREATE TABLE "PurchaseOrderItem" (
  "id" UUID NOT NULL PRIMARY KEY,
  "purchaseOrderId" UUID NOT NULL REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "productId" UUID NOT NULL REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "productNameSnapshot" VARCHAR(160) NOT NULL,
  "skuSnapshot" VARCHAR(64) NOT NULL,
  "quantity" INTEGER NOT NULL,
  "unitCost" INTEGER NOT NULL,
  "lineTotal" INTEGER NOT NULL,
  CONSTRAINT "PurchaseOrderItem_values" CHECK ("quantity" BETWEEN 1 AND 10000 AND "unitCost" BETWEEN 1 AND 1000000000
    AND "lineTotal" > 0 AND "lineTotal"::BIGINT = "quantity"::BIGINT * "unitCost")
);
CREATE UNIQUE INDEX "PurchaseOrderItem_purchaseOrderId_productId_key" ON "PurchaseOrderItem"("purchaseOrderId", "productId");
CREATE INDEX "PurchaseOrderItem_productId_idx" ON "PurchaseOrderItem"("productId");

CREATE UNIQUE INDEX "StockMovement_purchase_once" ON "StockMovement"("productId", "referenceId")
  WHERE "referenceType" = 'PURCHASE_ORDER' AND "type" = 'IN';
