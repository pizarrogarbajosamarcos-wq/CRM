import { describe, expect, it } from "bun:test";
import {
	extractLocalLead,
	fetchLocalLeadSource,
	parseLocalLeadResponse,
} from "../agent/lib/local-lead-extraction";

const sourceUrl = "https://example.com/acme";
const valid = JSON.stringify({
	company_name: "Acme Field Systems",
	website: "https://acmefield.example",
	contact_name: "Jordan Lee",
	role: "Head of Partnerships",
	email: null,
	phone: null,
	source_url: sourceUrl,
	evidence_excerpt: "Acme Field Systems. Jordan Lee — Head of Partnerships.",
	confidence_reason: "The page states the company, contact, and role.",
	missing_fields: ["email", "phone"],
});

describe("local lead extraction", () => {
	it("accepts valid strict JSON", () => {
		expect(parseLocalLeadResponse(valid, sourceUrl).contact_name).toBe(
			"Jordan Lee",
		);
	});

	it("requires null for missing email and phone", () => {
		const lead = parseLocalLeadResponse(valid, sourceUrl);
		expect(lead.email).toBeNull();
		expect(lead.phone).toBeNull();
	});

	it("rejects an invented-looking email without evidence", () => {
		const value = JSON.parse(valid) as Record<string, unknown>;
		value.email = "jordan@example.com";
		value.missing_fields = ["phone"];
		expect(() =>
			parseLocalLeadResponse(JSON.stringify(value), sourceUrl),
		).toThrow("email is not present in evidence_excerpt");
	});

	it("rejects markdown-wrapped JSON", () => {
		expect(() =>
			parseLocalLeadResponse(`\`\`\`json\n${valid}\n\`\`\``, sourceUrl),
		).toThrow("plain JSON object");
	});

	it("rejects invalid JSON", () => {
		expect(() => parseLocalLeadResponse("{not-json}", sourceUrl)).toThrow(
			"invalid JSON",
		);
	});

	it("requires an evidence excerpt", () => {
		const value = JSON.parse(valid) as Record<string, unknown>;
		value.evidence_excerpt = "";
		expect(() =>
			parseLocalLeadResponse(JSON.stringify(value), sourceUrl),
		).toThrow();
	});

	it("blocks private and internal source URLs before fetching", async () => {
		const fetchImpl = async () => {
			throw new Error("fetch must not run");
		};
		for (const url of [
			"http://127.0.0.1/private",
			"http://192.168.1.10/private",
			"http://service.internal/private",
			"http://printer.local/private",
		]) {
			await expect(fetchLocalLeadSource(url, fetchImpl)).rejects.toThrow(
				"Local source URLs are blocked",
			);
		}
	});

	it("enforces the source byte limit", async () => {
		const response = new Response("small", {
			status: 200,
			headers: { "content-length": "20" },
		});
		expect(
			fetchLocalLeadSource("https://example.com", async () => response, {
				maxBytes: 4,
				lookup: async () => [{ address: "93.184.216.34", family: 4 }],
			}),
		).rejects.toThrow("maximum content size");
	});

	it("rejects hostnames that resolve to local addresses", async () => {
		const fetchImpl: typeof fetch = async () => {
			throw new Error("fetch must not run");
		};
		for (const address of ["127.0.0.1", "10.0.0.4", "fd00::4"]) {
			await expect(
				fetchLocalLeadSource("https://public.example", fetchImpl, {
					lookup: async () => [
						{ address, family: address.includes(":") ? 6 : 4 },
					],
				}),
			).rejects.toThrow("local address");
		}
	});

	it("allows a hostname that resolves to a public address", async () => {
		const source = await fetchLocalLeadSource(
			"https://public.example",
			async () => new Response("public page", { status: 200 }),
			{ lookup: async () => [{ address: "93.184.216.34", family: 4 }] },
		);
		expect(source.text).toBe("public page");
	});

	it("rejects DNS lookup failure", async () => {
		await expect(
			fetchLocalLeadSource("https://public.example", fetch, {
				lookup: async () => {
					throw new Error("not found");
				},
			}),
		).rejects.toThrow("DNS lookup failed");
	});

	it("does not require DATABASE_URL or CRM modules", async () => {
		const result = await extractLocalLead(
			"Acme Field Systems. Jordan Lee — Head of Partnerships.",
			sourceUrl,
			{ generate: async () => ({ text: valid, latencyMs: 5 }) },
		);
		expect(result.parser_status).toBe("accepted");
	});
});
