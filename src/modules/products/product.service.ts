import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../shared/database/prisma.js";
import { AppError } from "../../shared/errors/app-error.js";
import type {
  CreateCategoryInput,
  CreateProductInput,
  CreatePurposeInput,
  CreateVersionInput,
  UpdateCategoryInput,
  UpdateDraftVersionInput,
  UpdateProductInput,
  UpdatePurposeInput,
} from "./product.schemas.js";

function dateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function toDateOnlyString(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function assertEffectiveRange(effectiveFrom: Date, effectiveTo: Date | null): void {
  if (effectiveTo && effectiveTo < effectiveFrom) {
    throw new AppError(400, "effectiveTo must not be earlier than effectiveFrom", "VALIDATION_ERROR");
  }
}

function isJsonObject(value: Prisma.JsonValue): value is Prisma.JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function serializeCategory(category: {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return category;
}

function serializeProduct(product: {
  id: string;
  categoryId: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return product;
}

function serializePurpose(purpose: {
  id: string;
  loanProductId: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return purpose;
}

function serializeVersion(version: {
  id: string;
  loanProductId: string;
  versionNumber: number;
  status: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  configuration: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...version,
    effectiveFrom: toDateOnlyString(version.effectiveFrom),
    effectiveTo: version.effectiveTo ? toDateOnlyString(version.effectiveTo) : null,
  };
}

async function getRequiredCategory(categoryId: string) {
  const category = await prisma.productCategory.findUnique({ where: { id: categoryId } });
  if (!category) {
    throw new AppError(404, "Product category not found", "NOT_FOUND");
  }
  return category;
}

async function getRequiredProduct(productId: string) {
  const product = await prisma.loanProduct.findUnique({ where: { id: productId } });
  if (!product) {
    throw new AppError(404, "Loan product not found", "NOT_FOUND");
  }
  return product;
}

async function getRequiredPurpose(productId: string, purposeId: string) {
  const purpose = await prisma.productPurpose.findFirst({
    where: { id: purposeId, loanProductId: productId },
  });
  if (!purpose) {
    throw new AppError(404, "Product purpose not found", "NOT_FOUND");
  }
  return purpose;
}

async function getRequiredVersion(productId: string, versionId: string) {
  const version = await prisma.productVersion.findFirst({
    where: { id: versionId, loanProductId: productId },
  });
  if (!version) {
    throw new AppError(404, "Product version not found", "NOT_FOUND");
  }
  return version;
}

export async function createCategory(input: CreateCategoryInput) {
  const category = await prisma.productCategory.create({
    data: {
      code: input.code,
      name: input.name,
      description: input.description ?? null,
      isActive: input.isActive ?? true,
    },
  });
  return serializeCategory(category);
}

export async function listCategories() {
  const categories = await prisma.productCategory.findMany({
    orderBy: { createdAt: "asc" },
  });
  return categories.map(serializeCategory);
}

export async function getCategoryById(categoryId: string) {
  return serializeCategory(await getRequiredCategory(categoryId));
}

export async function updateCategory(categoryId: string, input: UpdateCategoryInput) {
  await getRequiredCategory(categoryId);
  const category = await prisma.productCategory.update({
    where: { id: categoryId },
    data: {
      ...(input.code !== undefined ? { code: input.code } : {}),
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
  });
  return serializeCategory(category);
}

export async function createProduct(input: CreateProductInput) {
  await getRequiredCategory(input.categoryId);
  const product = await prisma.loanProduct.create({
    data: {
      categoryId: input.categoryId,
      code: input.code,
      name: input.name,
      description: input.description ?? null,
      isActive: input.isActive ?? true,
    },
  });
  return serializeProduct(product);
}

export async function listProducts(categoryId?: string) {
  if (categoryId) {
    await getRequiredCategory(categoryId);
  }

  const products = await prisma.loanProduct.findMany({
    where: categoryId ? { categoryId } : undefined,
    orderBy: { createdAt: "asc" },
  });
  return products.map(serializeProduct);
}

export async function getProductById(productId: string) {
  const product = await prisma.loanProduct.findUnique({
    where: { id: productId },
    include: {
      purposes: { orderBy: { createdAt: "asc" } },
      versions: { orderBy: { versionNumber: "asc" } },
    },
  });
  if (!product) {
    throw new AppError(404, "Loan product not found", "NOT_FOUND");
  }

  return {
    ...serializeProduct(product),
    purposes: product.purposes.map(serializePurpose),
    versions: product.versions.map(serializeVersion),
  };
}

export async function updateProduct(productId: string, input: UpdateProductInput) {
  await getRequiredProduct(productId);
  if (input.categoryId) {
    await getRequiredCategory(input.categoryId);
  }

  const product = await prisma.loanProduct.update({
    where: { id: productId },
    data: {
      ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
      ...(input.code !== undefined ? { code: input.code } : {}),
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
  });
  return serializeProduct(product);
}

export async function createPurpose(productId: string, input: CreatePurposeInput) {
  await getRequiredProduct(productId);
  const purpose = await prisma.productPurpose.create({
    data: {
      loanProductId: productId,
      code: input.code,
      name: input.name,
      description: input.description ?? null,
      isActive: input.isActive ?? true,
    },
  });
  return serializePurpose(purpose);
}

export async function listPurposes(productId: string) {
  await getRequiredProduct(productId);
  const purposes = await prisma.productPurpose.findMany({
    where: { loanProductId: productId },
    orderBy: { createdAt: "asc" },
  });
  return purposes.map(serializePurpose);
}

export async function getPurposeById(productId: string, purposeId: string) {
  return serializePurpose(await getRequiredPurpose(productId, purposeId));
}

export async function updatePurpose(productId: string, purposeId: string, input: UpdatePurposeInput) {
  await getRequiredPurpose(productId, purposeId);
  const purpose = await prisma.productPurpose.update({
    where: { id: purposeId },
    data: {
      ...(input.code !== undefined ? { code: input.code } : {}),
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
  });
  return serializePurpose(purpose);
}

export async function createVersion(productId: string, input: CreateVersionInput) {
  await getRequiredProduct(productId);

  const effectiveFrom = dateOnly(input.effectiveFrom);
  const effectiveTo = input.effectiveTo ? dateOnly(input.effectiveTo) : null;
  assertEffectiveRange(effectiveFrom, effectiveTo);

  const version = await prisma.productVersion.create({
    data: {
      loanProductId: productId,
      versionNumber: input.versionNumber,
      status: "DRAFT",
      effectiveFrom,
      effectiveTo,
      configuration: input.configuration as Prisma.InputJsonValue,
    },
  });
  return serializeVersion(version);
}

export async function listVersions(productId: string) {
  await getRequiredProduct(productId);
  const versions = await prisma.productVersion.findMany({
    where: { loanProductId: productId },
    orderBy: { versionNumber: "asc" },
  });
  return versions.map(serializeVersion);
}

export async function getVersionById(productId: string, versionId: string) {
  return serializeVersion(await getRequiredVersion(productId, versionId));
}

export async function updateDraftVersion(
  productId: string,
  versionId: string,
  input: UpdateDraftVersionInput,
) {
  const current = await getRequiredVersion(productId, versionId);
  if (current.status !== "DRAFT") {
    throw new AppError(
      409,
      "Only DRAFT product versions can be edited",
      "VERSION_IMMUTABLE",
    );
  }

  const effectiveFrom = input.effectiveFrom ? dateOnly(input.effectiveFrom) : current.effectiveFrom;
  const effectiveTo =
    input.effectiveTo === undefined
      ? current.effectiveTo
      : input.effectiveTo === null
        ? null
        : dateOnly(input.effectiveTo);
  assertEffectiveRange(effectiveFrom, effectiveTo);

  const version = await prisma.productVersion.update({
    where: { id: versionId },
    data: {
      ...(input.versionNumber !== undefined ? { versionNumber: input.versionNumber } : {}),
      ...(input.effectiveFrom !== undefined ? { effectiveFrom } : {}),
      ...(input.effectiveTo !== undefined ? { effectiveTo } : {}),
      ...(input.configuration !== undefined
        ? { configuration: input.configuration as Prisma.InputJsonValue }
        : {}),
    },
  });
  return serializeVersion(version);
}

export async function activateVersion(productId: string, versionId: string) {
  const current = await getRequiredVersion(productId, versionId);
  if (current.status !== "DRAFT") {
    throw new AppError(409, "Only DRAFT product versions can be activated", "INVALID_STATE");
  }

  assertEffectiveRange(current.effectiveFrom, current.effectiveTo);

  if (!isJsonObject(current.configuration)) {
    throw new AppError(400, "configuration must be an object before activation", "VALIDATION_ERROR");
  }

  const version = await prisma.productVersion.update({
    where: { id: versionId },
    data: { status: "ACTIVE" },
  });
  return serializeVersion(version);
}

export async function retireVersion(productId: string, versionId: string) {
  const current = await getRequiredVersion(productId, versionId);
  if (current.status !== "ACTIVE") {
    throw new AppError(409, "Only ACTIVE product versions can be retired", "INVALID_STATE");
  }

  const version = await prisma.productVersion.update({
    where: { id: versionId },
    data: { status: "RETIRED" },
  });
  return serializeVersion(version);
}
