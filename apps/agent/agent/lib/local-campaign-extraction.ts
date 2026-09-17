import { createHash } from "node:crypto";
import { ZodError } from "zod";
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
	sourceText?: string,
): LocalCampaignLead {
	const trimmed = raw.trim();
	if (
		trimmed.includes("```") ||
		!trimmed.startsWith("{") ||
		!trimmed.endsWith("}")
	) {
		throw new Error("Campaign model response is not plain JSON.");
	}

	const value = parsePlainJsonObject(trimmed, "Campaign model response");
	return parseLocalCampaignValue(value, sourceUrl, sourceText);
}

function parsePlainJsonObject(raw: string, label: string): unknown {
	try {
		return JSON.parse(raw);
	} catch {
		throw new Error(`${label} is invalid JSON.`);
	}
}

function parseLocalCampaignValue(
	value: unknown,
	sourceUrl: string,
	sourceText?: string,
): LocalCampaignLead {
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
	if (
		sourceText &&
		!sourceText
			.toLocaleLowerCase()
			.includes(lead.evidence_excerpt.toLocaleLowerCase())
	) {
		throw new Error("evidence_excerpt is not present in source text.");
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

function needsSchemaRepair(error: unknown): boolean {
	return (
		error instanceof ZodError ||
		(error instanceof Error &&
			[
				"missing_fields does not match null fields.",
				"evidence_excerpt is not present in source text.",
			].includes(error.message))
	);
}

function repairPrompt(
	sourceUrl: string,
	sourceText: string,
	firstResponse: string,
	reason: string,
): string {
	return [
		"Your previous response was rejected by validation.",
		"Return exactly one raw JSON object. Do not use markdown. Do not return an array.",
		"Use exactly these keys: company_name, website, contact_name, role, email, phone, location, source_url, evidence_excerpt, project_fit_reason, missing_fields.",
		"All unknown scalar fields must be null.",
		"project_fit_reason must always be a non-empty string.",
		"evidence_excerpt must always be a non-empty exact excerpt copied from the source text below.",
		"If there is not enough evidence for company_name, website, contact_name, role, email, phone, or location, use null for that field.",
		"Never invent a company, website, contact name, role, email, phone, or location.",
		"missing_fields must exactly list scalar fields whose values are null.",
		`source_url must be exactly ${sourceUrl}.`,
		`Validation failure: ${reason}`,
		"Rejected response:",
		firstResponse,
		"Source text:",
		sourceText,
	].join("\n");
}

export async function extractLocalCampaignLead(
	text: string,
	sourceUrl: string,
	client: OllamaClient = createLocalOllamaClient(),
	options: { timeoutMs?: number } = {},
): Promise<LocalCampaignLeadRecord> {
	if (!text.trim()) throw new Error("Source text is empty.");
	const prompt = [
		"Return exactly one raw JSON object. Do not use markdown fences. Do not return an array.",
		"Use exactly these keys: company_name, website, contact_name, role, email, phone, location, source_url, evidence_excerpt, project_fit_reason, missing_fields.",
		"Use null for every unknown scalar field: company_name, website, contact_name, role, email, phone, location.",
		"project_fit_reason must always be a non-empty string.",
		"evidence_excerpt must always be a non-empty exact excerpt copied from the source text.",
		"Use missing_fields for exactly the scalar fields that are null. Do not include evidence_excerpt, project_fit_reason, source_url, or missing_fields in missing_fields.",
		"Never invent a company, contact, role, email, phone, website, or location.",
		"Every non-null extracted scalar value must appear in evidence_excerpt.",
		"If there is not enough evidence for a lead, return null for unknown scalar fields, use an exact source excerpt as evidence_excerpt, and explain the missing evidence in project_fit_reason.",
		`The source URL is ${sourceUrl}. Return that exact value as source_url.`,
		"Source text:",
		text,
	].join("\n");
	const result = await client.generate({
		model: LOCAL_CAMPAIGN_MODEL,
		prompt,
		timeoutMs: options.timeoutMs,
	});
	let lead: LocalCampaignLead;
	let latencyMs = result.latencyMs;
	let attemptCount = 1;
	try {
		lead = parseLocalCampaignResponse(result.text, sourceUrl, text);
	} catch (error) {
		if (!needsSchemaRepair(error)) throw error;
		const retry = await client.generate({
			model: LOCAL_CAMPAIGN_MODEL,
			prompt: repairPrompt(sourceUrl, text, result.text, errorReason(error)),
			timeoutMs: options.timeoutMs,
		});
		latencyMs += retry.latencyMs;
		attemptCount = 2;
		lead = parseLocalCampaignResponse(retry.text, sourceUrl, text);
	}
	return {
		...lead,
		content_hash: createHash("sha256").update(text, "utf8").digest("hex"),
		model_name: LOCAL_CAMPAIGN_MODEL,
		latency_ms: latencyMs,
		attempt_count: attemptCount,
		created_at: new Date().toISOString(),
	};
}

function errorReason(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
