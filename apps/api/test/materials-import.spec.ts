import { describe, expect, it } from "bun:test";
import {
	fichaImportRow,
	rawMaterialImportRow,
} from "../src/materials/materials.contracts";

describe("rawMaterialImportRow", () => {
	it("defaults color, measure and design to empty strings for grouping", () => {
		const result = rawMaterialImportRow.parse({
			article: "TELA-001",
			color: "",
			measure: "",
			design: "",
			name: "",
			unit: "m",
			stockQty: "",
		});

		expect(result).toEqual({
			article: "TELA-001",
			color: "",
			measure: "",
			design: "",
			name: null,
			unit: "m",
			stockQty: 0,
		});
	});

	it("coerces numeric-looking cells and trims text", () => {
		const result = rawMaterialImportRow.parse({
			article: "  TELA-001  ",
			color: "Negro",
			measure: "1.5m",
			design: "Liso",
			name: "Tela principal",
			unit: "m",
			stockQty: 120,
		});

		expect(result.article).toBe("TELA-001");
		expect(result.stockQty).toBe(120);
	});

	it("rejects a row with no article", () => {
		const result = rawMaterialImportRow.safeParse({
			article: "",
			unit: "m",
		});

		expect(result.success).toBe(false);
	});
});

describe("fichaImportRow", () => {
	it("requires a model code, article and unit", () => {
		const result = fichaImportRow.safeParse({
			modelCode: "MOD-100",
			article: "TELA-001",
			unit: "m",
			consumptionPerUnit: 1.8,
		});

		expect(result.success).toBe(true);
	});

	it("rejects a missing consumption value", () => {
		const result = fichaImportRow.safeParse({
			modelCode: "MOD-100",
			article: "TELA-001",
			unit: "m",
			consumptionPerUnit: "not-a-number",
		});

		expect(result.success).toBe(false);
	});
});
