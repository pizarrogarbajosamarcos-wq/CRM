import { createHash } from "node:crypto";
import { normalizeDomain } from "./local-campaign-staging";

export type LocalCampaignSourceUnit = {
	unit_id: string;
	parent_source_url: string;
	source_domain: string;
	candidate_company_name: string | null;
	candidate_website: string | null;
	candidate_location: string | null;
	candidate_text: string;
	evidence_excerpt: string;
	extraction_method: "table_row" | "list_item" | "card" | "link_context";
	content_hash: string;
};

export type LocalCampaignSourceUnitCaps = {
	max_source_units_per_page: number;
	max_source_unit_chars: number;
};

const COMPANY_SUFFIX =
	/\b(inc|llc|ltd|limited|corp|corporation|co|company|group|systems|solutions|technologies|technology|manufacturing|industrial|industries|machinery|automation|electric|electronics|displays|fixtures|metal|plastics|tooling|logistics|labs)\b/i;
const WEBSITE_PATTERN = /\bhttps?:\/\/[^\s"'<>]+|\bwww\.[^\s"'<>]+/i;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE_PATTERN = /(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/;
const BOILERPLATE =
	/\b(cookie|privacy|terms|register now|buy tickets|subscribe|newsletter|sponsor|navigation|menu|login|sign in|venue|floor plan|organizer|copyright|all rights reserved)\b/i;
const EVENT_LEVEL =
	/\b(exhibitor directory|exhibitor list|trade show|conference|expo|event|venue|registration|attendee|speaker)\b/i;
const BLOCK_PATTERNS = [
	{ pattern: /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi, method: "table_row" as const },
	{ pattern: /<li\b[^>]*>([\s\S]*?)<\/li>/gi, method: "list_item" as const },
	{
		pattern:
			/<(?:article|section|div)\b[^>]*(?:class|id)=["'][^"']*(?:card|exhibitor|company|profile|listing|result)[^"']*["'][^>]*>([\s\S]*?)<\/(?:article|section|div)>/gi,
		method: "card" as const,
	},
];

export const DEFAULT_LOCAL_CAMPAIGN_SOURCE_UNIT_CAPS: LocalCampaignSourceUnitCaps =
	{
		max_source_units_per_page: 20,
		max_source_unit_chars: 1800,
	};

export function extractLocalCampaignSourceUnits(
	text: string,
	parentSourceUrl: string,
	caps: LocalCampaignSourceUnitCaps = DEFAULT_LOCAL_CAMPAIGN_SOURCE_UNIT_CAPS,
): LocalCampaignSourceUnit[] {
	const sourceDomain = normalizeDomain(new URL(parentSourceUrl).hostname);
	const units: LocalCampaignSourceUnit[] = [];
	for (const entry of BLOCK_PATTERNS) {
		for (const match of text.matchAll(entry.pattern)) {
			const unit = buildSourceUnit(
				match[1] ?? "",
				parentSourceUrl,
				sourceDomain,
				entry.method,
				caps.max_source_unit_chars,
			);
			if (unit) units.push(unit);
		}
	}
	for (const match of text.matchAll(
		/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
	)) {
		const href = normalizeWebsite(match[1] ?? "", parentSourceUrl);
		const label = cleanText(match[2] ?? "");
		const block = [label, href].filter(Boolean).join(" ");
		const unit = buildSourceUnit(
			block,
			parentSourceUrl,
			sourceDomain,
			"link_context",
			caps.max_source_unit_chars,
			href,
		);
		if (unit) units.push(unit);
	}
	return dedupeSourceUnits(units).slice(0, caps.max_source_units_per_page);
}

export function hasUsefulPageEvidence(text: string): boolean {
	const cleaned = cleanText(text);
	return looksCompanyLevel(cleaned) && !isOnlyEventLevel(cleaned);
}

export function dedupeSourceUnits(
	units: LocalCampaignSourceUnit[],
): LocalCampaignSourceUnit[] {
	const seen = new Set<string>();
	const result: LocalCampaignSourceUnit[] = [];
	for (const unit of units) {
		const key = [
			unit.candidate_website ? `site:${unit.candidate_website}` : null,
			unit.candidate_company_name
				? `company:${unit.candidate_company_name.toLocaleLowerCase()}`
				: null,
			`hash:${unit.content_hash}`,
		]
			.filter(Boolean)
			.join("|");
		if (seen.has(key)) continue;
		seen.add(key);
		result.push(unit);
	}
	return result;
}

function buildSourceUnit(
	raw: string,
	parentSourceUrl: string,
	sourceDomain: string,
	extractionMethod: LocalCampaignSourceUnit["extraction_method"],
	maxChars: number,
	websiteHint: string | null = null,
): LocalCampaignSourceUnit | null {
	const cleaned = cleanText(raw);
	if (!looksCompanyLevel(cleaned) || isOnlyEventLevel(cleaned)) return null;
	const candidateText = cleaned.slice(0, maxChars);
	const contentHash = createHash("sha256")
		.update(`${parentSourceUrl}:${candidateText}`, "utf8")
		.digest("hex");
	const company = candidateCompanyName(candidateText);
	const website =
		websiteHint ??
		candidateText.match(WEBSITE_PATTERN)?.[0]?.replace(/[),.]+$/, "") ??
		null;
	const location = candidateLocation(candidateText);
	return {
		unit_id: contentHash.slice(0, 24),
		parent_source_url: parentSourceUrl,
		source_domain: sourceDomain,
		candidate_company_name: company,
		candidate_website: website,
		candidate_location: location,
		candidate_text: candidateText,
		evidence_excerpt: candidateText.slice(0, 500),
		extraction_method: extractionMethod,
		content_hash: contentHash,
	};
}

function looksCompanyLevel(text: string): boolean {
	if (text.length < 20 || BOILERPLATE.test(text)) return false;
	return (
		COMPANY_SUFFIX.test(text) ||
		WEBSITE_PATTERN.test(text) ||
		EMAIL_PATTERN.test(text) ||
		PHONE_PATTERN.test(text)
	);
}

function isOnlyEventLevel(text: string): boolean {
	return (
		EVENT_LEVEL.test(text) &&
		!COMPANY_SUFFIX.test(text) &&
		!WEBSITE_PATTERN.test(text)
	);
}

function candidateCompanyName(text: string): string | null {
	const segments = text
		.split(/\s{2,}|[|•]/)
		.map((value) => value.trim())
		.filter(Boolean);
	return (
		segments.find(
			(segment) => COMPANY_SUFFIX.test(segment) && segment.length <= 120,
		) ?? null
	);
}

function candidateLocation(text: string): string | null {
	const match = text.match(
		/\b(?:[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*,\s*)?[A-Z]{2}\b/,
	);
	return match?.[0] ?? null;
}

function normalizeWebsite(
	value: string,
	parentSourceUrl: string,
): string | null {
	if (!value || value.startsWith("#") || value.startsWith("mailto:"))
		return null;
	try {
		return new URL(value, parentSourceUrl).toString();
	} catch {
		return null;
	}
}

function cleanText(value: string): string {
	return value
		.replace(/<script\b[\s\S]*?<\/script>/gi, " ")
		.replace(/<style\b[\s\S]*?<\/style>/gi, " ")
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&#39;/g, "'")
		.replace(/&quot;/g, '"')
		.replace(/\s+/g, " ")
		.trim();
}
