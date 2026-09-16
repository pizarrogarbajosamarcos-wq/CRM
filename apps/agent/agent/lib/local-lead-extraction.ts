import { createHash } from "node:crypto";
import { lookup as resolveHostname } from "node:dns/promises";
import { type LocalLead, localLeadSchema } from "./local-lead-schema";
import { createLocalOllamaClient, type OllamaClient } from "./local-ollama";

export const LOCAL_LEAD_MODEL = "qwen2.5:14b";
const DEFAULT_FETCH_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_SOURCE_BYTES = 512_000;

export type DnsLookup = (
	hostname: string,
	options: { all: true; verbatim: true },
) => Promise<Array<{ address: string; family: number }>>;

export type LocalLeadRecord = LocalLead & {
	model_name: string;
	latency_ms: number;
	content_hash: string;
	parser_status: "accepted";
	attempt_count: number;
	created_at: string;
};

export function parseLocalLeadResponse(
	raw: string,
	sourceUrl: string,
): LocalLead {
	const trimmed = raw.trim();
	if (
		trimmed.includes("```") ||
		!trimmed.startsWith("{") ||
		!trimmed.endsWith("}")
	) {
		throw new Error("Model response is not a plain JSON object.");
	}

	let value: unknown;
	try {
		value = JSON.parse(trimmed);
	} catch {
		throw new Error("Model response is invalid JSON.");
	}

	const lead = localLeadSchema.parse(value);
	const nullFields = [
		"company_name",
		"website",
		"contact_name",
		"role",
		"email",
		"phone",
	] as const;
	const expectedMissing = nullFields.filter((field) => lead[field] === null);
	const actualMissing = [...lead.missing_fields].sort();
	const sortedExpected = [...expectedMissing].sort();
	if (JSON.stringify(actualMissing) !== JSON.stringify(sortedExpected)) {
		throw new Error("missing_fields does not match null fields.");
	}

	if (lead.source_url !== sourceUrl) {
		throw new Error("source_url does not match the requested source.");
	}

	for (const field of [
		"company_name",
		"contact_name",
		"email",
		"phone",
	] as const) {
		const valueForEvidence = lead[field];
		if (
			valueForEvidence &&
			!lead.evidence_excerpt
				.toLocaleLowerCase()
				.includes(valueForEvidence.toLocaleLowerCase())
		) {
			throw new Error(`${field} is not present in evidence_excerpt.`);
		}
	}

	return lead;
}

export async function extractLocalLead(
	text: string,
	sourceUrl: string,
	client: OllamaClient = createLocalOllamaClient(),
): Promise<LocalLeadRecord> {
	if (!text.trim()) throw new Error("Source text is empty.");

	const prompt = [
		"Return exactly one plain JSON object. Do not use markdown fences.",
		"Use these keys exactly: company_name, website, contact_name, role, email, phone, source_url, evidence_excerpt, confidence_reason, missing_fields.",
		"Use null for every unknown scalar field.",
		"Use missing_fields for exactly the scalar fields that are null.",
		"Never invent an email, phone number, or contact name.",
		"Every non-null company_name, contact_name, email, and phone must appear verbatim in evidence_excerpt.",
		`The source URL is ${sourceUrl}. Return that exact value as source_url.`,
		"Page text:",
		text,
	].join("\n");

	const result = await client.generate({ model: LOCAL_LEAD_MODEL, prompt });
	const lead = parseLocalLeadResponse(result.text, sourceUrl);
	const contentHash = createHash("sha256").update(text, "utf8").digest("hex");

	return {
		...lead,
		model_name: LOCAL_LEAD_MODEL,
		latency_ms: result.latencyMs,
		content_hash: contentHash,
		parser_status: "accepted",
		attempt_count: 1,
		created_at: new Date().toISOString(),
	};
}

