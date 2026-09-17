import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchCachedPage } from "../agent/lib/local-campaign-cache";
import {
	localCampaignCsv,
	localCampaignJsonl,
} from "../agent/lib/local-campaign-export";
import {
	extractLocalCampaignLead,
	parseLocalCampaignResponse,
} from "../agent/lib/local-campaign-extraction";
import {
	assertLocalCampaignOnly,
	loadCampaignSeeds,
	runLocalCampaign,
} from "../agent/lib/local-campaign-runner";
import { localCampaignSchema } from "../agent/lib/local-campaign-schema";
import { scoreLocalCampaignLead } from "../agent/lib/local-campaign-scoring";
import {
	extractLocalCampaignSourceUnits,
	hasUsefulPageEvidence,
	rankLocalCampaignSourceUnitText,
} from "../agent/lib/local-campaign-source-units";
import {
	assertLocalCampaignPath,
	dedupeAgainst,
	normalizeDomain,
} from "../agent/lib/local-campaign-staging";
import { createLocalOllamaClient } from "../agent/lib/local-ollama";

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
			await Bun.write(jsonl, '{"source_url":"https://example.com/b"}\n');
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
						text: "Acme Displays, https://acme.example, is an exhibitor display company in Chicago.",
						fetched_at: new Date().toISOString(),
					},
				}),
				client: {
					generate: async () => ({
						text:
							calls++ < 2
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

	it("requires project_fit_reason to be a string", () => {
		const value = JSON.parse(leadJson) as Record<string, unknown>;
		value.project_fit_reason = null;
		expect(() =>
			parseLocalCampaignResponse(
				JSON.stringify(value),
				"https://example.com/one",
			),
		).toThrow("project_fit_reason");
	});

	it("requires non-empty exact source evidence", () => {
		const emptyEvidence = JSON.parse(leadJson) as Record<string, unknown>;
		emptyEvidence.evidence_excerpt = "";
		expect(() =>
			parseLocalCampaignResponse(
				JSON.stringify(emptyEvidence),
				"https://example.com/one",
				"Acme Displays source text.",
			),
		).toThrow("evidence_excerpt");
		const wrongEvidence = JSON.parse(leadJson) as Record<string, unknown>;
		wrongEvidence.evidence_excerpt =
			"Acme Displays, https://acme.example, is an exhibitor display company in Chicago.";
		expect(() =>
			parseLocalCampaignResponse(
				JSON.stringify(wrongEvidence),
				"https://example.com/one",
				"Different source text.",
			),
		).toThrow("evidence_excerpt is not present");
	});

	it("retries schema-invalid model output once and accepts a repaired response", async () => {
		const sourceText =
			"Acme Displays, https://acme.example, is an exhibitor display company in Chicago.";
		let calls = 0;
		const result = await extractLocalCampaignLead(
			sourceText,
			"https://example.com/one",
			{
				generate: async () => {
					calls += 1;
					return {
						text:
							calls === 1
								? JSON.stringify({
										...JSON.parse(leadJson),
										evidence_excerpt: "",
										project_fit_reason: null,
									})
								: leadJson,
						latencyMs: 5,
					};
				},
			},
		);
		expect(result.attempt_count).toBe(2);
		expect(result.latency_ms).toBe(10);
	});

	it("rejects after one failed repair attempt with the Zod issue", async () => {
		let calls = 0;
		await expect(
			extractLocalCampaignLead(
				"Acme Displays, https://acme.example, is an exhibitor display company in Chicago.",
				"https://example.com/one",
				{
					generate: async () => {
						calls += 1;
						return {
							text: JSON.stringify({
								...JSON.parse(leadJson),
								project_fit_reason: null,
							}),
							latencyMs: 5,
						};
					},
				},
			),
		).rejects.toThrow("project_fit_reason");
		expect(calls).toBe(2);
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

	it("extracts company source units from table rows", () => {
		const units = extractLocalCampaignSourceUnits(
			"<table><tr><td>Acme Displays LLC</td><td>https://acme.example</td><td>Chicago, IL</td></tr></table>",
			"https://example.com/exhibitors",
		);
		expect(units).toHaveLength(1);
		expect(units[0]?.extraction_method).toBe("table_row");
		expect(units[0]?.candidate_company_name).toContain("Acme Displays LLC");
		expect(units[0]?.candidate_website).toBe("https://acme.example");
	});

	it("extracts company source units from cards and list items", () => {
		const units = extractLocalCampaignSourceUnits(
			[
				"<div class='exhibitor-card'><h3>Fixture Systems Inc</h3><a href='https://fixture.example'>Website</a><p>Display fixtures in Dallas, TX</p></div>",
				"<ul><li>Panel Technology Ltd https://panel.example exhibit walls</li></ul>",
			].join(""),
			"https://example.com/exhibitors",
		);
		expect(units.map((unit) => unit.extraction_method)).toContain("card");
		expect(units.map((unit) => unit.extraction_method)).toContain("list_item");
	});

	it("extracts company source units from links with surrounding text", () => {
		const units = extractLocalCampaignSourceUnits(
			"<a href='https://booth.example'>Booth Systems Corp</a>",
			"https://example.com/exhibitors",
		);
		expect(units).toHaveLength(1);
		expect(units[0]?.extraction_method).toBe("link_context");
	});

	it("rejects title or venue only evidence and boilerplate", () => {
		expect(
			hasUsefulPageEvidence("Automate 2027 exhibitor directory at JI Expo"),
		).toBe(false);
		expect(
			extractLocalCampaignSourceUnits(
				"<li>Cookie settings privacy navigation menu</li>",
				"https://example.com/exhibitors",
			),
		).toHaveLength(0);
	});

	it("caps and trims source units", () => {
		const html = [
			"<tr><td>Acme Displays LLC</td><td>https://acme.example</td><td>Long text ".concat(
				"x".repeat(200),
				"</td></tr>",
			),
			"<tr><td>Beta Fixtures Inc</td><td>https://beta.example</td></tr>",
		].join("");
		const units = extractLocalCampaignSourceUnits(
			html,
			"https://example.com/exhibitors",
			{ max_source_units_per_page: 1, max_source_unit_chars: 80 },
		);
		expect(units).toHaveLength(1);
		expect(units[0]?.candidate_text.length).toBeLessThanOrEqual(80);
	});

	it("dedupes source units before Ollama", () => {
		const result = extractLocalCampaignSourceUnits(
			[
				"<tr><td>Acme Displays LLC</td><td>https://acme.example</td></tr>",
				"<li>Acme Displays LLC https://acme.example</li>",
			].join(""),
			"https://example.com/exhibitors",
		);
		expect(result).toHaveLength(1);
	});

	it("ranks company units with websites high", () => {
		const ranking = rankLocalCampaignSourceUnitText(
			"Acme Displays LLC https://acme.example custom trade show display fixtures",
			{ source_domain: "event.example" },
		);
		expect(ranking.rank_score).toBeGreaterThanOrEqual(70);
		expect(ranking.ranking_reasons).toContain("likely company name");
		expect(ranking.ranking_reasons).toContain("external company website");
	});

	it("ranks company units with booth evidence high", () => {
		const ranking = rankLocalCampaignSourceUnitText(
			"Beta Fixtures Inc booth 1240 industrial display products Austin, TX",
			{ source_domain: "event.example" },
		);
		expect(ranking.rank_score).toBeGreaterThanOrEqual(70);
		expect(ranking.ranking_reasons).toContain("booth or stand number");
	});

	it("ranks event titles low", () => {
		const ranking = rankLocalCampaignSourceUnitText(
			"PartWall 2027 exhibitor directory trade show registration",
			{ source_domain: "event.example" },
		);
		expect(ranking.rank_score).toBeLessThan(0);
		expect(ranking.ranking_reasons).toContain("page title or event-only text");
	});

	it("ranks venue-only evidence low", () => {
		const ranking = rankLocalCampaignSourceUnitText(
			"JI Expo venue event floor plan attendee registration",
			{ source_domain: "event.example" },
		);
		expect(ranking.rank_score).toBeLessThan(0);
		expect(ranking.ranking_reasons).toContain("event or venue level evidence");
	});

	it("ranks organizer boilerplate low", () => {
		const ranking = rankLocalCampaignSourceUnitText(
			"Organizer newsletter privacy terms copyright all rights reserved",
			{ source_domain: "event.example" },
		);
		expect(ranking.rank_score).toBeLessThan(0);
		expect(ranking.ranking_reasons).toContain(
			"navigation/footer/cookie boilerplate",
		);
	});

	it("sends top-ranked source units to Ollama first", async () => {
		const calls: string[] = [];
		const result = await runLocalCampaign(
			{ ...campaign, max_ollama_calls_per_seed: 1, max_companies: 5 },
			["https://example.com/exhibitors"],
			{
				pageLoader: async (url) => ({
					cached: false,
					page: {
						url,
						content_hash: "hash",
						text: [
							"<tr><td>Beta Fixtures Inc</td><td>general supplier listing</td></tr>",
							"<tr><td>Acme Displays LLC</td><td>https://acme.example</td><td>Booth 1240</td><td>custom trade show display fixtures</td></tr>",
						].join(""),
						fetched_at: new Date().toISOString(),
					},
				}),
				client: {
					generate: async ({ prompt }) => {
						calls.push(prompt);
						return {
							text: leadJson.replace(
								"https://example.com/one",
								"https://example.com/exhibitors",
							),
							latencyMs: 4,
						};
					},
				},
				stager: async (lead, path) => ({
					path: path ?? "local",
					staged: lead,
					duplicate: false,
				}),
			},
		);
		expect(result.ollama_calls).toBe(1);
		expect(calls[0]).toContain("Acme Displays LLC");
		expect(calls[0]).not.toContain("Beta Fixtures Inc");
	});

	it("records source unit ranking reasons on staged leads", async () => {
		const sourceText =
			"Acme Displays LLC https://acme.example Booth 1240 custom display fixtures Chicago, IL";
		const sourceLead = JSON.stringify({
			...JSON.parse(leadJson),
			source_url: "https://example.com/exhibitors",
			evidence_excerpt: sourceText,
		});
		const result = await runLocalCampaign(
			{ ...campaign, max_ollama_calls_per_seed: 1, max_companies: 5 },
			["https://example.com/exhibitors"],
			{
				pageLoader: async (url) => ({
					cached: false,
					page: {
						url,
						content_hash: "hash",
						text: `<tr><td>${sourceText}</td></tr>`,
						fetched_at: new Date().toISOString(),
					},
				}),
				client: {
					generate: async () => ({
						text: sourceLead,
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
		expect(result.leads[0]?.source_unit_rank_score).toBeGreaterThan(0);
		expect(result.leads[0]?.source_unit_ranking_reasons).toContain(
			"external company website",
		);
	});

	it("avoids whole-page model calls when source units exist", async () => {
		const calls: string[] = [];
		const result = await runLocalCampaign(
			{ ...campaign, max_ollama_calls_per_seed: 2, max_companies: 5 },
			["https://example.com/exhibitors"],
			{
				pageLoader: async (url) => ({
					cached: false,
					page: {
						url,
						content_hash: "hash",
						text: [
							"<tr><td>Acme Displays LLC</td><td>https://acme.example</td><td>Chicago, IL</td></tr>",
							"<tr><td>Beta Fixtures Inc</td><td>https://beta.example</td><td>Austin, TX</td></tr>",
						].join(""),
						fetched_at: new Date().toISOString(),
					},
				}),
				client: {
					generate: async ({ prompt }) => {
						calls.push(prompt);
						const sourceUrl = "https://example.com/exhibitors";
						return {
							text: leadJson.replace("https://example.com/one", sourceUrl),
							latencyMs: 4,
						};
					},
				},
				stager: async (lead, path) => ({
					path: path ?? "local",
					staged: lead,
					duplicate: false,
				}),
			},
		);
		expect(result.source_units).toBe(2);
		expect(result.ollama_calls).toBe(2);
		expect(calls.every((prompt) => !prompt.includes("<tr>"))).toBe(true);
	});

	it("rejects source unit output without company-level evidence", async () => {
		const thinLead = JSON.stringify({
			company_name: null,
			website: null,
			contact_name: null,
			role: null,
			email: null,
			phone: null,
			location: null,
			source_url: "https://example.com/exhibitors",
			evidence_excerpt: "Members Company Application",
			project_fit_reason:
				"The source text does not identify a specific company or website.",
			missing_fields: [
				"company_name",
				"website",
				"contact_name",
				"role",
				"email",
				"phone",
				"location",
			],
		});
		const result = await runLocalCampaign(
			{ ...campaign, max_ollama_calls_per_seed: 1, max_companies: 5 },
			["https://example.com/exhibitors"],
			{
				pageLoader: async (url) => ({
					cached: false,
					page: {
						url,
						content_hash: "hash",
						text: "<li>Members Company Application https://application.example</li>",
						fetched_at: new Date().toISOString(),
					},
				}),
				client: { generate: async () => ({ text: thinLead, latencyMs: 4 }) },
				stager: async (lead, path) => ({
					path: path ?? "local",
					staged: lead,
					duplicate: false,
				}),
			},
		);
		expect(result.staged).toBe(0);
		expect(result.failures[0]?.reason).toBe(
			"Source unit did not produce company-level evidence.",
		);
	});

	it("falls back to page-level extraction when no source units are found", async () => {
		let calls = 0;
		const result = await runLocalCampaign(
			campaign,
			["https://example.com/one"],
			{
				pageLoader: async (url) => ({
					cached: false,
					page: {
						url,
						content_hash: "hash",
						text: "Acme Displays, https://acme.example, is an exhibitor display company in Chicago.",
						fetched_at: new Date().toISOString(),
					},
				}),
				client: {
					generate: async () => {
						calls += 1;
						return { text: leadJson, latencyMs: 4 };
					},
				},
				stager: async (lead, path) => ({
					path: path ?? "local",
					staged: lead,
					duplicate: false,
				}),
			},
		);
		expect(calls).toBe(1);
		expect(result.source_units).toBe(0);
		expect(result.ollama_calls).toBe(1);
	});

	it("flushes per-seed failure status", async () => {
		const directory = await mkdtemp(join(tmpdir(), "local-campaign-status-"));
		const seedStatusPath = `var/local-leads/${directory.split("/").pop()}-status.jsonl`;
		try {
			const result = await runLocalCampaign(
				campaign,
				["https://example.com/one"],
				{
					pageLoader: async () => {
						throw new Error("Source fetch timed out.");
					},
					seedStatusPath,
				},
			);
			expect(result.seed_statuses).toHaveLength(1);
			expect(result.seed_statuses[0]?.failure_reason).toBe(
				"Source fetch timed out.",
			);
			expect(
				await readFile(
					new URL(`../${seedStatusPath}`, import.meta.url),
					"utf8",
				),
			).toContain("Source fetch timed out.");
		} finally {
			await rm(directory, { recursive: true, force: true });
			await rm(new URL(`../${seedStatusPath}`, import.meta.url), {
				force: true,
			});
		}
	});

	it("stops a seed when the per-seed timeout is reached", async () => {
		const result = await runLocalCampaign(
			{ ...campaign, max_ollama_calls_per_seed: 2 },
			["https://example.com/one"],
			{
				perSeedTimeoutMs: -1,
				pageLoader: async (url) => ({
					cached: false,
					page: {
						url,
						content_hash: "hash",
						text: "Acme Displays LLC is an exhibitor display company in Chicago.",
						fetched_at: new Date().toISOString(),
					},
				}),
				client: {
					generate: async () => {
						await new Promise((resolve) => setTimeout(resolve, 2));
						return { text: leadJson, latencyMs: 2 };
					},
				},
				stager: async (lead, path) => ({
					path: path ?? "local",
					staged: lead,
					duplicate: false,
				}),
			},
		);
		expect(result.seed_statuses[0]?.failure_reason).toBe("Seed timed out.");
		expect(result.ollama_calls).toBe(0);
	});

	it("scores company-level source unit evidence above page-level evidence", () => {
		const lead = parseLocalCampaignResponse(
			leadJson,
			"https://example.com/one",
		);
		const pageScore = scoreLocalCampaignLead(lead, campaign);
		const unitScore = scoreLocalCampaignLead(lead, campaign, {
			sourceUnit: true,
			extractionMethod: "table_row",
		});
		expect(unitScore.evidence_score).toBeGreaterThan(pageScore.evidence_score);
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

	it("keeps local campaign modules free of CRM writer imports", async () => {
		const files = [
			"agent/lib/local-campaign-cache.ts",
			"agent/lib/local-campaign-export.ts",
			"agent/lib/local-campaign-extraction.ts",
			"agent/lib/local-campaign-lead-schema.ts",
			"agent/lib/local-campaign-runner.ts",
			"agent/lib/local-campaign-schema.ts",
			"agent/lib/local-campaign-scoring.ts",
			"agent/lib/local-campaign-source-units.ts",
			"agent/lib/local-campaign-staging.ts",
			"agent/cli/local-campaign-worker.ts",
		];
		const forbidden =
			/from\s+["'](?:@crm\/db|.*prisma.*|.*neon.*|.*database.*|.*outreach.*|.*email.*)["']/i;
		for (const file of files) {
			const text = await readFile(
				new URL(`../${file}`, import.meta.url),
				"utf8",
			);
			expect(text).not.toMatch(forbidden);
		}
	});

	it("times out stalled Ollama requests", async () => {
		const client = createLocalOllamaClient(
			async (_input, init) =>
				new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () => {
						reject(new Error("aborted"));
					});
				}),
		);
		await expect(
			client.generate({ model: "qwen2.5:14b", prompt: "{}", timeoutMs: 1 }),
		).rejects.toThrow("timed out");
	});
});
