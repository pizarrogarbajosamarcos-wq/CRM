import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
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
	DEFAULT_LOCAL_CAMPAIGN_SOURCE_UNIT_CAPS,
	extractLocalCampaignSourceUnitCandidates,
	hasUsefulPageEvidence,
	type LocalCampaignSourceUnit,
	type LocalCampaignSourceUnitRejectionReason,
} from "./local-campaign-source-units";
import {
	assertLocalCampaignPath,
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
	seedStatusPath?: string;
	perSeedTimeoutMs?: number;
	onProgress?: (event: LocalCampaignProgressEvent) => void;
};

export type LocalCampaignProgressEvent = {
	event:
		| "seed_started"
		| "fetch_started"
		| "fetch_completed"
		| "fetch_failed"
		| "cache_hit"
		| "cache_miss"
		| "source_units_found"
		| "source_units_skipped"
		| "ollama_call_started"
		| "ollama_call_completed"
		| "ollama_call_failed"
		| "ollama_call_timed_out"
		| "staged_lead_written"
		| "seed_completed"
		| "seed_failed";
	url: string;
	elapsed_ms: number;
	reason?: string;
	source_unit_count?: number;
	rejected_source_unit_count?: number;
	rejection_reasons?: Record<LocalCampaignSourceUnitRejectionReason, number>;
	ollama_call_count?: number;
};

export type LocalCampaignSeedStatus = {
	url: string;
	status: "completed" | "failed" | "skipped";
	failure_reason: string | null;
	elapsed_ms: number;
	source_unit_count: number;
	rejected_source_unit_count: number;
	rejection_reasons: Record<LocalCampaignSourceUnitRejectionReason, number>;
	ollama_call_count: number;
	staged_count: number;
	created_at: string;
};

