import { Inject } from "@nestjs/common";
import { Input, Mutation, Query, Router, UseMiddlewares } from "nestjs-trpc";
import type { z } from "zod";
import { AuthMiddleware } from "../trpc/middlewares/auth.middleware";
import { restMeta } from "../trpc/openapi";
import {
	importExcelInput,
	importExcelOutput,
	materialListInput,
	materialListOutput,
	materialRowOutput,
	modelDetailOutput,
	modelIdInput,
	modelListInput,
	modelListOutput,
	rawMaterialIdInput,
	requirementInput,
	requirementOutput,
	updateStockInput,
} from "./materials.contracts";
import { MaterialsService } from "./materials.service";

@Router({ alias: "materials" })
@UseMiddlewares(AuthMiddleware)
export class MaterialsRouter {
	constructor(
		@Inject(MaterialsService) private readonly materials: MaterialsService,
	) {}

	@Query({
		input: materialListInput,
		output: materialListOutput,
		meta: restMeta("POST", "/materials/raw-materials/search", ["Materials"]),
	})
	async listRawMaterials(@Input() input: z.infer<typeof materialListInput>) {
		return this.materials.listRawMaterials(input);
	}

	@Mutation({
		input: updateStockInput,
		output: materialRowOutput,
		meta: restMeta("PATCH", "/materials/raw-materials/{id}/stock", [
			"Materials",
		]),
	})
	async updateStock(@Input() input: z.infer<typeof updateStockInput>) {
		return this.materials.updateStock(input.id, input.stockQty);
	}

	@Mutation({
		input: rawMaterialIdInput,
		output: rawMaterialIdInput,
		meta: restMeta("DELETE", "/materials/raw-materials/{id}", ["Materials"]),
	})
	async deleteRawMaterial(@Input("id") id: string) {
		return this.materials.deleteRawMaterial(id);
	}

	@Query({
		input: modelListInput,
		output: modelListOutput,
		meta: restMeta("POST", "/materials/models/search", ["Materials"]),
	})
	async listModels(@Input() input: z.infer<typeof modelListInput>) {
		return this.materials.listModels(input);
	}

	@Query({
		input: modelIdInput,
		output: modelDetailOutput,
		meta: restMeta("GET", "/materials/models/{id}", ["Materials"]),
	})
	async modelDetail(@Input("id") id: string) {
		return this.materials.modelDetail(id);
	}

	@Mutation({
		input: modelIdInput,
		output: modelIdInput,
		meta: restMeta("DELETE", "/materials/models/{id}", ["Materials"]),
	})
	async deleteModel(@Input("id") id: string) {
		return this.materials.deleteModel(id);
	}

	@Mutation({
		input: importExcelInput,
		output: importExcelOutput,
		meta: restMeta("POST", "/materials/import", ["Materials"]),
	})
	async importExcel(@Input() input: z.infer<typeof importExcelInput>) {
		return this.materials.importExcel(input);
	}

	@Mutation({
		input: requirementInput,
		output: requirementOutput,
		meta: restMeta("POST", "/materials/requirement", ["Materials"]),
	})
	async requirement(@Input() input: z.infer<typeof requirementInput>) {
		return this.materials.requirement(input);
	}
}
