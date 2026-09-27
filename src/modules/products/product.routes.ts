import { Router } from "express";
import { validateBody, validateParams, validateQuery } from "../../shared/middleware/validate.js";
import * as productController from "./product.controller.js";
import {
  categoryIdParamSchema,
  createCategorySchema,
  createProductSchema,
  createPurposeSchema,
  createVersionSchema,
  listProductsQuerySchema,
  productIdParamSchema,
  purposeIdParamSchema,
  updateCategorySchema,
  updateDraftVersionSchema,
  updateProductSchema,
  updatePurposeSchema,
  versionIdParamSchema,
} from "./product.schemas.js";

export const productRouter = Router();

productRouter.post(
  "/product-categories",
  validateBody(createCategorySchema),
  productController.createCategory,
);
productRouter.get("/product-categories", productController.listCategories);
productRouter.get(
  "/product-categories/:categoryId",
  validateParams(categoryIdParamSchema),
  productController.getCategory,
);
productRouter.patch(
  "/product-categories/:categoryId",
  validateParams(categoryIdParamSchema),
  validateBody(updateCategorySchema),
  productController.updateCategory,
);

productRouter.post("/products", validateBody(createProductSchema), productController.createProduct);
productRouter.get(
  "/products",
  validateQuery(listProductsQuerySchema),
  productController.listProducts,
);
productRouter.get(
  "/products/:productId",
  validateParams(productIdParamSchema),
  productController.getProduct,
);
productRouter.patch(
  "/products/:productId",
  validateParams(productIdParamSchema),
  validateBody(updateProductSchema),
  productController.updateProduct,
);

productRouter.post(
  "/products/:productId/purposes",
  validateParams(productIdParamSchema),
  validateBody(createPurposeSchema),
  productController.createPurpose,
);
productRouter.get(
  "/products/:productId/purposes",
  validateParams(productIdParamSchema),
  productController.listPurposes,
);
productRouter.get(
  "/products/:productId/purposes/:purposeId",
  validateParams(purposeIdParamSchema),
  productController.getPurpose,
);
productRouter.patch(
  "/products/:productId/purposes/:purposeId",
  validateParams(purposeIdParamSchema),
  validateBody(updatePurposeSchema),
  productController.updatePurpose,
);

productRouter.post(
  "/products/:productId/versions",
  validateParams(productIdParamSchema),
  validateBody(createVersionSchema),
  productController.createVersion,
);
productRouter.get(
  "/products/:productId/versions",
  validateParams(productIdParamSchema),
  productController.listVersions,
);
productRouter.get(
  "/products/:productId/versions/:versionId",
  validateParams(versionIdParamSchema),
  productController.getVersion,
);
productRouter.patch(
  "/products/:productId/versions/:versionId",
  validateParams(versionIdParamSchema),
  validateBody(updateDraftVersionSchema),
  productController.updateDraftVersion,
);
productRouter.post(
  "/products/:productId/versions/:versionId/activate",
  validateParams(versionIdParamSchema),
  productController.activateVersion,
);
productRouter.post(
  "/products/:productId/versions/:versionId/retire",
  validateParams(versionIdParamSchema),
  productController.retireVersion,
);
