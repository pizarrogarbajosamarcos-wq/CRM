import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchCachedPage } from "../agent/lib/local-campaign-cache";
import {
	localCampaignCsv,
	localCampaignJsonl,
} from "../agent/lib/local-campaign-export";
import { parseLocalCampaignResponse } from "../agent/lib/local-campaign-extraction";
import {
	assertLocalCampaignOnly,
	loadCampaignSeeds,
	runLocalCampaign,
} from "../agent/lib/local-campaign-runner";
import { localCampaignSchema } from "../agent/lib/local-campaign-schema";
import { scoreLocalCampaignLead } from "../agent/lib/local-campaign-scoring";
import {
	assertLocalCampaignPath,
	dedupeAgainst,
	normalizeDomain,
} from "../agent/lib/local-campaign-staging";

const campaign = localCampaignSchema.parse({
	campaign_id: "test-campaign",
	project: "PartWall",
	target_customer_type: "exhibitor",
	geography: ["United States"],
	source_types: ["seed_url", "manual_list"],
	seed_urls: ["https://example.com/one"],
	keywords: ["exhibitor", "display"],
	exclusions: ["consumer retail"],
	max_companies: 2,
	max_pages_per_domain: 1,
	required_fields: ["company_name", "website", "evidence_excerpt"],
	scoring_rules: {
		fit_keyword_points: 20,
		evidence_points: 40,
		contact_field_points: 15,
	},
});

const leadJson = JSON.stringify({
	company_name: "Acme Displays",
	website: "https://acme.example",
	contact_name: null,
	role: null,
	email: null,
	phone: null,
	location: "Chicago",
	source_url: "https://example.com/one",
	evidence_excerpt:
		"Acme Displays, https://acme.example, is an exhibitor display company in Chicago.",
	project_fit_reason: "The exhibitor needs display equipment.",
	missing_fields: ["contact_name", "role", "email", "phone"],
});

