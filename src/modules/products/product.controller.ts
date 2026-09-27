import type { Request, Response } from "express";
import * as productService from "./product.service.js";
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

export async function createCategory(req: Request, res: Response): Promise<void> {
  const category = await productService.createCategory(req.body as CreateCategoryInput);
  res.status(201).json({ data: category });
}

export async function listCategories(_req: Request, res: Response): Promise<void> {
  const categories = await productService.listCategories();
  res.status(200).json({ data: categories });
}

export async function getCategory(req: Request, res: Response): Promise<void> {
  const category = await productService.getCategoryById(req.params.categoryId as string);
  res.status(200).json({ data: category });
}

export async function updateCategory(req: Request, res: Response): Promise<void> {
  const category = await productService.updateCategory(
    req.params.categoryId as string,
    req.body as UpdateCategoryInput,
  );
  res.status(200).json({ data: category });
}

export async function createProduct(req: Request, res: Response): Promise<void> {
  const product = await productService.createProduct(req.body as CreateProductInput);
  res.status(201).json({ data: product });
}

export async function listProducts(req: Request, res: Response): Promise<void> {
  const products = await productService.listProducts(req.query.categoryId as string | undefined);
  res.status(200).json({ data: products });
}

export async function getProduct(req: Request, res: Response): Promise<void> {
  const product = await productService.getProductById(req.params.productId as string);
  res.status(200).json({ data: product });
}

export async function updateProduct(req: Request, res: Response): Promise<void> {
  const product = await productService.updateProduct(
    req.params.productId as string,
    req.body as UpdateProductInput,
  );
  res.status(200).json({ data: product });
}

export async function createPurpose(req: Request, res: Response): Promise<void> {
  const purpose = await productService.createPurpose(
    req.params.productId as string,
    req.body as CreatePurposeInput,
  );
  res.status(201).json({ data: purpose });
}

export async function listPurposes(req: Request, res: Response): Promise<void> {
  const purposes = await productService.listPurposes(req.params.productId as string);
  res.status(200).json({ data: purposes });
}

export async function getPurpose(req: Request, res: Response): Promise<void> {
  const purpose = await productService.getPurposeById(
    req.params.productId as string,
    req.params.purposeId as string,
  );
  res.status(200).json({ data: purpose });
}

export async function updatePurpose(req: Request, res: Response): Promise<void> {
  const purpose = await productService.updatePurpose(
    req.params.productId as string,
    req.params.purposeId as string,
    req.body as UpdatePurposeInput,
  );
  res.status(200).json({ data: purpose });
}

export async function createVersion(req: Request, res: Response): Promise<void> {
  const version = await productService.createVersion(
    req.params.productId as string,
    req.body as CreateVersionInput,
  );
  res.status(201).json({ data: version });
}

export async function listVersions(req: Request, res: Response): Promise<void> {
  const versions = await productService.listVersions(req.params.productId as string);
  res.status(200).json({ data: versions });
}

export async function getVersion(req: Request, res: Response): Promise<void> {
  const version = await productService.getVersionById(
    req.params.productId as string,
    req.params.versionId as string,
  );
  res.status(200).json({ data: version });
}

export async function updateDraftVersion(req: Request, res: Response): Promise<void> {
  const version = await productService.updateDraftVersion(
    req.params.productId as string,
    req.params.versionId as string,
    req.body as UpdateDraftVersionInput,
  );
  res.status(200).json({ data: version });
}

export async function activateVersion(req: Request, res: Response): Promise<void> {
  const version = await productService.activateVersion(
    req.params.productId as string,
    req.params.versionId as string,
  );
  res.status(200).json({ data: version });
}

export async function retireVersion(req: Request, res: Response): Promise<void> {
  const version = await productService.retireVersion(
    req.params.productId as string,
    req.params.versionId as string,
  );
  res.status(200).json({ data: version });
}
