import { type Db, Prisma as PrismaNamespace } from "@crm/db";
import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { read as readWorkbook, type WorkSheet, utils as xlsxUtils } from "xlsx";
import type { ZodType, z } from "zod";
import { InjectDatabase } from "../database/database.constants";
import {
	type ListInput,
	type OrderByColumns,
	paginate,
	resolveOrderBy,
} from "../trpc/list-input";
import {
	type FichaImportRow,
	fichaImportRow,
	type ImportExcelInput,
	type ImportExcelOutput,
	type RawMaterialImportRow,
	type RequirementInput,
	type RequirementOutput,
	rawMaterialImportRow,
} from "./materials.contracts";

const MATERIALS_SHEET = "Materiales";
const FICHAS_SHEET = "Fichas";

type ImportIssue = {
	sheet: typeof MATERIALS_SHEET | typeof FICHAS_SHEET;
	row: number;
	message: string;
};

type SheetCell = string | number | undefined;

type MaterialesSheetRow = {
	Artículo: SheetCell;
	Color: SheetCell;
	Medida: SheetCell;
	Diseño: SheetCell;
	Nombre: SheetCell;
	Unidad: SheetCell;
	"Stock actual": SheetCell;
};

type FichasSheetRow = {
	Modelo: SheetCell;
	"Nombre modelo": SheetCell;
	Artículo: SheetCell;
	Color: SheetCell;
	Medida: SheetCell;
	Diseño: SheetCell;
	Unidad: SheetCell;
	"Consumo por unidad": SheetCell;
};

type RawMaterialRecord = {
	id: string;
	article: string;
	color: string;
	measure: string;
	design: string;
	name: string | null;
	unit: string;
	stockQty: PrismaNamespace.Decimal;
	updatedAt: Date;
};

function groupingKey(row: {
	article: string;
	color: string;
	measure: string;
	design: string;
}) {
	return {
		article_color_measure_design: {
			article: row.article,
			color: row.color,
			measure: row.measure,
			design: row.design,
		},
	};
}

@Injectable()
export class MaterialsService {
	private readonly logger = new Logger(MaterialsService.name);

	constructor(@InjectDatabase() private readonly db: Db) {}

	async listRawMaterials(input: ListInput) {
		const where: PrismaNamespace.RawMaterialWhereInput = input.q
			? {
					OR: [
						{ article: { contains: input.q, mode: "insensitive" } },
						{ name: { contains: input.q, mode: "insensitive" } },
						{ color: { contains: input.q, mode: "insensitive" } },
						{ design: { contains: input.q, mode: "insensitive" } },
					],
				}
			: {};

		const orderBy =
			resolveOrderBy<PrismaNamespace.RawMaterialOrderByWithRelationInput>(
				input,
				{
					article: (dir) => ({ article: dir }),
					name: (dir) => ({ name: dir }),
					unit: (dir) => ({ unit: dir }),
					stockQty: (dir) => ({ stockQty: dir }),
					updatedAt: (dir) => ({ updatedAt: dir }),
				} satisfies OrderByColumns<PrismaNamespace.RawMaterialOrderByWithRelationInput>,
				{ article: "asc" },
			);

		const { skip, take } = paginate(input);

		const [rows, total] = await Promise.all([
			this.db.rawMaterial.findMany({ where, orderBy, skip, take }),
			this.db.rawMaterial.count({ where }),
		]);

		return {
			rows: rows.map((row) => this.serializeMaterial(row)),
			total,
			facetCounts: {},
		};
	}

	async updateStock(id: string, stockQty: number) {
		const row = await this.db.rawMaterial.update({
			where: { id },
			data: { stockQty },
		});
		return this.serializeMaterial(row);
	}

	async deleteRawMaterial(id: string) {
		await this.db.rawMaterial.delete({ where: { id } });
		return { id };
	}

	async listModels(input: ListInput) {
		const where: PrismaNamespace.ProductModelWhereInput = input.q
			? {
					OR: [
						{ code: { contains: input.q, mode: "insensitive" } },
						{ name: { contains: input.q, mode: "insensitive" } },
					],
				}
			: {};

		const orderBy =
			resolveOrderBy<PrismaNamespace.ProductModelOrderByWithRelationInput>(
				input,
				{
					code: (dir) => ({ code: dir }),
					name: (dir) => ({ name: dir }),
					updatedAt: (dir) => ({ updatedAt: dir }),
				} satisfies OrderByColumns<PrismaNamespace.ProductModelOrderByWithRelationInput>,
				{ code: "asc" },
			);

		const { skip, take } = paginate(input);

		const [rows, total] = await Promise.all([
			this.db.productModel.findMany({
				where,
				orderBy,
				skip,
				take,
				include: { _count: { select: { materials: true } } },
			}),
			this.db.productModel.count({ where }),
		]);

		return {
			rows: rows.map((row) => ({
				id: row.id,
				code: row.code,
				name: row.name,
				materialsCount: row._count.materials,
				updatedAt: row.updatedAt.toISOString(),
			})),
			total,
			facetCounts: {},
		};
	}

