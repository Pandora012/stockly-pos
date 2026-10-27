ALTER TABLE "SaleItem" ADD COLUMN "categoryIdSnapshot" UUID;
ALTER TABLE "SaleItem" ADD COLUMN "categoryNameSnapshot" VARCHAR(120);

-- Earlier sales did not record categories. Backfill once from the current catalog.
UPDATE "SaleItem" AS item
SET "categoryIdSnapshot" = category."id", "categoryNameSnapshot" = category."name"
FROM "Product" AS product JOIN "Category" AS category ON category."id" = product."categoryId"
WHERE product."id" = item."productId";

ALTER TABLE "SaleItem" ALTER COLUMN "categoryIdSnapshot" SET NOT NULL;
ALTER TABLE "SaleItem" ALTER COLUMN "categoryNameSnapshot" SET NOT NULL;
