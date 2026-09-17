import { describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { extractLocalLead } from "../agent/lib/local-lead-extraction";
import {
	defaultLocalLeadStagingPath,
	stageLocalLead,
} from "../agent/lib/local-lead-staging";

const response = JSON.stringify({
	company_name: "Acme Field Systems",
	website: "https://acmefield.example",
	contact_name: "Jordan Lee",
	role: "Head of Partnerships",
	email: null,
	phone: null,
	source_url: "https://example.com/acme",
	evidence_excerpt: "Acme Field Systems. Jordan Lee — Head of Partnerships.",
	confidence_reason: "The page states the company, contact, and role.",
	missing_fields: ["email", "phone"],
});

describe("local lead staging", () => {
	it("anchors the default path inside apps/agent", () => {
		expect(defaultLocalLeadStagingPath()).toEndWith(
			"/apps/agent/var/local-leads/leads.jsonl",
		);
	});

	it("deduplicates by content hash", async () => {
		const path = `var/local-leads/test-${randomUUID()}.jsonl`;
		let stagedPath: string | undefined;
		try {
			const lead = await extractLocalLead(
				"Acme Field Systems. Jordan Lee — Head of Partnerships.",
				"https://example.com/acme",
				{ generate: async () => ({ text: response, latencyMs: 5 }) },
			);
			const first = await stageLocalLead(lead, path);
			stagedPath = first.path;
			expect(first.staged).toBe(true);
			expect((await stageLocalLead(lead, path)).staged).toBe(false);
		} finally {
			if (stagedPath) await rm(stagedPath, { force: true });
		}
	});

	it("rejects paths outside local staging", async () => {
		const lead = await extractLocalLead(
			"Acme Field Systems. Jordan Lee — Head of Partnerships.",
			"https://example.com/acme",
			{ generate: async () => ({ text: response, latencyMs: 5 }) },
		);
		expect(stageLocalLead(lead, ".env")).rejects.toThrow("var/local-leads");
	});
});