	async modelDetail(id: string) {
		const model = await this.db.productModel.findUniqueOrThrow({
			where: { id },
			include: { materials: { include: { rawMaterial: true } } },
		});

		return {
			id: model.id,
			code: model.code,
			name: model.name,
			materials: model.materials
				.map((line) => ({
					id: line.id,
					rawMaterialId: line.rawMaterialId,
					article: line.rawMaterial.article,
					color: line.rawMaterial.color,
					measure: line.rawMaterial.measure,
					design: line.rawMaterial.design,
					unit: line.rawMaterial.unit,
					consumptionPerUnit: line.consumptionPerUnit.toNumber(),
				}))
				.sort((a, b) => a.article.localeCompare(b.article)),
		};
	}

	async deleteModel(id: string) {
		await this.db.productModel.delete({ where: { id } });
		return { id };
	}

	async importExcel(input: ImportExcelInput): Promise<ImportExcelOutput> {
		const workbook = readWorkbook(Buffer.from(input.fileBase64, "base64"), {
			type: "buffer",
		});

		const materialsSheet = workbook.Sheets[MATERIALS_SHEET];
		const fichasSheet = workbook.Sheets[FICHAS_SHEET];

		if (!materialsSheet && !fichasSheet) {
			throw new BadRequestException(
				`The file has neither a "${MATERIALS_SHEET}" sheet nor a "${FICHAS_SHEET}" sheet.`,
			);
		}

		const issues: ImportIssue[] = [];
		const materialRows = materialsSheet
			? this.parseSheet<RawMaterialImportRow, MaterialesSheetRow>(
					materialsSheet,
					MATERIALS_SHEET,
					rawMaterialImportRow,
					mapMaterialCells,
					issues,
				)
			: [];
		const fichaRows = fichasSheet
			? this.parseSheet<FichaImportRow, FichasSheetRow>(
					fichasSheet,
					FICHAS_SHEET,
					fichaImportRow,
					mapFichaCells,
					issues,
				)
			: [];

		if (issues.length > 0) {
			this.logger.warn({
				message: "Materials import rejected",
				issueCount: issues.length,
			});
			return {
				materialsCreated: 0,
				materialsUpdated: 0,
				modelsCreated: 0,
				modelsUpdated: 0,
				bomLinesCreated: 0,
				bomLinesUpdated: 0,
				errors: issues,
			};
		}

		const counts = {
			materialsCreated: 0,
			materialsUpdated: 0,
			modelsCreated: 0,
			modelsUpdated: 0,
			bomLinesCreated: 0,
			bomLinesUpdated: 0,
		};

		await this.db.$transaction(async (tx) => {
			for (const row of materialRows) {
				const created = await this.upsertMaterial(tx, row);
				if (created) counts.materialsCreated++;
				else counts.materialsUpdated++;
			}

			for (const row of fichaRows) {
				await this.upsertFichaLine(tx, row, counts);
			}
		});

		this.logger.log({ message: "Materials import applied", ...counts });

		return { ...counts, errors: [] };
	}

	async requirement(input: RequirementInput): Promise<RequirementOutput> {
		const codes = [...new Set(input.plan.map((entry) => entry.modelCode))];
		const models = await this.db.productModel.findMany({
			where: { code: { in: codes } },
			include: { materials: { include: { rawMaterial: true } } },
		});

		const modelByCode = new Map(models.map((model) => [model.code, model]));
		const unknownModelCodes = codes.filter((code) => !modelByCode.has(code));

		const required = new Map<
			string,
			{ material: RawMaterialRecord; qty: PrismaNamespace.Decimal }
		>();

		for (const entry of input.plan) {
			const model = modelByCode.get(entry.modelCode);
			if (!model) continue;

			for (const line of model.materials) {
				const existing = required.get(line.rawMaterialId);
				const add = line.consumptionPerUnit.mul(entry.quantity);
				if (existing) {
					existing.qty = existing.qty.add(add);
				} else {
					required.set(line.rawMaterialId, {
						material: line.rawMaterial,
						qty: add,
					});
				}
			}
		}

		const rows = [...required.values()]
			.map(({ material, qty }) => {
				const stock = material.stockQty;
				const toOrder = qty.gt(stock)
					? qty.sub(stock)
					: new PrismaNamespace.Decimal(0);
				return {
					rawMaterialId: material.id,
					article: material.article,
					color: material.color,
					measure: material.measure,
					design: material.design,
					unit: material.unit,
					required: qty.toNumber(),
					stock: stock.toNumber(),
					toOrder: toOrder.toNumber(),
				};
			})
			.sort(
				(a, b) => b.toOrder - a.toOrder || a.article.localeCompare(b.article),
			);

		return { rows, unknownModelCodes };
	}

