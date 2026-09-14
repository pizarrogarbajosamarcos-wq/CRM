import { describe, expect, it } from "bun:test";
import { isProjectResourcePath } from "../src/assets/asset-public-routes";

describe("public asset resource routing", () => {
	it("recognizes canonical assets and managed appointment paths", () => {
		for (const path of [
			"/projects/p/assets",
			"/projects/p/assets/a",
			"/appointments/a/assets",
			"/assets/a",
			"/projects/p/appointments",
			"/projects/p/appointments/a",
		])
			expect(isProjectResourcePath(path)).toBe(true);
	});

	it("excludes workflow, customer, versioned, and unrelated paths", () => {
		for (const path of [
			"/projects/p/asset-uploads",
			"/projects/p/asset-uploads/a/confirm",
			"/customers/c/assets",
			"/rest/v1/projects/p/assets",
			"/rest/projects/p/appointments",
			"/v1/customers/c/assets",
			"/companies/c",
			"/projects/p/assets-extra",
			"/api/auth",
			"/appointments/a/recordings/upload-url",
			"/appointments/a/recordings/complete",
		])
			expect(isProjectResourcePath(path)).toBe(false);
	});
});
