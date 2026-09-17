import { appendFile, mkdir, readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import type { LocalCampaignLeadRecord } from "./local-campaign-extraction";
import type { LocalCampaignScores } from "./local-campaign-scoring";

export type LocalCampaignStatus =
	| "new"
	| "duplicate"
	| "needs_review"
	| "approved"
	| "rejected";

export type LocalStagedLead = LocalCampaignLeadRecord &
	LocalCampaignScores & {
		campaign_id: string;
		lead_id: string;
		source_domain: string;
		source_unit_id?: string;
		parent_source_url?: string;
		extraction_method?: string;
		source_unit_rank_score?: number;
		source_unit_ranking_reasons?: string[];
		status: LocalCampaignStatus;
	};

const AGENT_ROOT = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const DEFAULT_PATH = "var/local-leads/campaign-leads.jsonl";

export function defaultLocalCampaignStagingPath(): string {
	return resolve(AGENT_ROOT, DEFAULT_PATH);
}

export function assertLocalCampaignPath(path: string): string {
	const root = resolve(AGENT_ROOT, "var/local-leads");
	const resolved = resolve(AGENT_ROOT, path);
	const relativePath = relative(root, resolved);
	if (
		!relativePath ||
		relativePath.startsWith("..") ||
		isAbsolute(relativePath)
	) {
		throw new Error("Campaign path must stay under var/local-leads.");
	}
	if (basename(resolved).startsWith(".env") || resolved.includes("/.git/")) {
		throw new Error("Campaign path cannot target configuration or Git files.");
	}
	return resolved;
}

export async function readStagedLeads(
	path = defaultLocalCampaignStagingPath(),
): Promise<LocalStagedLead[]> {
	const safePath = assertLocalCampaignPath(path);
	let raw = "";
	try {
		raw = await readFile(safePath, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
	return raw
		.split("\n")
		.filter((line) => line.trim())
		.map((line) => JSON.parse(line) as LocalStagedLead);
}

function dedupeKeys(lead: LocalStagedLead): string[] {
	return [
		`domain:${normalizeDomain(lead.source_domain)}`,
		lead.company_name ? `company:${normalizeText(lead.company_name)}` : null,
		lead.email ? `email:${normalizeText(lead.email)}` : null,
		lead.phone ? `phone:${normalizePhone(lead.phone)}` : null,
		`hash:${lead.content_hash}`,
	].filter((key): key is string => key !== null);
}

export function normalizeDomain(value: string): string {
	return value
		.toLocaleLowerCase()
		.replace(/^www\./, "")
		.replace(/\.$/, "");
}

function normalizeText(value: string): string {
	return value
		.toLocaleLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.trim();
}

function normalizePhone(value: string): string {
	return value.replace(/\D/g, "");
}

export function dedupeAgainst(
	lead: LocalStagedLead,
	existing: LocalStagedLead[],
): LocalStagedLead | null {
	const keys = new Set(dedupeKeys(lead));
	return (
		existing.find((candidate) =>
			dedupeKeys(candidate).some((key) => keys.has(key)),
		) ?? null
	);
}

export async function stageCampaignLead(
	lead: LocalStagedLead,
	path = defaultLocalCampaignStagingPath(),
): Promise<{ path: string; staged: LocalStagedLead; duplicate: boolean }> {
	const safePath = assertLocalCampaignPath(path);
	const existing = await readStagedLeads(safePath);
	const duplicate = dedupeAgainst(lead, existing);
	const staged = duplicate ? { ...lead, status: "duplicate" as const } : lead;
	await mkdir(dirname(safePath), { recursive: true });
	await appendFile(safePath, `${JSON.stringify(staged)}\n`, "utf8");
	return { path: safePath, staged, duplicate: duplicate !== null };
}