	private parseSheet<Row, RawRow>(
		sheet: WorkSheet,
		sheetName: typeof MATERIALS_SHEET | typeof FICHAS_SHEET,
		schema: ZodType<Row>,
		mapCells: (raw: RawRow) => unknown,
		issues: ImportIssue[],
	): Row[] {
		const raw = xlsxUtils.sheet_to_json<RawRow>(sheet, { defval: "" });

		const parsed: Row[] = [];
		raw.forEach((cells, index) => {
			const result = schema.safeParse(mapCells(cells));
			if (result.success && result.data) {
				parsed.push(result.data);
				return;
			}
			const message = (result.error?.issues ?? [])
				.map((issue) => `${issue.path.join(".") || "row"}: ${issue.message}`)
				.join("; ");
			issues.push({
				sheet: sheetName,
				row: index + 2,
				message: message || "Invalid row.",
			});
		});

		return parsed;
	}

	private async upsertMaterial(
		tx: PrismaNamespace.TransactionClient,
		row: RawMaterialImportRow,
	): Promise<boolean> {
		const key = groupingKey(row);
		const existing = await tx.rawMaterial.findUnique({ where: key });

		if (existing) {
			await tx.rawMaterial.update({
				where: key,
				data: { name: row.name, unit: row.unit, stockQty: row.stockQty },
			});
			return false;
		}

		await tx.rawMaterial.create({
			data: {
				article: row.article,
				color: row.color,
				measure: row.measure,
				design: row.design,
				name: row.name,
				unit: row.unit,
				stockQty: row.stockQty,
			},
		});
		return true;
	}

	private async upsertFichaLine(
		tx: PrismaNamespace.TransactionClient,
		row: FichaImportRow,
		counts: {
			modelsCreated: number;
			modelsUpdated: number;
			bomLinesCreated: number;
			bomLinesUpdated: number;
		},
	): Promise<void> {
		const existingModel = await tx.productModel.findUnique({
			where: { code: row.modelCode },
		});
		const model = existingModel
			? await tx.productModel.update({
					where: { id: existingModel.id },
					data: row.modelName ? { name: row.modelName } : {},
				})
			: await tx.productModel.create({
					data: { code: row.modelCode, name: row.modelName },
				});
		if (existingModel) counts.modelsUpdated++;
		else counts.modelsCreated++;

		const materialKey = groupingKey(row);
		const material =
			(await tx.rawMaterial.findUnique({ where: materialKey })) ??
			(await tx.rawMaterial.create({
				data: {
					article: row.article,
					color: row.color,
					measure: row.measure,
					design: row.design,
					unit: row.unit,
				},
			}));

		const lineKey = {
			productModelId_rawMaterialId: {
				productModelId: model.id,
				rawMaterialId: material.id,
			},
		};
		const existingLine = await tx.productModelMaterial.findUnique({
			where: lineKey,
		});

		if (existingLine) {
			await tx.productModelMaterial.update({
				where: lineKey,
				data: { consumptionPerUnit: row.consumptionPerUnit },
			});
			counts.bomLinesUpdated++;
		} else {
			await tx.productModelMaterial.create({
				data: {
					productModelId: model.id,
					rawMaterialId: material.id,
					consumptionPerUnit: row.consumptionPerUnit,
				},
			});
			counts.bomLinesCreated++;
		}
	}

	private serializeMaterial(row: RawMaterialRecord) {
		return {
			id: row.id,
			article: row.article,
			color: row.color,
			measure: row.measure,
			design: row.design,
			name: row.name,
			unit: row.unit,
			stockQty: row.stockQty.toNumber(),
			updatedAt: row.updatedAt.toISOString(),
		};
	}
}

function mapMaterialCells(
	raw: MaterialesSheetRow,
): z.input<typeof rawMaterialImportRow> {
	return {
		article: raw.Artículo ?? "",
		color: raw.Color,
		measure: raw.Medida,
		design: raw.Diseño,
		name: raw.Nombre,
		unit: raw.Unidad ?? "",
		stockQty: raw["Stock actual"],
	};
}

function mapFichaCells(raw: FichasSheetRow): z.input<typeof fichaImportRow> {
	return {
		modelCode: raw.Modelo ?? "",
		modelName: raw["Nombre modelo"],
		article: raw.Artículo ?? "",
		color: raw.Color,
		measure: raw.Medida,
		design: raw.Diseño,
		unit: raw.Unidad ?? "",
		consumptionPerUnit: raw["Consumo por unidad"] ?? "",
	};
}
