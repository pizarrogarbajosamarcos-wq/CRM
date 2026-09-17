import type { LocalCampaignLead } from "./local-campaign-lead-schema";
import type { LocalCampaign } from "./local-campaign-schema";

export type LocalCampaignScores = {
	fit_score: number;
	evidence_score: number;
	contact_completeness_score: number;
	outreach_readiness_score: number;
	review_required_reason: string;
};

export function scoreLocalCampaignLead(
	lead: LocalCampaignLead,
	campaign: LocalCampaign,
	options: { sourceUnit?: boolean; extractionMethod?: string | null } = {},
): LocalCampaignScores {
	const haystack = [
		lead.company_name,
		lead.website,
		lead.location,
		lead.project_fit_reason,
		lead.evidence_excerpt,
	]
		.filter(Boolean)
		.join(" ")
		.toLocaleLowerCase();
	const matched = campaign.keywords.filter((keyword) =>
		haystack.includes(keyword.toLocaleLowerCase()),
	);
	const excluded = campaign.exclusions.filter((term) =>
		haystack.includes(term.toLocaleLowerCase()),
	);
	const fitScore = Math.max(
		0,
		Math.min(
			100,
			matched.length * campaign.scoring_rules.fit_keyword_points -
				excluded.length * campaign.scoring_rules.fit_keyword_points,
		),
	);
	const sourceUnitBonus = options.sourceUnit ? 20 : 0;
	const methodBonus =
		options.extractionMethod === "table_row" ||
		options.extractionMethod === "card"
			? 10
			: 0;
	const titleOnlyPenalty =
		lead.company_name === null && lead.website === null ? 30 : 0;
	const evidenceScore = Math.max(
		0,
		Math.min(
			100,
			campaign.scoring_rules.evidence_points +
				(lead.evidence_excerpt.length >= 40 ? 20 : 0) +
				sourceUnitBonus +
				methodBonus -
				titleOnlyPenalty,
		),
	);
	const contactFields = [
		lead.contact_name,
		lead.role,
		lead.email,
		lead.phone,
	].filter((value) => value !== null).length;
	const contactCompletenessScore = Math.min(
		100,
		contactFields * campaign.scoring_rules.contact_field_points,
	);
	const outreachReadinessScore = Math.round(
		(contactCompletenessScore + evidenceScore) / 2,
	);
	const reasons = [
		matched.length === 0 ? "No campaign keyword appears in evidence." : null,
		excluded.length > 0
			? `Excluded term appears: ${excluded.join(", ")}.`
			: null,
		lead.email === null ? "Email is missing." : null,
		lead.phone === null ? "Phone is missing." : null,
		lead.contact_name === null ? "Contact name is missing." : null,
		options.sourceUnit ? null : "Evidence is page-level.",
	].filter((reason): reason is string => reason !== null);
	return {
		fit_score: fitScore,
		evidence_score: evidenceScore,
		contact_completeness_score: contactCompletenessScore,
		outreach_readiness_score: outreachReadinessScore,
		review_required_reason:
			reasons.join(" ") || "Evidence supports campaign fit.",
	};
}
