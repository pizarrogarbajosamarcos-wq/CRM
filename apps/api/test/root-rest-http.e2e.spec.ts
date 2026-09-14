import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { scopedDb } from "@crm/db/tenant-scope";
import { SwaggerModule } from "@nestjs/swagger";
import { AppRouterHost } from "nestjs-trpc";
import request from "supertest";
import { generateOpenApiDocument } from "trpc-to-openapi";
import { AssetsHttpFixture } from "./assets-http.fixture";
import { inAssetTenant } from "./assets-tenant.fixture";

describe("root REST bridge", () => {
	const fixture = new AssetsHttpFixture();
	beforeAll(() => fixture.setup());
	afterAll(() => fixture.cleanup());

	it("serves root reads and mutations with the existing principal", async () => {
		const response = await request(fixture.app.getHttpServer())
			.get(`/companies/${fixture.customerId}`)
			.set("x-asset-test-user", fixture.userId)
			.expect(200);
		expect(response.body.id).toBe(fixture.customerId);
		const options = await request(fixture.app.getHttpServer())
			.get("/companies/options?q=Asset%20HTTP")
			.set("x-asset-test-user", fixture.userId)
			.expect(200);
		expect(options.body).toEqual(expect.any(Array));
		await request(fixture.app.getHttpServer())
			.post(`/companies/${fixture.customerId}/archive`)
			.set("x-asset-test-user", fixture.userId)
			.send({})
			.expect(200);
	});

	it("routes field filters and coverage before field keys", async () => {
		const field = await inAssetTenant(() =>
			scopedDb.fieldDefinition.create({
				data: {
					entity: "COMPANY",
					key: fixture.prefix,
					label: "Route test",
					position: 0,
					type: "TEXT",
				},
			}),
		);
		try {
			const filters = await request(fixture.app.getHttpServer())
				.get("/fields/COMPANY/filterable")
				.set("x-asset-test-user", fixture.userId)
				.expect(200);
			expect(filters.body).toEqual(expect.any(Array));
			const coverage = await request(fixture.app.getHttpServer())
				.get(`/fields/${field.id}/coverage`)
				.set("x-asset-test-user", fixture.userId)
				.expect(200);
			expect(coverage.body).toMatchObject({ filled: 0 });
			const byKey = await request(fixture.app.getHttpServer())
				.get(`/fields/COMPANY/${field.key}`)
				.set("x-asset-test-user", fixture.userId)
				.expect(200);
			expect(byKey.body.id).toBe(field.id);
		} finally {
			await inAssetTenant(() =>
				scopedDb.fieldDefinition.delete({ where: { id: field.id } }),
			);
		}
	});

	it("preserves authentication, OAuth scopes, tenancy, and session-only operations", async () => {
		await request(fixture.app.getHttpServer())
			.get(`/companies/${fixture.customerId}`)
			.expect(401);
		await request(fixture.app.getHttpServer())
			.get(`/companies/${fixture.customerId}`)
			.set("x-asset-test-user", fixture.userId)
			.set("x-asset-test-scope", "crm.write")
			.expect(403);
		await request(fixture.app.getHttpServer())
			.post(`/companies/${fixture.customerId}/restore`)
			.set("x-asset-test-user", fixture.userId)
			.set("x-asset-test-scope", "crm.read")
			.send({})
			.expect(403);
		await request(fixture.app.getHttpServer())
			.get("/api-keys")
			.set("x-asset-test-user", fixture.userId)
			.expect(401);
		const organizationId = fixture.principal.organizationId;
		fixture.principal.organizationId = "other-organization";
		try {
			await request(fixture.app.getHttpServer())
				.get(`/companies/${fixture.customerId}`)
				.set("x-asset-test-user", fixture.userId)
				.expect(403);
		} finally {
			fixture.principal.organizationId = organizationId;
		}
	});

	it("keeps native controllers, public endpoints, Swagger, and tRPC reachable", async () => {
		for (const path of [
			"/health",
			"/auth/session",
			"/",
			"/sso/sign-in-options",
		])
			await request(fixture.app.getHttpServer()).get(path).expect(200);
		await request(fixture.app.getHttpServer()).get("/auth/me").expect(401);
		await request(fixture.app.getHttpServer())
			.post("/push-tokens")
			.send({})
			.expect(401);
		const registered = await request(fixture.app.getHttpServer())
			.post("/push-tokens")
			.set("x-asset-test-user", fixture.userId)
			.send({ token: `${fixture.prefix}-fcm`, platform: "ios" })
			.expect(201);
		expect(registered.body).toEqual({ ok: true });
		await request(fixture.app.getHttpServer())
			.delete("/push-tokens")
			.set("x-asset-test-user", fixture.userId)
			.query({ token: `${fixture.prefix}-fcm` })
			.expect(200);
		await request(fixture.app.getHttpServer())
			.get("/api/auth/get-session")
			.expect(200);
		await request(fixture.app.getHttpServer())
			.get("/api/trpc/companies.byId")
			.query({ input: JSON.stringify({ id: fixture.customerId }) })
			.set("x-asset-test-user", fixture.userId)
			.expect(200);
	});

	it("publishes distinct root operations and rejects every old bridge route", async () => {
		const { appRouter } = fixture.app.get(AppRouterHost);
		const bridge = generateOpenApiDocument(appRouter, {
			title: "Test",
			version: "1",
			baseUrl: "http://localhost",
		});
		const native = SwaggerModule.createDocument(fixture.app, {
			info: { title: "Test", version: "1" },
			openapi: "3.0.0",
		});
		const response = await request(fixture.app.getHttpServer())
			.get("/openapi.json")
			.expect(200);
		expect(
			Object.keys(response.body.paths).some((path) =>
				/^\/(rest|v1)(\/|$)/.test(path),
			),
		).toBe(false);
		for (const [path, methods] of Object.entries(bridge.paths ?? {})) {
			for (const method of ["get", "post", "put", "patch", "delete"] as const) {
				if (!methods[method]) continue;
				expect(native.paths[path]?.[method]).toBeUndefined();
				expect(response.body.paths[path][method].operationId).toBe(
					methods[method]?.operationId,
				);
				await request(fixture.app.getHttpServer())
					[method](`/rest${path.replace(/\{[^}]+\}/g, "missing")}`)
					.send({})
					.expect(404);
			}
		}
		for (const path of [
			"/rest",
			"/rest/v1/customers/c/assets",
			"/rest/v1/projects/p/assets",
		])
			await request(fixture.app.getHttpServer()).get(path).expect(404);
	});
});
