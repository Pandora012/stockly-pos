CREATE TYPE "Role" AS ENUM ('ADMIN', 'CASHIER');

CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "passwordHash" VARCHAR(255) NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'CASHIER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StoreSetting" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "storeName" VARCHAR(160) NOT NULL,
    "address" VARCHAR(500) NOT NULL DEFAULT '',
    "phone" VARCHAR(30) NOT NULL DEFAULT '',
    "receiptFooter" VARCHAR(500) NOT NULL DEFAULT '',
    "currency" VARCHAR(3) NOT NULL DEFAULT 'IDR',
    "defaultTaxRate" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StoreSetting_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "StoreSetting_singleton" CHECK ("id" = 1),
    CONSTRAINT "StoreSetting_currency" CHECK ("currency" = 'IDR'),
    CONSTRAINT "StoreSetting_tax_rate" CHECK ("defaultTaxRate" BETWEEN 0 AND 10000)
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
