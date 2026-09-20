import { Module } from "@nestjs/common";
import { TrpcModule } from "../trpc/trpc.module";
import { MaterialsRouter } from "./materials.router";
import { MaterialsService } from "./materials.service";

@Module({
	imports: [TrpcModule],
	providers: [MaterialsService, MaterialsRouter],
	exports: [MaterialsService],
})
export class MaterialsModule {}