export type LocalCampaignRunResult = {
	stagingPath: string;
	processed: number;
	fetched: number;
	cached: number;
	source_units: number;
	rejected_source_units: number;
	source_unit_rejection_reasons: Record<
		LocalCampaignSourceUnitRejectionReason,
		number
	>;
	ollama_calls: number;
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
	seed_statuses: LocalCampaignSeedStatus[];
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

function elapsedSince(startedAt: number): number {
	return Math.round(performance.now() - startedAt);
}

function isTimeoutReason(reason: string): boolean {
	return reason.toLocaleLowerCase().includes("timed out");
}

async function writeSeedStatus(
	status: LocalCampaignSeedStatus,
	path?: string,
): Promise<void> {
	if (!path) return;
	const safePath = assertLocalCampaignPath(path);
	await mkdir(dirname(safePath), { recursive: true });
	await appendFile(safePath, `${JSON.stringify(status)}\n`, "utf8");
}

async function flushSeedStatus(
	seedStatuses: LocalCampaignSeedStatus[],
	status: LocalCampaignSeedStatus,
	path?: string,
): Promise<void> {
	seedStatuses.push(status);
	await writeSeedStatus(status, path);
}

function extractionCandidates(
	units: LocalCampaignSourceUnit[],
	rejectedSourceUnitCount: number,
	text: string,
	url: string,
	maxOllamaCallsPerSeed: number,
	maxSourceUnitChars: number,
): Array<{
	text: string;
	sourceUrl: string;
	sourceUnit: LocalCampaignSourceUnit | null;
}> {
	if (units.length > 0) {
		return units.slice(0, maxOllamaCallsPerSeed).map((unit) => ({
			text: unit.candidate_text,
			sourceUrl: unit.parent_source_url,
			sourceUnit: unit,
		}));
	}
	if (rejectedSourceUnitCount > 0) return [];
	if (!hasUsefulPageEvidence(text)) return [];
	return [
		{
			text: text.slice(0, maxSourceUnitChars),
			sourceUrl: url,
			sourceUnit: null,
		},
	];
}

function lacksCompanyLevelEvidence(
	lead: LocalCampaignLeadRecord,
	sourceUnit: LocalCampaignSourceUnit | null,
): boolean {
	return sourceUnit !== null && lead.company_name === null;
}

function cacheCounters(wasCached: boolean): {
	cached: number;
	fetched: number;
	event: "cache_hit" | "cache_miss";
} {
	if (wasCached) return { cached: 1, fetched: 0, event: "cache_hit" };
	return { cached: 0, fetched: 1, event: "cache_miss" };
}

function seedCompletionFailureReason(
	stagedCount: number,
	candidateCount: number,
): string | null {
	if (stagedCount > 0) return null;
	if (candidateCount > 0)
		return "No source unit produced an accepted staged lead.";
	return "No extraction candidates.";
}

function emptyRejectionReasons(): Record<
	LocalCampaignSourceUnitRejectionReason,
	number
> {
	return {
		weak_website_only: 0,
		event_vendor_link: 0,
		navigation_or_footer: 0,
		registration_or_ticketing: 0,
		venue_or_organizer: 0,
		boilerplate: 0,
		insufficient_company_evidence: 0,
	};
}

function addRejectionReasons(
	target: Record<LocalCampaignSourceUnitRejectionReason, number>,
	source: Record<LocalCampaignSourceUnitRejectionReason, number>,
): void {
	for (const key of Object.keys(
		source,
	) as LocalCampaignSourceUnitRejectionReason[]) {
		target[key] += source[key];
	}
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
	const seedStatuses: LocalCampaignSeedStatus[] = [];
	let fetched = 0;
	let cached = 0;
	let sourceUnits = 0;
	let rejectedSourceUnits = 0;
	const sourceUnitRejectionReasons = emptyRejectionReasons();
	let ollamaCalls = 0;
	let rejectedByUrlSafety = 0;
	let failedFetch = 0;
	let extracted = 0;
	let extractionFailures = 0;
	let staged = 0;
	let duplicates = 0;
	let processed = 0;
	const maxSourceUnitsPerPage =
		campaign.max_source_units_per_page ??
		DEFAULT_LOCAL_CAMPAIGN_SOURCE_UNIT_CAPS.max_source_units_per_page;
	const maxSourceUnitChars =
		campaign.max_source_unit_chars ??
		DEFAULT_LOCAL_CAMPAIGN_SOURCE_UNIT_CAPS.max_source_unit_chars;
	const maxOllamaCallsPerSeed = campaign.max_ollama_calls_per_seed ?? 5;
	const maxTotalOllamaCalls = campaign.max_total_ollama_calls ?? 50;
	const perOllamaCallTimeoutMs = campaign.per_ollama_call_timeout_ms ?? 45_000;
	const perSeedTimeoutMs = dependencies.perSeedTimeoutMs ?? 90_000;
	const progress = dependencies.onProgress;
	for (const url of uniqueSeeds) {
		const seedStartedAt = performance.now();
		let seedSourceUnitCount = 0;
		let seedRejectedSourceUnitCount = 0;
		let seedRejectionReasons = emptyRejectionReasons();
		let seedOllamaCalls = 0;
		let seedStagedCount = 0;
		const emit = (
			event: LocalCampaignProgressEvent["event"],
			details: Omit<
				LocalCampaignProgressEvent,
				"event" | "url" | "elapsed_ms"
			> = {},
		) => {
			progress?.({
				event,
				url,
				elapsed_ms: elapsedSince(seedStartedAt),
				source_unit_count: seedSourceUnitCount,
				rejected_source_unit_count: seedRejectedSourceUnitCount,
				rejection_reasons: seedRejectionReasons,
				ollama_call_count: seedOllamaCalls,
				...details,
			});
		};
		const status = (
			value: LocalCampaignSeedStatus["status"],
			failureReason: string | null,
		): LocalCampaignSeedStatus => ({
			url,
			status: value,
			failure_reason: failureReason,
			elapsed_ms: elapsedSince(seedStartedAt),
			source_unit_count: seedSourceUnitCount,
			rejected_source_unit_count: seedRejectedSourceUnitCount,
			rejection_reasons: seedRejectionReasons,
			ollama_call_count: seedOllamaCalls,
			staged_count: seedStagedCount,
			created_at: new Date().toISOString(),
		});
		emit("seed_started");
		if (
			leads.filter((lead) => lead.status !== "duplicate").length >=
			campaign.max_companies
		)
			break;
		const domain = normalizeDomain(new URL(url).hostname);
		const pageCount = domains.get(domain) ?? 0;
		if (pageCount >= campaign.max_pages_per_domain) {
			const reason = "Domain page cap reached.";
			emit("seed_failed", { reason });
			await flushSeedStatus(
				seedStatuses,
				status("skipped", reason),
				dependencies.seedStatusPath,
			);
			continue;
		}
		domains.set(domain, pageCount + 1);
		processed += 1;
		let loaded: Awaited<
			ReturnType<NonNullable<LocalCampaignRunDependencies["pageLoader"]>>
		>;
		try {
			emit("fetch_started");
			loaded = await (dependencies.pageLoader ?? fetchCachedPage)(
				url,
				dependencies.fetchImpl,
			);
			emit("fetch_completed");
		} catch (error) {
			const stage = isUrlSafetyError(error) ? "url_safety" : "fetch";
			const reason = errorReason(error);
			if (stage === "url_safety") rejectedByUrlSafety += 1;
			else failedFetch += 1;
			failures.push({ url, stage, reason });
			emit("fetch_failed", { reason });
			emit("seed_failed", { reason });
			await flushSeedStatus(
				seedStatuses,
				status("failed", reason),
				dependencies.seedStatusPath,
			);
			continue;
		}
		const cache = cacheCounters(loaded.cached);
		cached += cache.cached;
		fetched += cache.fetched;
		emit(cache.event);
		const sourceUnitCandidates = extractLocalCampaignSourceUnitCandidates(
			loaded.page.text,
			url,
			{
				max_source_units_per_page: maxSourceUnitsPerPage,
				max_source_unit_chars: maxSourceUnitChars,
			},
		);
		const units = sourceUnitCandidates.units;
		seedRejectedSourceUnitCount = sourceUnitCandidates.rejected.length;
		seedRejectionReasons = emptyRejectionReasons();
		for (const rejection of sourceUnitCandidates.rejected) {
			seedRejectionReasons[rejection.rejection_reason] += 1;
		}
		rejectedSourceUnits += seedRejectedSourceUnitCount;
		addRejectionReasons(sourceUnitRejectionReasons, seedRejectionReasons);
		seedSourceUnitCount = units.length;
		sourceUnits += units.length;
		emit("source_units_found", {
			source_unit_count: units.length,
			rejected_source_unit_count: seedRejectedSourceUnitCount,
			rejection_reasons: seedRejectionReasons,
		});
		const candidates = extractionCandidates(
			units,
			seedRejectedSourceUnitCount,
			loaded.page.text,
			url,
			maxOllamaCallsPerSeed,
			maxSourceUnitChars,
		);
		if (units.length === 0 && candidates.length === 0) {
			const reason = "No company-level source unit or useful page evidence.";
			emit("source_units_skipped", {
				reason,
				rejected_source_unit_count: seedRejectedSourceUnitCount,
				rejection_reasons: seedRejectionReasons,
			});
			emit("seed_completed", { reason });
			await flushSeedStatus(
				seedStatuses,
				status("completed", reason),
				dependencies.seedStatusPath,
			);
			continue;
		}
		if (units.length > candidates.length) {
			emit("source_units_skipped", {
				reason: "Source unit cap limited model calls.",
			});
		}
		let seedTimedOut = false;
		for (const candidate of candidates) {
			if (ollamaCalls >= maxTotalOllamaCalls) break;
			if (elapsedSince(seedStartedAt) >= perSeedTimeoutMs) {
				const reason = "Seed timed out.";
				emit("seed_failed", { reason });
				await flushSeedStatus(
					seedStatuses,
					status("failed", reason),
					dependencies.seedStatusPath,
				);
				seedTimedOut = true;
				break;
			}
			let lead: LocalCampaignLeadRecord;
			try {
				ollamaCalls += 1;
				seedOllamaCalls += 1;
				emit("ollama_call_started");
				lead = await extractLocalCampaignLead(
					candidate.text,
					candidate.sourceUrl,
					dependencies.client,
					{ timeoutMs: perOllamaCallTimeoutMs },
				);
				emit("ollama_call_completed");
				extracted += 1;
			} catch (error) {
				const reason = errorReason(error);
				extractionFailures += 1;
				emit(
					isTimeoutReason(reason)
						? "ollama_call_timed_out"
						: "ollama_call_failed",
					{
						reason,
					},
				);
				failures.push({
					url: candidate.sourceUrl,
					stage: "extraction",
					reason,
				});
				continue;
			}
			if (lacksCompanyLevelEvidence(lead, candidate.sourceUnit)) {
				const reason = "Source unit did not produce company-level evidence.";
				extractionFailures += 1;
				emit("ollama_call_failed", { reason });
				failures.push({
					url: candidate.sourceUrl,
					stage: "extraction",
					reason,
				});
				continue;
			}
			const scores = scoreLocalCampaignLead(lead, campaign, {
				sourceUnit: candidate.sourceUnit !== null,
				extractionMethod: candidate.sourceUnit?.extraction_method ?? null,
			});
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
				source_unit_id: candidate.sourceUnit?.unit_id,
				parent_source_url: candidate.sourceUnit?.parent_source_url,
				extraction_method: candidate.sourceUnit?.extraction_method,
				source_unit_rank_score: candidate.sourceUnit?.rank_score,
				source_unit_ranking_reasons: candidate.sourceUnit?.ranking_reasons,
				status: missingRequired.length > 0 ? "needs_review" : "new",
			};
			let result: Awaited<ReturnType<typeof stageCampaignLead>>;
			try {
				result = await (dependencies.stager ?? stageCampaignLead)(
					record,
					dependencies.stagingPath,
				);
			} catch (error) {
				const reason = errorReason(error);
				failures.push({
					url: candidate.sourceUrl,
					stage: "staging",
					reason,
				});
				continue;
			}
			seedStagedCount += 1;
			emit("staged_lead_written");
			leads.push(result.staged);
			if (result.duplicate) duplicates += 1;
			else staged += 1;
			if (
				leads.filter((lead) => lead.status !== "duplicate").length >=
				campaign.max_companies
			) {
				break;
			}
		}
		if (!seedTimedOut && !seedStatuses.some((entry) => entry.url === url)) {
			const reason = seedCompletionFailureReason(
				seedStagedCount,
				candidates.length,
			);
			emit(reason ? "seed_failed" : "seed_completed", {
				reason: reason ?? undefined,
			});
			await flushSeedStatus(
				seedStatuses,
				status(reason ? "failed" : "completed", reason),
				dependencies.seedStatusPath,
			);
		}
		if (ollamaCalls >= maxTotalOllamaCalls) break;
	}
	return {
		stagingPath:
			dependencies.stagingPath ?? "var/local-leads/campaign-leads.jsonl",
		processed,
		fetched,
		cached,
		source_units: sourceUnits,
		rejected_source_units: rejectedSourceUnits,
		source_unit_rejection_reasons: sourceUnitRejectionReasons,
		ollama_calls: ollamaCalls,
		rejected_by_url_safety: rejectedByUrlSafety,
		failed_fetch: failedFetch,
		extracted,
		extraction_failures: extractionFailures,
		staged,
		duplicates,
		leads,
		failures,
		seed_statuses: seedStatuses,
	};
}
