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
	rank_score: number;
	ranking_reasons: string[];
};

export type LocalCampaignSourceUnitRejectionReason =
	| "weak_website_only"
	| "event_vendor_link"
	| "navigation_or_footer"
	| "registration_or_ticketing"
	| "venue_or_organizer"
	| "boilerplate"
	| "insufficient_company_evidence";

export type LocalCampaignRejectedSourceUnit = {
	parent_source_url: string;
	source_domain: string;
	candidate_text: string;
	candidate_website: string | null;
	extraction_method: LocalCampaignSourceUnit["extraction_method"];
	rejection_reason: LocalCampaignSourceUnitRejectionReason;
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
const EXHIBITOR_PROFILE = /\b(exhibitor|profile|company|listing|directory)\b/i;
const BOOTH_PATTERN =
	/\b(?:booth|stand|stall|pavilion)\s*(?:no\.?|number|#)?\s*[A-Z]?\d[\w.-]*\b/i;
const LOCATION_PATTERN =
	/\b(?:[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*,\s*)?(?:[A-Z]{2}|USA|United States|Canada|Mexico|Germany|Taiwan|China|Thailand|Vietnam|India|Japan|Korea|United Kingdom|UK|France|Italy|Spain)\b/;
const PRODUCT_SERVICE =
	/\b(display|fixture|fabrication|manufacturing|supplier|distributor|automation|machinery|equipment|hardware|server|logistics|laboratory|lab|monitoring|energy|electrical|prototype|parts|services?|products?)\b/i;
const PROMOTIONAL =
	/\b(register|registration|schedule|agenda|attendee|buy tickets|book now|learn more|sponsorship opportunity|floor plan|hotel|travel)\b/i;
const REGISTRATION_TICKETING =
	/\b(register|registration|tickets?|buy tickets|book now|attendee registration|visitor registration|badge|passes)\b/i;
const NAVIGATION_FOOTER =
	/\b(home|about us|contact us|contact-us|privacy|terms|cookie|newsletter|subscribe|login|sign in|menu|navigation|copyright|all rights reserved|media kit|advertise)\b/i;
const SOCIAL_OR_UTILITY_DOMAIN =
	/\b(?:facebook|instagram|linkedin|twitter|x|youtube|tiktok|pinterest|google|apple|wa\.me|whatsapp)\.com\b/i;
const EVENT_VENDOR =
	/\b(website by|powered by|designed by|marketing \+ guidance|amplify industrial marketing|aimg|map your show|expocad|cvent|eventbrite|swoogo|swapcard|bizzabo|event platform|marketing platform)\b/i;
const VENUE_OR_ORGANIZER =
	/\b(venue|organizer|organiser|convention center|conference center|exhibition center|expo center|floor plan|show management|event management)\b/i;
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
	return extractLocalCampaignSourceUnitCandidates(text, parentSourceUrl, caps)
		.units;
}

export function extractLocalCampaignSourceUnitCandidates(
	text: string,
	parentSourceUrl: string,
	caps: LocalCampaignSourceUnitCaps = DEFAULT_LOCAL_CAMPAIGN_SOURCE_UNIT_CAPS,
): {
	units: LocalCampaignSourceUnit[];
	rejected: LocalCampaignRejectedSourceUnit[];
} {
	const sourceDomain = normalizeDomain(new URL(parentSourceUrl).hostname);
	const units: LocalCampaignSourceUnit[] = [];
	const rejected: LocalCampaignRejectedSourceUnit[] = [];
	for (const entry of BLOCK_PATTERNS) {
		for (const match of text.matchAll(entry.pattern)) {
			const result = buildSourceUnit(
				match[1] ?? "",
				parentSourceUrl,
				sourceDomain,
				entry.method,
				caps.max_source_unit_chars,
			);
			if (result.unit) units.push(result.unit);
			else if (result.rejected) rejected.push(result.rejected);
		}
	}
	for (const match of text.matchAll(
		/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
	)) {
		const href = normalizeWebsite(match[1] ?? "", parentSourceUrl);
		const label = cleanText(match[2] ?? "");
		const block = [label, href].filter(Boolean).join(" ");
		const result = buildSourceUnit(
			block,
			parentSourceUrl,
			sourceDomain,
			"link_context",
			caps.max_source_unit_chars,
			href,
		);
		if (result.unit) units.push(result.unit);
		else if (result.rejected) rejected.push(result.rejected);
	}
	return {
		units: dedupeSourceUnits(units)
			.sort((left, right) => right.rank_score - left.rank_score)
			.slice(0, caps.max_source_units_per_page),
		rejected,
	};
}

export function hasUsefulPageEvidence(text: string): boolean {
	const cleaned = cleanText(text);
	return looksCompanyLevel(cleaned) && !isOnlyEventLevel(cleaned);
}

export type LocalCampaignSourceUnitRanking = {
	rank_score: number;
	ranking_reasons: string[];
};

export function rankLocalCampaignSourceUnitText(
	text: string,
	context: {
		parent_source_url?: string;
		source_domain?: string;
		candidate_company_name?: string | null;
		candidate_website?: string | null;
		candidate_location?: string | null;
		extraction_method?: LocalCampaignSourceUnit["extraction_method"];
	} = {},
): LocalCampaignSourceUnitRanking {
	const cleaned = cleanText(text);
	const parentDomain = context.source_domain ?? null;
	const website =
		context.candidate_website ??
		cleaned.match(WEBSITE_PATTERN)?.[0]?.replace(/[),.]+$/, "") ??
		null;
	const company =
		context.candidate_company_name ?? candidateCompanyName(cleaned);
	const location = context.candidate_location ?? candidateLocation(cleaned);
	const reasons: string[] = [];
	let score = 0;

	if (company) {
		score += 30;
		reasons.push("likely company name");
	}
	if (website) {
		const websiteDomain = safeDomain(website);
		if (websiteDomain && parentDomain && websiteDomain !== parentDomain) {
			score += 30;
			reasons.push("external company website");
		} else if (EXHIBITOR_PROFILE.test(website)) {
			score += 18;
			reasons.push("exhibitor profile URL");
		} else {
			score += 12;
			reasons.push("website or profile URL");
		}
	}
	if (
		context.extraction_method === "link_context" &&
		website &&
		EXHIBITOR_PROFILE.test(website)
	) {
		score += 12;
		reasons.push("exhibitor profile link");
	}
	if (BOOTH_PATTERN.test(cleaned)) {
		score += 20;
		reasons.push("booth or stand number");
	}
	if (location || LOCATION_PATTERN.test(cleaned)) {
		score += 10;
		reasons.push("location evidence");
	}
	if (PRODUCT_SERVICE.test(cleaned)) {
		score += 15;
		reasons.push("product or service description");
	}
	if (/\b(exhibitor|sponsor|booth|stand|pavilion)\b/i.test(cleaned)) {
		score += 10;
		reasons.push("exhibitor context");
	}
	if (
		cleaned.length <= 80 &&
		EVENT_LEVEL.test(cleaned) &&
		!company &&
		!website
	) {
		score -= 30;
		reasons.push("page title or event-only text");
	}
	if (isOnlyEventLevel(cleaned)) {
		score -= 40;
		reasons.push("event or venue level evidence");
	}
	if (BOILERPLATE.test(cleaned)) {
		score -= 35;
		reasons.push("navigation/footer/cookie boilerplate");
	}
	if (PROMOTIONAL.test(cleaned) && !company) {
		score -= 25;
		reasons.push("registration or promotional copy");
	}

	return {
		rank_score: score,
		ranking_reasons:
			reasons.length > 0
				? [...new Set(reasons)]
				: ["weak source unit evidence"],
	};
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
): {
	unit: LocalCampaignSourceUnit | null;
	rejected: LocalCampaignRejectedSourceUnit | null;
} {
	const cleaned = cleanText(raw);
	const candidateText = cleaned.slice(0, maxChars);
	const company = candidateCompanyName(candidateText);
	const website =
		websiteHint ??
		candidateText.match(WEBSITE_PATTERN)?.[0]?.replace(/[),.]+$/, "") ??
		null;
	const location = candidateLocation(candidateText);
	const rejectionReason = sourceUnitRejectionReason(candidateText, {
		candidate_company_name: company,
		candidate_website: website,
		candidate_location: location,
		extraction_method: extractionMethod,
	});
	if (rejectionReason) {
		return {
			unit: null,
			rejected: {
				parent_source_url: parentSourceUrl,
				source_domain: sourceDomain,
				candidate_text: candidateText,
				candidate_website: website,
				extraction_method: extractionMethod,
				rejection_reason: rejectionReason,
			},
		};
	}
	const contentHash = createHash("sha256")
		.update(`${parentSourceUrl}:${candidateText}`, "utf8")
		.digest("hex");
	const ranking = rankLocalCampaignSourceUnitText(candidateText, {
		parent_source_url: parentSourceUrl,
		source_domain: sourceDomain,
		candidate_company_name: company,
		candidate_website: website,
		candidate_location: location,
		extraction_method: extractionMethod,
	});
	return {
		unit: {
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
			...ranking,
		},
		rejected: null,
	};
}

