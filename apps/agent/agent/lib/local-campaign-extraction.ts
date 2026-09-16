import { createHash } from "node:crypto";
import {
	LOCAL_CAMPAIGN_SCALAR_FIELDS,
	type LocalCampaignLead,
	localCampaignLeadSchema,
} from "./local-campaign-lead-schema";
import { LOCAL_LEAD_MODEL } from "./local-lead-extraction";
import { createLocalOllamaClient, type OllamaClient } from "./local-ollama";

export const LOCAL_CAMPAIGN_MODEL = LOCAL_LEAD_MODEL;

export type LocalCampaignLeadRecord = LocalCampaignLead & {
	content_hash: string;
	model_name: string;
	latency_ms: number;
	attempt_count: number;
	created_at: string;
};

export function parseLocalCampaignResponse(
	raw: string,
	sourceUrl: string,
): LocalCampaignLead {
	const trimmed = raw.trim();
	if (
		trimmed.includes("```") ||
		!trimmed.startsWith("{") ||
		!trimmed.endsWith("}")
	) {
		throw new Error("Campaign model response is not plain JSON.");
	}

	let value: unknown;
	try {
		value = JSON.parse(trimmed);
	} catch {
		throw new Error("Campaign model response is invalid JSON.");
	}

	const lead = localCampaignLeadSchema.parse(value);
	const expectedMissing = LOCAL_CAMPAIGN_SCALAR_FIELDS.filter(
		(field) => lead[field] === null,
	).sort();
	const actualMissing = [...lead.missing_fields].sort();
	if (JSON.stringify(expectedMissing) !== JSON.stringify(actualMissing)) {
		throw new Error("missing_fields does not match null fields.");
	}
	if (lead.source_url !== sourceUrl) {
		throw new Error("source_url does not match the requested source.");
	}

	for (const field of LOCAL_CAMPAIGN_SCALAR_FIELDS) {
		const fieldValue = lead[field];
		if (
			fieldValue &&
			!lead.evidence_excerpt
				.toLocaleLowerCase()
				.includes(fieldValue.toLocaleLowerCase())
		) {
			throw new Error(`${field} is not present in evidence_excerpt.`);
		}
	}
	return lead;
}

export async function extractLocalCampaignLead(
	text: string,
	sourceUrl: string,
	client: OllamaClient = createLocalOllamaClient(),
): Promise<LocalCampaignLeadRecord> {
	if (!text.trim()) throw new Error("Source text is empty.");
	const prompt = [
		"Return exactly one plain JSON object. Do not use markdown fences.",
		"Use exactly these keys: company_name, website, contact_name, role, email, phone, location, source_url, evidence_excerpt, project_fit_reason, missing_fields.",
		"Use null for every unknown scalar field.",
		"Use missing_fields for exactly the scalar fields that are null.",
		"Never invent a company, contact, role, email, phone, website, or location.",
		"Every non-null extracted scalar value must appear in evidence_excerpt.",
		`The source URL is ${sourceUrl}. Return that exact value as source_url.`,
		"Page text:",
		text,
	].join("\n");
	const result = await client.generate({ model: LOCAL_CAMPAIGN_MODEL, prompt });
	const lead = parseLocalCampaignResponse(result.text, sourceUrl);
	return {
		...lead,
		content_hash: createHash("sha256").update(text, "utf8").digest("hex"),
		model_name: LOCAL_CAMPAIGN_MODEL,
		latency_ms: result.latencyMs,
		attempt_count: 1,
		created_at: new Date().toISOString(),
	};
}
