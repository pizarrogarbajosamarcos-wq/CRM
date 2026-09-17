import type { LocalStagedLead } from "./local-campaign-staging";

type CsvValue = string | string[] | number | boolean | null | undefined;

function csvValue(value: CsvValue): string {
	const text = value === null || value === undefined ? "" : String(value);
	return /[,"\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function localCampaignJsonl(leads: LocalStagedLead[]): string {
	return `${leads.map((lead) => JSON.stringify(lead)).join("\n")}\n`;
}

export function localCampaignCsv(leads: LocalStagedLead[]): string {
	const headers = leads[0] ? Object.keys(leads[0]) : [];
	const rows = [
		headers,
		...leads.map((lead) =>
			headers.map((header) => lead[header as keyof typeof lead]),
		),
	];
	return `${rows.map((row) => row.map(csvValue).join(",")).join("\n")}\n`;
}
