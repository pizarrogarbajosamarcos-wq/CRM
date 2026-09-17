import { Module } from "@nestjs/common";
import { CompaniesModule } from "../companies/companies.module";
import { DealsModule } from "../deals/deals.module";
import { IngestRouter } from "./ingest.router";
import { IngestService } from "./ingest.service";
import { SignalQualificationService } from "./signal-qualification.service";

@Module({
	imports: [CompaniesModule, DealsModule],
	providers: [IngestService, SignalQualificationService, IngestRouter],
	exports: [IngestService, SignalQualificationService],
})
export class IngestModule {}
