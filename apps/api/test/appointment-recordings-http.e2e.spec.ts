import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { scopedDb } from "@crm/db/tenant-scope";
import request from "supertest";
import type { OpenAPIObject } from "trpc-to-openapi";
import { AssetsHttpFixture } from "./assets-http.fixture";
import { inAssetTenant } from "./assets-tenant.fixture";

describe("JobSteward recording upload REST contract", () => {
	const fixture = new AssetsHttpFixture();
	const appointmentBody = {
		title: "Kitchen site visit",
		startsAt: "2026-09-15T15:00:00Z",
		timeZone: "America/Chicago",
	};
	const recordingBody = {
		contentType: "audio/mp4",
		byteSize: 1843200,
		filename: "recording.m4a",
	};

	beforeAll(() => fixture.setup());
	afterAll(() => fixture.cleanup());

	async function createAppointment() {
		const response = await request(fixture.app.getHttpServer())
			.post(`/projects/${fixture.projectId}/appointments`)
			.set("x-asset-test-user", fixture.userId)
			.set("Idempotency-Key", randomUUID())
			.send(appointmentBody)
			.expect(200);
		return response.body.appointment.id as string;
	}

	function uploadUrl(appointmentId: string) {
		return request(fixture.app.getHttpServer())
			.post(`/appointments/${appointmentId}/recordings/upload-url`)
			.set("x-asset-test-user", fixture.userId)
			.send(recordingBody);
	}

	function complete(
		appointmentId: string,
		objectKey: string,
		durationSeconds = 767,
	) {
		return request(fixture.app.getHttpServer())
			.post(`/appointments/${appointmentId}/recordings/complete`)
			.set("x-asset-test-user", fixture.userId)
			.send({
				objectKey,
				contentType: "audio/mp4",
				byteSize: recordingBody.byteSize,
				durationSeconds,
			});
	}

	it("accepts JobSteward upload-url bodies and returns a flat PUT slot", async () => {
		const appointmentId = await createAppointment();
		const response = await uploadUrl(appointmentId).expect(200);
		const objectKey = response.body.objectKey;
		const expiresAt = response.body.expiresAt;
		expect(objectKey).toEqual(expect.any(String));
		expect(expiresAt).toEqual(expect.any(String));
		expect(response.body).toMatchObject({
			method: "PUT",
			headers: {
				"Content-Type": "audio/mp4",
				"Content-Length": "1843200",
			},
		});
		expect(response.body.uploadUrl).toMatch(/^https:\/\//);
		expect(response.body).not.toHaveProperty("asset");
		expect(response.body).not.toHaveProperty("transfer");
		expect(typeof objectKey).toBe("string");
		expect(objectKey.length).toBeGreaterThan(0);
		const asset = await inAssetTenant(() =>
			scopedDb.artifact.findUniqueOrThrow({
				where: { id: objectKey },
			}),
		);
		expect(asset).toMatchObject({
			activityId: appointmentId,
			kind: "meeting_recording",
			source: "MOBILE_RECORDING",
			contentType: "audio/mp4",
			fileName: "recording.m4a",
			status: "UNVERIFIED",
		});
	});

	it("refreshes the same objectKey while the upload stays PENDING", async () => {
		const appointmentId = await createAppointment();
		const first = await uploadUrl(appointmentId).expect(200);
		const second = await uploadUrl(appointmentId).expect(200);
		expect(second.body.objectKey).toBe(first.body.objectKey);
		expect(second.body.uploadUrl).not.toBe(first.body.uploadUrl);
		expect(
			await inAssetTenant(() =>
				scopedDb.artifact.count({
					where: {
						activityId: appointmentId,
						kind: "meeting_recording",
						source: "MOBILE_RECORDING",
						status: "UNVERIFIED",
					},
				}),
			),
		).toBe(1);
	});

	it("completes without a client poll and accepts a second complete", async () => {
		const appointmentId = await createAppointment();
		const slot = await uploadUrl(appointmentId).expect(200);
		await fixture.put(slot.body.objectKey, recordingBody.byteSize);
		const first = await complete(appointmentId, slot.body.objectKey).expect(
			200,
		);
		expect(first.body).toEqual({ ok: true });
		const upload = await fixture.uploadFor(slot.body.objectKey);
		expect(upload.status).toBe("FINALIZING");
		expect(
			await inAssetTenant(() =>
				scopedDb.assetStorageJob.count({
					where: { uploadId: upload.id, operation: "FINALIZE_UPLOAD" },
				}),
			),
		).toBe(1);
		const asset = await inAssetTenant(() =>
			scopedDb.artifact.findUniqueOrThrow({
				where: { id: slot.body.objectKey },
			}),
		);
		expect(Number(asset.durationMilliseconds)).toBe(767_000);
		expect(
			(await complete(appointmentId, slot.body.objectKey).expect(200)).body,
		).toEqual({ ok: true });
	});

	it("returns 409 for foreign, missing, and expired complete requests", async () => {
		const appointmentId = await createAppointment();
		const otherAppointmentId = await createAppointment();
		const slot = await uploadUrl(appointmentId).expect(200);
		await complete(otherAppointmentId, slot.body.objectKey).expect(409);
		await complete(appointmentId, randomUUID()).expect(409);
		await inAssetTenant(() =>
			scopedDb.assetUpload.update({
				where: { assetId: slot.body.objectKey },
				data: { expiresAt: new Date(Date.now() - 1_000) },
			}),
		);
		await complete(appointmentId, slot.body.objectKey).expect(409);
	});

	it("documents recordings under Appointments and keeps Assets at seven", async () => {
		const document = await request(fixture.app.getHttpServer())
			.get("/openapi.json")
			.expect(200);
		const openapi = document.body as OpenAPIObject;
		const paths = openapi.paths ?? {};
		const upload = paths["/appointments/{appointmentId}/recordings/upload-url"];
		const done = paths["/appointments/{appointmentId}/recordings/complete"];
		expect(upload?.post?.tags).toEqual(["Appointments"]);
		expect(done?.post?.tags).toEqual(["Appointments"]);
		expect(upload?.post?.parameters ?? []).not.toContainEqual(
			expect.objectContaining({
				name: "Idempotency-Key",
				required: true,
			}),
		);
		const assetOperations = Object.entries(paths)
			.flatMap(([path, pathItem]) =>
				(["get", "post", "patch", "delete"] as const).flatMap((method) =>
					pathItem[method]?.tags?.includes("Assets")
						? [`${method} ${path}`]
						: [],
				),
			)
			.sort();
		expect(assetOperations).toHaveLength(7);
	});
});
