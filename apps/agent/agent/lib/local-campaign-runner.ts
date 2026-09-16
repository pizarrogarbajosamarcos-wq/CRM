import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { type CachedPage, fetchCachedPage } from "./local-campaign-cache";
import type { LocalCampaignLeadRecord } from "./local-campaign-extraction";
import { extractLocalCampaignLead } from "./local-campaign-extraction";
import {
	type LocalCampaign,
	localCampaignSchema,
	localCampaignSeedSchema,
} from "./local-campaign-schema";
import { scoreLocalCampaignLead } from "./local-campaign-scoring";
import {
	type LocalStagedLead,
	normalizeDomain,
	stageCampaignLead,
} from "./local-campaign-staging";
import type { OllamaClient } from "./local-ollama";

export function assertLocalCampaignOnly(args: string[]): void {
	const forbidden = args.filter((arg) =>
		["--sync", "--sync-crm", "--production", "--neon"].includes(
			arg.split("=", 1)[0] ?? "",
		),
	);
	if (forbidden.length > 0) {
		throw new Error(
			`CRM synchronization is not implemented. Refused: ${forbidden.join(", ")}`,
		);
	}
}

export type LocalCampaignRunDependencies = {
	fetchImpl?: typeof fetch;
	client?: OllamaClient;
	pageLoader?: (
		url: string,
		fetchImpl?: typeof fetch,
	) => Promise<{
		page: CachedPage;
		cached: boolean;
	}>;
	stager?: typeof stageCampaignLead;
	stagingPath?: string;
};

export type LocalCampaignRunResult = {
	stagingPath: string;
	processed: number;
	fetched: number;
	cached: number;
	rejected_by_url_safety: number;
	failed_fetch: number;
	extracted: number;
	extraction_failures: number;
	staged: number;
	duplicates: number;
	leads: LocalStagedLead[];
	failures: Array<{
		url: string;
		stage: "url_safety" | "fetch" | "extraction" | "staging";
		reason: string;
	}>;
};

function errorReason(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function isUrlSafetyError(error: unknown): boolean {
	const reason = errorReason(error);
	return [
		"Local source URLs are blocked",
		"local address",
		"DNS lookup failed",
		"Source URL must use HTTP or HTTPS",
	].some((marker) => reason.includes(marker));
}

export async function loadCampaignFile(path: string): Promise<LocalCampaign> {
	return localCampaignSchema.parse(JSON.parse(await readFile(path, "utf8")));
}

export async function loadCampaignSeeds(path: string): Promise<string[]> {
	const raw = await readFile(path, "utf8");
	const urls: string[] = [];
	if (path.toLocaleLowerCase().endsWith(".csv")) {
		const lines = raw.split(/\r?\n/).filter((line) => line.trim());
		if (lines.some((line) => line.includes('"'))) {
			throw new Error(
				"Quoted CSV fields are not supported. Use JSONL for complex seed data.",
			);
		}
		const header =
			lines
				.shift()
				?.split(",")
				.map((value) => value.trim()) ?? [];
		const urlIndex = header.findIndex((value) =>
			["url", "source_url"].includes(value),
		);
		if (urlIndex < 0)
			throw new Error("Seed CSV needs a url or source_url column.");
		for (const line of lines) {
			const value = line.split(",")[urlIndex]?.trim();
			if (value) urls.push(localCampaignSeedSchema.parse({ url: value }).url);
		}
		return urls;
	}
	for (const line of raw.split(/\r?\n/).filter((value) => value.trim())) {
		const parsed: unknown = JSON.parse(line);
		urls.push(localCampaignSeedSchema.parse(parsed).url);
	}
	return urls;
}

export async function runLocalCampaign(
	campaign: LocalCampaign,
	seedUrls: string[] = campaign.seed_urls,
	dependencies: LocalCampaignRunDependencies = {},
): Promise<LocalCampaignRunResult> {
	const uniqueSeeds = [...new Set(seedUrls)];
	const domains = new Map<string, number>();
	const leads: LocalStagedLead[] = [];
	const failures: LocalCampaignRunResult["failures"] = [];
	let fetched = 0;
	let cached = 0;
	let rejectedByUrlSafety = 0;
	let failedFetch = 0;
	let extracted = 0;
	let extractionFailures = 0;
	let staged = 0;
	let duplicates = 0;
	let processed = 0;
	for (const url of uniqueSeeds) {
		if (
			leads.filter((lead) => lead.status !== "duplicate").length >=
			campaign.max_companies
		)
			break;
		const domain = normalizeDomain(new URL(url).hostname);
		const pageCount = domains.get(domain) ?? 0;
		if (pageCount >= campaign.max_pages_per_domain) continue;
		domains.set(domain, pageCount + 1);
		processed += 1;
		let loaded: Awaited<
			ReturnType<NonNullable<LocalCampaignRunDependencies["pageLoader"]>>
		>;
		try {
			loaded = await (dependencies.pageLoader ?? fetchCachedPage)(
				url,
				dependencies.fetchImpl,
			);
		} catch (error) {
			const stage = isUrlSafetyError(error) ? "url_safety" : "fetch";
			if (stage === "url_safety") rejectedByUrlSafety += 1;
			else failedFetch += 1;
			failures.push({ url, stage, reason: errorReason(error) });
			continue;
		}
		if (loaded.cached) cached += 1;
		else fetched += 1;
		let lead: LocalCampaignLeadRecord;
		try {
			lead = await extractLocalCampaignLead(
				loaded.page.text,
				url,
				dependencies.client,
			);
			extracted += 1;
		} catch (error) {
			extractionFailures += 1;
			failures.push({ url, stage: "extraction", reason: errorReason(error) });
			continue;
		}
		const scores = scoreLocalCampaignLead(lead, campaign);
		const missingRequired = campaign.required_fields.filter(
			(field) => lead[field as keyof typeof lead] === null,
		);
		const record: LocalStagedLead = {
			...lead,
			...scores,
			campaign_id: campaign.campaign_id,
			lead_id: createHash("sha256")
				.update(`${campaign.campaign_id}:${lead.content_hash}`, "utf8")
				.digest("hex"),
			source_domain: domain,
			status: missingRequired.length > 0 ? "needs_review" : "new",
		};
		let result: Awaited<ReturnType<typeof stageCampaignLead>>;
		try {
			result = await (dependencies.stager ?? stageCampaignLead)(
				record,
				dependencies.stagingPath,
			);
		} catch (error) {
			failures.push({ url, stage: "staging", reason: errorReason(error) });
			continue;
		}
		leads.push(result.staged);
		if (result.duplicate) duplicates += 1;
		else staged += 1;
	}
	return {
		stagingPath:
			dependencies.stagingPath ?? "var/local-leads/campaign-leads.jsonl",
		processed,
		fetched,
		cached,
		rejected_by_url_safety: rejectedByUrlSafety,
		failed_fetch: failedFetch,
		extracted,
		extraction_failures: extractionFailures,
		staged,
		duplicates,
		leads,
		failures,
	};
}