describe("local campaign runner", () => {
	it("validates campaign definitions", () => {
		expect(localCampaignSchema.safeParse(campaign).success).toBe(true);
	});

	it("loads CSV and JSONL seed lists", async () => {
		const directory = await mkdtemp(join(tmpdir(), "local-campaign-"));
		try {
			const csv = join(directory, "seeds.csv");
			const jsonl = join(directory, "seeds.jsonl");
			await Bun.write(csv, "url\nhttps://example.com/a\n");
			await Bun.write(jsonl, '{"url":"https://example.com/b"}\n');
			expect(await loadCampaignSeeds(csv)).toEqual(["https://example.com/a"]);
			expect(await loadCampaignSeeds(jsonl)).toEqual(["https://example.com/b"]);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("rejects quoted CSV fields and recommends JSONL", async () => {
		const directory = await mkdtemp(join(tmpdir(), "local-campaign-csv-"));
		try {
			const csv = join(directory, "quoted.csv");
			await Bun.write(csv, 'url\n"https://example.com/a,b"\n');
			await expect(loadCampaignSeeds(csv)).rejects.toThrow("Use JSONL");
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("reuses cached pages and respects domain caps", async () => {
		let loads = 0;
		const result = await runLocalCampaign(
			campaign,
			["https://example.com/one", "https://example.com/two"],
			{
				pageLoader: async () => {
					loads += 1;
					return {
						cached: loads === 1,
						page: {
							url: "https://example.com/one",
							content_hash: "hash",
							text: "Acme Displays is an exhibitor display company in Chicago.",
							fetched_at: new Date().toISOString(),
						},
					};
				},
				client: { generate: async () => ({ text: leadJson, latencyMs: 4 }) },
				stager: async (lead, path) => ({
					path: path ?? "local",
					staged: lead,
					duplicate: false,
				}),
			},
		);
		expect(loads).toBe(1);
		expect(result.cached).toBe(1);
	});

	it("continues after an invalid extraction and reports the failure", async () => {
		const secondUrl = "https://example.org/two";
		let calls = 0;
		const result = await runLocalCampaign(
			campaign,
			["https://example.com/one", secondUrl],
			{
				pageLoader: async (url) => ({
					cached: false,
					page: {
						url,
						content_hash: url,
						text: "A public exhibitor page.",
						fetched_at: new Date().toISOString(),
					},
				}),
				client: {
					generate: async () => ({
						text:
							calls++ === 0
								? '{"invalid":true}'
								: leadJson.replace("https://example.com/one", secondUrl),
						latencyMs: 4,
					}),
				},
				stager: async (lead, path) => ({
					path: path ?? "local",
					staged: lead,
					duplicate: false,
				}),
			},
		);
		expect(result.processed).toBe(2);
		expect(result.extracted).toBe(1);
		expect(result.extraction_failures).toBe(1);
		expect(result.staged).toBe(1);
		expect(result.failures[0]?.stage).toBe("extraction");
	});

	it("caches fetched page content by URL", async () => {
		const directory = await mkdtemp(join(tmpdir(), "local-campaign-cache-"));
		try {
			const path = join(directory, "pages.jsonl");
			let calls = 0;
			const fetchImpl: typeof fetch = async () => {
				calls += 1;
				return new Response("cached page", { status: 200 });
			};
			const first = await fetchCachedPage(
				"https://example.com/page",
				fetchImpl,
				path,
			);
			const second = await fetchCachedPage(
				"https://example.com/page",
				fetchImpl,
				path,
			);
			expect(first.cached).toBe(false);
			expect(second.cached).toBe(true);
			expect(calls).toBe(1);
			expect(second.page.content_hash).toBe(first.page.content_hash);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("rejects unsupported model output and preserves evidence rules", () => {
		expect(() =>
			parseLocalCampaignResponse(
				`\`\`\`json\n${leadJson}\n\`\`\``,
				"https://example.com/one",
			),
		).toThrow();
		expect(() =>
			parseLocalCampaignResponse(
				leadJson.replace("Acme Displays", "Invented Company"),
				"https://example.com/one",
			),
		).toThrow("company_name is not present");
	});

	it("scores from keywords, evidence, and fields", () => {
		const lead = parseLocalCampaignResponse(
			leadJson,
			"https://example.com/one",
		);
		const scores = scoreLocalCampaignLead(lead, campaign);
		expect(scores.fit_score).toBeGreaterThan(0);
		expect(scores.evidence_score).toBe(60);
		expect(scores.contact_completeness_score).toBe(0);
		expect(scores.review_required_reason).toContain("Email is missing.");
	});

	it("deduplicates normalized domain and exports JSONL and CSV", async () => {
		expect(normalizeDomain("WWW.Example.com.")).toBe("example.com");
		const lead = {
			...parseLocalCampaignResponse(leadJson, "https://example.com/one"),
			...scoreLocalCampaignLead(
				parseLocalCampaignResponse(leadJson, "https://example.com/one"),
				campaign,
			),
			campaign_id: campaign.campaign_id,
			lead_id: "lead",
			source_domain: "example.com",
			status: "new" as const,
		};
		expect(dedupeAgainst(lead, [lead])).not.toBeNull();
		const jsonl = localCampaignJsonl([lead]);
		const csv = localCampaignCsv([lead]);
		expect(JSON.parse(jsonl).lead_id).toBe("lead");
		expect(csv).toContain("campaign_id");
	});

	it("refuses CRM synchronization flags before work", () => {
		expect(() => assertLocalCampaignOnly(["run", "--sync-crm"])).toThrow();
	});

	it("keeps staging and export paths under local lead storage", () => {
		expect(assertLocalCampaignPath("var/local-leads/export.csv")).toEndWith(
			"/apps/agent/var/local-leads/export.csv",
		);
		expect(() => assertLocalCampaignPath("../../outside.csv")).toThrow(
			"var/local-leads",
		);
	});
});