export async function fetchLocalLeadSource(
	url: string,
	fetchImpl: typeof fetch = fetch,
	options: {
		timeoutMs?: number;
		maxBytes?: number;
		lookup?: DnsLookup;
	} = {},
): Promise<{ sourceUrl: string; text: string }> {
	const parsed = new URL(url);
	if (!["http:", "https:"].includes(parsed.protocol)) {
		throw new Error("Source URL must use HTTP or HTTPS.");
	}
	if (isBlockedHostname(parsed.hostname)) {
		throw new Error("Local source URLs are blocked.");
	}
	await assertPublicHostname(
		parsed.hostname,
		options.lookup ?? resolveHostname,
	);

	const response = await fetchImpl(url, {
		signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS),
		headers: { accept: "text/html,text/plain;q=0.9" },
	});
	if (!response.ok) throw new Error(`Source returned HTTP ${response.status}.`);
	const maxBytes = options.maxBytes ?? DEFAULT_MAX_SOURCE_BYTES;
	const contentLength = Number(response.headers.get("content-length"));
	if (Number.isFinite(contentLength) && contentLength > maxBytes) {
		throw new Error("Source exceeds the maximum content size.");
	}
	if (!response.body) throw new Error("Source returned no body.");

	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (true) {
			const next = await reader.read();
			if (next.done) break;
			size += next.value.byteLength;
			if (size > maxBytes) {
				await reader.cancel();
				throw new Error("Source exceeds the maximum content size.");
			}
			chunks.push(next.value);
		}
	} finally {
		reader.releaseLock();
	}

	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return { sourceUrl: url, text: new TextDecoder().decode(bytes) };
}

async function assertPublicHostname(
	hostname: string,
	lookup: DnsLookup,
): Promise<void> {
	try {
		const addresses = await lookup(hostname, { all: true, verbatim: true });
		if (
			addresses.length === 0 ||
			addresses.some((entry) => isBlockedHostname(entry.address))
		) {
			throw new Error("Source hostname resolves to a local address.");
		}
	} catch (error) {
		if (
			error instanceof Error &&
			error.message === "Source hostname resolves to a local address."
		) {
			throw error;
		}
		throw new Error("Source hostname DNS lookup failed.");
	}
}

function isBlockedHostname(hostname: string): boolean {
	const host = hostname.toLocaleLowerCase().replace(/\.$/, "");
	const internalSuffixes = [
		".localhost",
		".local",
		".internal",
		".lan",
		".home.arpa",
	];
	if (
		["localhost", "internal", "intranet"].includes(host) ||
		internalSuffixes.some((suffix) => host.endsWith(suffix))
	) {
		return true;
	}

	const parts = host.split(".").map(Number);
	if (parts.length === 4 && parts.every(Number.isInteger)) {
		const first = parts[0] ?? -1;
		const second = parts[1] ?? -1;
		return (
			first === 0 ||
			first === 10 ||
			first === 127 ||
			(first === 169 && second === 254) ||
			(first === 172 && second >= 16 && second <= 31) ||
			(first === 192 && second === 168) ||
			(first === 192 && second === 0) ||
			(first === 198 && second >= 18 && second <= 19) ||
			(first === 198 && second === 51) ||
			(first === 203 && second === 0) ||
			(first >= 224 && first <= 255) ||
			(first === 100 && second >= 64 && second <= 127)
		);
	}

	if (host.includes(":")) {
		return (
			host === "::" ||
			host.startsWith("ff") ||
			host.startsWith("2001:db8:") ||
			host.startsWith("::ffff:0.") ||
			host.startsWith("::ffff:100.") ||
			host.startsWith("::ffff:127.") ||
			host.startsWith("::ffff:169.254.") ||
			host.startsWith("::ffff:172.") ||
			host.startsWith("::ffff:192.0.") ||
			host === "::1" ||
			host.startsWith("fc") ||
			host.startsWith("fd") ||
			host.startsWith("fe8") ||
			host.startsWith("fe9") ||
			host.startsWith("fea") ||
			host.startsWith("feb") ||
			host.startsWith("::ffff:10.") ||
			host.startsWith("::ffff:192.168.")
		);
	}

	return false;
}
