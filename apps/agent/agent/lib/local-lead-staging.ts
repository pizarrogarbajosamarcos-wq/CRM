import { appendFile, mkdir, readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { LocalLeadRecord } from "./local-lead-extraction";

const DEFAULT_STAGING_PATH = "var/local-leads/leads.jsonl";
const LOCAL_AGENT_ROOT = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../..",
);

export function defaultLocalLeadStagingPath(): string {
	return resolve(LOCAL_AGENT_ROOT, DEFAULT_STAGING_PATH);
}

export function assertLocalLeadStagingPath(path: string): string {
	const resolved = resolve(LOCAL_AGENT_ROOT, path);
	const allowed = resolve(LOCAL_AGENT_ROOT, "var/local-leads");
	const relativePath = relative(allowed, resolved);
	if (
		!relativePath ||
		relativePath.startsWith("..") ||
		isAbsolute(relativePath)
	) {
		throw new Error("Staging path must stay under var/local-leads.");
	}
	if (basename(resolved).startsWith(".env") || resolved.includes("/.git/")) {
		throw new Error("Staging path cannot target configuration or Git files.");
	}
	return resolved;
}

export async function stageLocalLead(
	lead: LocalLeadRecord,
	path = defaultLocalLeadStagingPath(),
): Promise<{ path: string; staged: boolean }> {
	const safePath = assertLocalLeadStagingPath(path);
	let existing = "";
	try {
		existing = await readFile(safePath, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}

	for (const line of existing.split("\n")) {
		if (!line.trim()) continue;
		const row = JSON.parse(line) as { content_hash?: unknown };
		if (row.content_hash === lead.content_hash)
			return { path: safePath, staged: false };
	}

	await mkdir(dirname(safePath), { recursive: true });
	await appendFile(safePath, `${JSON.stringify(lead)}\n`, "utf8");
	return { path: safePath, staged: true };
}
