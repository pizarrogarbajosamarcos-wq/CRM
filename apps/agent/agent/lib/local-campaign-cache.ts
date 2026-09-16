import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fetchLocalLeadSource } from "./local-lead-extraction";
import { defaultLocalLeadStagingPath } from "./local-lead-staging";

export type CachedPage = {
	url: string;
	content_hash: string;
	text: string;
	fetched_at: string;
};

const cachePath = () =>
	defaultLocalLeadStagingPath().replace(/leads\.jsonl$/, "pages.jsonl");

export async function readCachedPage(
	url: string,
	path = cachePath(),
): Promise<CachedPage | null> {
	let raw = "";
	try {
		raw = await readFile(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
	for (const line of raw.split("\n")) {
		if (!line.trim()) continue;
		const row = JSON.parse(line) as CachedPage;
		if (row.url === url) return row;
	}
	return null;
}

export async function fetchCachedPage(
	url: string,
	fetchImpl: typeof fetch = fetch,
	path = cachePath(),
): Promise<{ page: CachedPage; cached: boolean }> {
	const existing = await readCachedPage(url, path);
	if (existing) return { page: existing, cached: true };
	const source = await fetchLocalLeadSource(url, fetchImpl);
	const page: CachedPage = {
		url,
		content_hash: createHash("sha256")
			.update(source.text, "utf8")
			.digest("hex"),
		text: source.text,
		fetched_at: new Date().toISOString(),
	};
	await mkdir(dirname(path), { recursive: true });
	await appendFile(path, `${JSON.stringify(page)}\n`, "utf8");
	return { page, cached: false };
}
