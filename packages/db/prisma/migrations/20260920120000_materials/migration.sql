-- CreateTable
CREATE TABLE "rawMaterial" (
    "id" TEXT NOT NULL,
    "article" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '',
    "measure" TEXT NOT NULL DEFAULT '',
    "design" TEXT NOT NULL DEFAULT '',
    "name" TEXT,
    "unit" TEXT NOT NULL,
    "stockQty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rawMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "productModel" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "productModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "productModelMaterial" (
    "id" TEXT NOT NULL,
    "productModelId" TEXT NOT NULL,
    "rawMaterialId" TEXT NOT NULL,
    "consumptionPerUnit" DECIMAL(14,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "productModelMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rawMaterial_article_idx" ON "rawMaterial"("article");

-- CreateIndex
CREATE UNIQUE INDEX "rawMaterial_article_color_measure_design_key" ON "rawMaterial"("article", "color", "measure", "design");

-- CreateIndex
CREATE UNIQUE INDEX "productModel_code_key" ON "productModel"("code");

-- CreateIndex
CREATE INDEX "productModelMaterial_rawMaterialId_idx" ON "productModelMaterial"("rawMaterialId");

-- CreateIndex
CREATE UNIQUE INDEX "productModelMaterial_productModelId_rawMaterialId_key" ON "productModelMaterial"("productModelId", "rawMaterialId");

-- AddForeignKey
ALTER TABLE "productModelMaterial" ADD CONSTRAINT "productModelMaterial_productModelId_fkey" FOREIGN KEY ("productModelId") REFERENCES "productModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "productModelMaterial" ADD CONSTRAINT "productModelMaterial_rawMaterialId_fkey" FOREIGN KEY ("rawMaterialId") REFERENCES "rawMaterial"("id") ON DELETE CASCADE ON UPDATE CASCADE;