export function sourceUnitRejectionReason(
	text: string,
	context: {
		candidate_company_name?: string | null;
		candidate_website?: string | null;
		candidate_location?: string | null;
		extraction_method?: LocalCampaignSourceUnit["extraction_method"];
	} = {},
): LocalCampaignSourceUnitRejectionReason | null {
	const cleaned = cleanText(text);
	const website = context.candidate_website ?? null;
	const company =
		context.candidate_company_name ?? candidateCompanyName(cleaned);
	const location = context.candidate_location ?? candidateLocation(cleaned);
	const hasWebsite = website !== null || WEBSITE_PATTERN.test(cleaned);
	const hasBooth = BOOTH_PATTERN.test(cleaned);
	const hasProduct = PRODUCT_SERVICE.test(cleaned);
	const hasExhibitorContext =
		/\b(exhibitor|booth|stand|pavilion)\b/i.test(cleaned) ||
		(context.extraction_method === "link_context" &&
			website !== null &&
			EXHIBITOR_PROFILE.test(website));

	if (cleaned.length < 20) return "insufficient_company_evidence";
	if (EVENT_VENDOR.test(cleaned) || (website && EVENT_VENDOR.test(website))) {
		return "event_vendor_link";
	}
	if (website && SOCIAL_OR_UTILITY_DOMAIN.test(website)) {
		return "navigation_or_footer";
	}
	if (REGISTRATION_TICKETING.test(cleaned)) return "registration_or_ticketing";
	if (VENUE_OR_ORGANIZER.test(cleaned) && !company) return "venue_or_organizer";
	if (BOILERPLATE.test(cleaned) || NAVIGATION_FOOTER.test(cleaned)) {
		return "boilerplate";
	}
	if (isOnlyEventLevel(cleaned)) return "venue_or_organizer";
	if (!looksCompanyLevel(cleaned)) return "insufficient_company_evidence";
	if (!company)
		return hasWebsite ? "weak_website_only" : "insufficient_company_evidence";
	if (
		!(hasWebsite || location || hasBooth || hasProduct || hasExhibitorContext)
	) {
		return "insufficient_company_evidence";
	}
	return null;
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

function safeDomain(value: string): string | null {
	try {
		return normalizeDomain(new URL(value).hostname);
	} catch {
		try {
			return normalizeDomain(new URL(`https://${value}`).hostname);
		} catch {
			return null;
		}
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
