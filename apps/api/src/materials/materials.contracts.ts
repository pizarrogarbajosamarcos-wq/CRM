import { z } from "zod";
import { listInput } from "../trpc/list-input";

const groupingCell = z
	.union([z.string(), z.number()])
	.transform((value) => String(value).trim())
	.default("");

const nameCell = z
	.union([z.string(), z.number()])
	.transform((value) => String(value).trim())
	.transform((value) => (value === "" ? null : value))
	.nullable()
	.default(null);

const requiredTextCell = z
	.union([z.string(), z.number()])
	.transform((value) => String(value).trim())
	.pipe(z.string().min(1));

const quantityCell = z
	.union([z.string(), z.number()])
	.transform((value) => Number(value))
	.pipe(z.number().finite().min(0));

export const rawMaterialImportRow = z.object({
	article: requiredTextCell,
	color: groupingCell,
	measure: groupingCell,
	design: groupingCell,
	name: nameCell,
	unit: requiredTextCell,
	stockQty: quantityCell.default(0),
});

export type RawMaterialImportRow = z.infer<typeof rawMaterialImportRow>;

export const fichaImportRow = z.object({
	modelCode: requiredTextCell,
	modelName: nameCell,
	article: requiredTextCell,
	color: groupingCell,
	measure: groupingCell,
	design: groupingCell,
	unit: requiredTextCell,
	consumptionPerUnit: quantityCell,
});

export type FichaImportRow = z.infer<typeof fichaImportRow>;

export const importExcelInput = z.object({
	fileName: z.string().trim().min(1),
	fileBase64: z
		.string()
		.min(1)
		.max(8_000_000, "The file is too large. Keep it under 6 MB."),
});

export type ImportExcelInput = z.infer<typeof importExcelInput>;

const importRowError = z.object({
	sheet: z.enum(["Materiales", "Fichas"]),
	row: z.number(),
	message: z.string(),
});

export const importExcelOutput = z.object({
	materialsCreated: z.number(),
	materialsUpdated: z.number(),
	modelsCreated: z.number(),
	modelsUpdated: z.number(),
	bomLinesCreated: z.number(),
	bomLinesUpdated: z.number(),
	errors: z.array(importRowError),
});

export type ImportExcelOutput = z.infer<typeof importExcelOutput>;

export const materialListInput = listInput;

export const materialRowOutput = z.object({
	id: z.string(),
	article: z.string(),
	color: z.string(),
	measure: z.string(),
	design: z.string(),
	name: z.string().nullable(),
	unit: z.string(),
	stockQty: z.number(),
	updatedAt: z.string(),
});

export type MaterialRow = z.infer<typeof materialRowOutput>;

export const materialListOutput = z.object({
	rows: z.array(materialRowOutput),
	total: z.number(),
	facetCounts: z.record(z.string(), z.record(z.string(), z.number())),
});

export const updateStockInput = z.object({
	id: z.string(),
	stockQty: z.number().finite().min(0),
});

export const rawMaterialIdInput = z.object({ id: z.string() });

export const modelListInput = listInput;

export const modelRowOutput = z.object({
	id: z.string(),
	code: z.string(),
	name: z.string().nullable(),
	materialsCount: z.number(),
	updatedAt: z.string(),
});

export const modelListOutput = z.object({
	rows: z.array(modelRowOutput),
	total: z.number(),
	facetCounts: z.record(z.string(), z.record(z.string(), z.number())),
});

export const modelIdInput = z.object({ id: z.string() });

const modelMaterialOutput = z.object({
	id: z.string(),
	rawMaterialId: z.string(),
	article: z.string(),
	color: z.string(),
	measure: z.string(),
	design: z.string(),
	unit: z.string(),
	consumptionPerUnit: z.number(),
});

export const modelDetailOutput = z.object({
	id: z.string(),
	code: z.string(),
	name: z.string().nullable(),
	materials: z.array(modelMaterialOutput),
});

export const requirementInput = z.object({
	plan: z
		.array(
			z.object({
				modelCode: z.string().trim().min(1),
				quantity: z.number().finite().positive(),
			}),
		)
		.min(1, "Add at least one model to plan for."),
});

export type RequirementInput = z.infer<typeof requirementInput>;

const requirementRowOutput = z.object({
	rawMaterialId: z.string(),
	article: z.string(),
	color: z.string(),
	measure: z.string(),
	design: z.string(),
	unit: z.string(),
	required: z.number(),
	stock: z.number(),
	toOrder: z.number(),
});

export const requirementOutput = z.object({
	rows: z.array(requirementRowOutput),
	unknownModelCodes: z.array(z.string()),
});

export type RequirementOutput = z.infer<typeof requirementOutput>;
