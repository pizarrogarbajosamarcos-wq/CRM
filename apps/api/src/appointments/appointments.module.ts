import { Module } from "@nestjs/common";
import { AssetsModule } from "../assets/assets.module";
import { TrpcModule } from "../trpc/trpc.module";
import { AppointmentsRouter } from "./appointments.router";
import { AppointmentsService } from "./appointments.service";
import { RecordingUploadService } from "./recording-upload.service";

@Module({
	imports: [TrpcModule, AssetsModule],
	providers: [AppointmentsRouter, AppointmentsService, RecordingUploadService],
	exports: [AppointmentsService, RecordingUploadService],
})
export class AppointmentsModule {}
