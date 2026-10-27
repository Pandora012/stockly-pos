CREATE TYPE "SaleStatus" AS ENUM ('COMPLETED');
CREATE TYPE "PaymentMethod" AS ENUM ('CASH');

CREATE TABLE "Sale" (
  "id" UUID NOT NULL PRIMARY KEY,
  "invoiceNumber" VARCHAR(64) NOT NULL,
  "cashierId" UUID NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "cashierNameSnapshot" VARCHAR(120) NOT NULL,
  "subtotal" INTEGER NOT NULL,
  "discount" INTEGER NOT NULL DEFAULT 0,
  "tax" INTEGER NOT NULL DEFAULT 0,
  "taxRate" INTEGER NOT NULL DEFAULT 0,
  "total" INTEGER NOT NULL,
  "status" "SaleStatus" NOT NULL DEFAULT 'COMPLETED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "idempotencyKey" UUID NOT NULL,
  "requestHash" VARCHAR(64) NOT NULL,
  "storeSnapshot" JSONB NOT NULL,
  CONSTRAINT "Sale_totals" CHECK ("subtotal" >= 0 AND "discount" BETWEEN 0 AND "subtotal" AND "tax" >= 0
    AND "taxRate" BETWEEN 0 AND 10000 AND "total" >= 0 AND "total" = "subtotal" - "discount" + "tax")
);
CREATE UNIQUE INDEX "Sale_invoiceNumber_key" ON "Sale"("invoiceNumber");
CREATE UNIQUE INDEX "Sale_idempotencyKey_key" ON "Sale"("idempotencyKey");
CREATE INDEX "Sale_cashierId_createdAt_idx" ON "Sale"("cashierId", "createdAt");
CREATE INDEX "Sale_createdAt_idx" ON "Sale"("createdAt");

CREATE TABLE "SaleItem" (
  "id" UUID NOT NULL PRIMARY KEY,
  "saleId" UUID NOT NULL REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "productId" UUID NOT NULL REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "productNameSnapshot" VARCHAR(160) NOT NULL,
  "skuSnapshot" VARCHAR(64) NOT NULL,
  "quantity" INTEGER NOT NULL,
  "unitPrice" INTEGER NOT NULL,
  "unitCostSnapshot" INTEGER NOT NULL,
  "lineTotal" INTEGER NOT NULL,
  CONSTRAINT "SaleItem_totals" CHECK ("quantity" > 0 AND "unitPrice" > 0 AND "unitCostSnapshot" > 0
    AND "lineTotal" = "quantity"::BIGINT * "unitPrice")
);
CREATE UNIQUE INDEX "SaleItem_saleId_productId_key" ON "SaleItem"("saleId", "productId");
CREATE INDEX "SaleItem_productId_idx" ON "SaleItem"("productId");

CREATE TABLE "Payment" (
  "id" UUID NOT NULL PRIMARY KEY,
  "saleId" UUID NOT NULL REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "method" "PaymentMethod" NOT NULL DEFAULT 'CASH',
  "amountReceived" INTEGER NOT NULL,
  "changeAmount" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Payment_amounts" CHECK ("amountReceived" >= 0 AND "changeAmount" BETWEEN 0 AND "amountReceived")
);
CREATE UNIQUE INDEX "Payment_saleId_key" ON "Payment"("saleId");
