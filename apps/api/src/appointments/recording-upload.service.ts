import { randomUUID } from "node:crypto";
import type { Db } from "@crm/db";
import { Injectable } from "@nestjs/common";
import type { AssetActor } from "../assets/asset-actor";
import { appointmentProjectId } from "../assets/asset-context.service";
import { AssetError } from "../assets/asset-error";
import { AssetFiles } from "../assets/asset-files.service";
import { AssetMutations } from "../assets/asset-mutation.service";
import { AssetStorageService } from "../assets/asset-storage.service";
import { AssetTransfers } from "../assets/asset-transfer.service";
import { completeAssetUpload } from "../assets/asset-upload-completion";
import { AssetCreation } from "../assets/asset-upload-create.service";
import { InjectScopedDatabase } from "../database/database.constants";
import {
	type RecordingCompleteBody,
	type RecordingUploadSlot,
	type RecordingUploadUrlBody,
	recordingCompleteSchema,
	recordingUploadSlotSchema,
} from "./recording-upload.contracts";

@Injectable()
export class RecordingUploadService {
	private readonly creation: AssetCreation;
	private readonly transfers: AssetTransfers;
	private readonly files: AssetFiles;
	private readonly mutations: AssetMutations;

	constructor(
		@InjectScopedDatabase() private readonly db: Db,
		private readonly storage: AssetStorageService,
	) {
		this.mutations = new AssetMutations(db);
		this.creation = new AssetCreation(this.mutations, storage);
		this.transfers = new AssetTransfers(db, storage);
		this.files = new AssetFiles(this.mutations);
	}

	async requestUploadUrl(
		actor: AssetActor,
		appointmentId: string,
		raw: RecordingUploadUrlBody,
		key?: string,
	): Promise<RecordingUploadSlot> {
		const projectId = await appointmentProjectId(this.db, actor, appointmentId);
		const pending = await this.findPending(appointmentId);
		if (pending) return this.slot(actor, projectId, pending.id);
		await this.retirePrevious(actor, projectId, appointmentId);
		const createKey =
			key ?? `mobile-recording:${appointmentId}:${randomUUID()}`;
		const { assetId } = await this.creation.createAsset(
			actor,
			projectId,
			{
				fileName: raw.filename,
				contentType: raw.contentType,
				sizeBytes: raw.byteSize,
				kind: "meeting_recording",
				source: "MOBILE_RECORDING",
			},
			createKey,
			appointmentId,
		);
		return this.slot(actor, projectId, assetId);
	}

	async completeUpload(
		actor: AssetActor,
		appointmentId: string,
		raw: RecordingCompleteBody,
		key?: string,
	) {
		const projectId = await appointmentProjectId(this.db, actor, appointmentId);
		const completeKey = key ?? `mobile-recording-complete:${raw.objectKey}`;
		return this.mutations.run(
			actor,
			projectId,
			"COMPLETE_RECORDING",
			`/appointments/${appointmentId}/recordings/complete`,
			completeKey,
			raw,
			recordingCompleteSchema,
			async (tx) => {
				const asset = await tx.artifact.findFirst({
					where: {
						id: raw.objectKey,
						dealId: projectId,
						activityId: appointmentId,
						kind: "meeting_recording",
						source: "MOBILE_RECORDING",
						status: { in: ["UNVERIFIED", "READY"] },
					},
				});
				if (!asset)
					throw new AssetError(
						409,
						"ASSET_NOT_READY",
						"The recording upload is missing or does not belong to this appointment.",
					);
				await tx.artifact.update({
					where: { id: asset.id },
					data: {
						durationMilliseconds: BigInt(raw.durationSeconds * 1000),
						updatedAt: new Date(),
					},
				});
				await completeAssetUpload(tx, this.storage, projectId, asset.id);
				return { ok: true as const };
			},
			{ appointmentId },
		);
	}

	private async slot(actor: AssetActor, projectId: string, assetId: string) {
		const transfer = await this.transfers.issue(actor, projectId, assetId);
		if (!transfer)
			throw new AssetError(
				409,
				"ASSET_NOT_READY",
				"The recording upload no longer accepts a transfer.",
			);
		return recordingUploadSlotSchema.parse({
			uploadUrl: transfer.url,
			method: transfer.method,
			headers: transfer.headers,
			objectKey: assetId,
			expiresAt: transfer.expiresAt,
		});
	}

	private async findPending(appointmentId: string) {
		const assets = await this.db.artifact.findMany({
			where: {
				activityId: appointmentId,
				kind: "meeting_recording",
				source: "MOBILE_RECORDING",
				status: "UNVERIFIED",
			},
			orderBy: [{ createdAt: "desc" }, { id: "desc" }],
			take: 5,
		});
		for (const asset of assets) {
			const upload = await this.db.assetUpload.findUnique({
				where: { assetId: asset.id },
			});
			if (upload?.status === "PENDING" && upload.expiresAt > new Date())
				return asset;
		}
		return null;
	}

	private async retirePrevious(
		actor: AssetActor,
		projectId: string,
		appointmentId: string,
	) {
		const previous = await this.db.artifact.findMany({
			where: {
				activityId: appointmentId,
				kind: "meeting_recording",
				source: "MOBILE_RECORDING",
				status: { in: ["UNVERIFIED", "READY"] },
			},
			select: { id: true },
		});
		for (const asset of previous) {
			await this.files.deleteAsset(actor, projectId, asset.id, randomUUID());
		}
	}
}
