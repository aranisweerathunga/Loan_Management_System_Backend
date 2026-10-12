import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { productVersionConfigurationSchema } from "../src/modules/interest-repayment/configuration.js";
import {
  createVersionSchema,
  updateDraftVersionSchema,
} from "../src/modules/products/product.schemas.js";
import * as productService from "../src/modules/products/product.service.js";
import { AppError } from "../src/shared/errors/app-error.js";
import { disconnectDatabase, prisma } from "../src/shared/database/prisma.js";
import { requireTestDatabase } from "./require-test-database.js";

const phase8Configuration = {
  eligibility: { rules: [] },
  interestPolicy: {
    annualRate: "12.3456",
    calculationStrategy: "ANNUAL_INTEREST_ALLOCATION",
    allocationFrequency: "MONTHLY",
    recalculationFrequency: "ANNUAL",
    balanceChangeTreatment: "NEXT_SCHEDULED_RECALCULATION",
  },
  repaymentPolicy: {
    paymentAllocationPriority: ["PRINCIPAL", "INTEREST"],
  },
};

before(async () => {
  await requireTestDatabase();
});

after(async () => {
  await disconnectDatabase();
});

describe("stored ProductVersion configuration", () => {
  it("keeps existing rows valid without backfilling Phase 8 policy", async () => {
    const versions = await prisma.productVersion.findMany({
      select: { id: true, configuration: true },
    });

    for (const version of versions) {
      const parsed = productVersionConfigurationSchema.safeParse(version.configuration);
      assert.equal(
        parsed.success,
        true,
        parsed.success ? version.id : `${version.id}: ${parsed.error.message}`,
      );
      if (parsed.success) {
        const configuration = parsed.data;
        const original = version.configuration;
        if (
          typeof original === "object" &&
          original !== null &&
          !Array.isArray(original) &&
          !Object.prototype.hasOwnProperty.call(original, "interestPolicy")
        ) {
          assert.equal(Object.prototype.hasOwnProperty.call(configuration, "interestPolicy"), false);
        }
      }
    }
  });
});

describe("ProductVersion lifecycle", () => {
  it("saves Phase 8 policy on a DRAFT version and keeps ACTIVE and RETIRED versions immutable", async () => {
    const suffix = Date.now().toString(36);
    let categoryId: string | undefined;
    let productId: string | undefined;
    let versionId: string | undefined;

    try {
      const category = await productService.createCategory({
        code: `P8A${suffix}`.slice(0, 32),
        name: "Phase 8A policy test",
      });
      categoryId = category.id;

      const product = await productService.createProduct({
        categoryId: category.id,
        code: `P8AP${suffix}`.slice(0, 32),
        name: "Phase 8A policy product",
      });
      productId = product.id;

      const created = await productService.createVersion(
        product.id,
        createVersionSchema.parse({
          versionNumber: 1,
          effectiveFrom: "2026-01-01",
          configuration: { eligibility: { rules: [] } },
        }),
      );
      versionId = created.id;
      assert.equal(created.status, "DRAFT");
      assert.deepEqual(created.configuration, { eligibility: { rules: [] } });

      const updated = await productService.updateDraftVersion(
        product.id,
        created.id,
        updateDraftVersionSchema.parse({ configuration: phase8Configuration }),
      );
      assert.equal(updated.status, "DRAFT");
      assert.deepEqual(updated.configuration, phase8Configuration);

      const active = await productService.activateVersion(product.id, created.id);
      assert.equal(active.status, "ACTIVE");

      await assert.rejects(
        () =>
          productService.updateDraftVersion(
            product.id,
            created.id,
            updateDraftVersionSchema.parse({
              configuration: {
                ...phase8Configuration,
                interestPolicy: { ...phase8Configuration.interestPolicy, annualRate: "9.0000" },
              },
            }),
          ),
        (error: unknown) => {
          assert.ok(error instanceof AppError);
          assert.equal(error.statusCode, 409);
          assert.equal(error.code, "VERSION_IMMUTABLE");
          return true;
        },
      );

      const activeAfter = await productService.getVersionById(product.id, created.id);
      assert.equal(activeAfter.status, "ACTIVE");
      assert.deepEqual(activeAfter.configuration, phase8Configuration);

      const retired = await productService.retireVersion(product.id, created.id);
      assert.equal(retired.status, "RETIRED");

      await assert.rejects(
        () =>
          productService.updateDraftVersion(
            product.id,
            created.id,
            updateDraftVersionSchema.parse({
              configuration: {
                ...phase8Configuration,
                interestPolicy: { ...phase8Configuration.interestPolicy, annualRate: "9.0000" },
              },
            }),
          ),
        (error: unknown) => {
          assert.ok(error instanceof AppError);
          assert.equal(error.statusCode, 409);
          assert.equal(error.code, "VERSION_IMMUTABLE");
          return true;
        },
      );

      const retiredAfter = await productService.getVersionById(product.id, created.id);
      assert.equal(retiredAfter.status, "RETIRED");
      assert.deepEqual(retiredAfter.configuration, phase8Configuration);
    } finally {
      if (versionId) {
        await prisma.productVersion.delete({ where: { id: versionId } });
      }
      if (productId) {
        await prisma.loanProduct.delete({ where: { id: productId } });
      }
      if (categoryId) {
        await prisma.productCategory.delete({ where: { id: categoryId } });
      }
    }
  });
});
