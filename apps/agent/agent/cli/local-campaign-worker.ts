import { writeFile } from "node:fs/promises";
import {
	localCampaignCsv,
	localCampaignJsonl,
} from "../lib/local-campaign-export";
import {
	assertLocalCampaignOnly,
	loadCampaignFile,
	loadCampaignSeeds,
	runLocalCampaign,
} from "../lib/local-campaign-runner";
import {
	assertLocalCampaignPath,
	defaultLocalCampaignStagingPath,
	readStagedLeads,
} from "../lib/local-campaign-staging";

function argument(args: string[], flag: string): string | undefined {
	const index = args.indexOf(flag);
	return (
		args
			.find((value) => value.startsWith(`${flag}=`))
			?.slice(flag.length + 1) ?? args[index + 1]
	);
}

function numericArgument(args: string[], flag: string): number | undefined {
	const value = argument(args, flag);
	if (value === undefined) return undefined;
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		throw new Error(`${flag} must be a positive number.`);
	}
	return Math.round(parsed);
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	assertLocalCampaignOnly(args);
	const command = args[0];
	if (command === "validate") {
		const campaign = await loadCampaignFile(argument(args, "--campaign") ?? "");
		console.log(
			JSON.stringify(
				{ valid: true, campaign_id: campaign.campaign_id },
				null,
				2,
			),
		);
		return;
	}
	if (command === "run") {
		const baseCampaign = await loadCampaignFile(
			argument(args, "--campaign") ?? "",
		);
		const campaign = {
			...baseCampaign,
			max_source_units_per_page:
				numericArgument(args, "--max-source-units-per-page") ??
				baseCampaign.max_source_units_per_page,
			max_source_unit_chars:
				numericArgument(args, "--max-source-unit-chars") ??
				baseCampaign.max_source_unit_chars,
			max_ollama_calls_per_seed:
				numericArgument(args, "--max-ollama-calls-per-seed") ??
				baseCampaign.max_ollama_calls_per_seed,
			max_total_ollama_calls:
				numericArgument(args, "--max-total-ollama-calls") ??
				baseCampaign.max_total_ollama_calls,
			per_ollama_call_timeout_ms:
				numericArgument(args, "--per-ollama-call-timeout-ms") ??
				baseCampaign.per_ollama_call_timeout_ms,
		};
		const seedFile = argument(args, "--seed-file");
		const seeds = seedFile
			? await loadCampaignSeeds(seedFile)
			: campaign.seed_urls;
		const progress = args.includes("--progress");
		const result = await runLocalCampaign(campaign, seeds, {
			stagingPath: argument(args, "--staging-path"),
			seedStatusPath: argument(args, "--seed-status-path"),
			perSeedTimeoutMs: numericArgument(args, "--per-seed-timeout-ms"),
			onProgress: progress
				? (event) => console.error(JSON.stringify(event))
				: undefined,
		});
		console.log(JSON.stringify({ mode: "dry-run", ...result }, null, 2));
		return;
	}
	if (command === "list") {
		const path =
			argument(args, "--staging-path") ?? defaultLocalCampaignStagingPath();
		console.log(JSON.stringify(await readStagedLeads(path), null, 2));
		return;
	}
	if (command === "export") {
		const format = argument(args, "--format");
		const path =
			argument(args, "--staging-path") ?? defaultLocalCampaignStagingPath();
		const leads = await readStagedLeads(path);
		const output = argument(args, "--out");
		if (!output) throw new Error("Export needs --out.");
		const safeOutput = assertLocalCampaignPath(output);
		if (format === "jsonl") {
			await writeFile(safeOutput, localCampaignJsonl(leads), "utf8");
		} else if (format === "csv") {
			await writeFile(safeOutput, localCampaignCsv(leads), "utf8");
		} else {
			throw new Error("Export format must be csv or jsonl.");
		}
		console.log(
			JSON.stringify(
				{ exported: leads.length, output: safeOutput, format },
				null,
				2,
			),
		);
		return;
	}
	throw new Error("Use validate, run, list, or export.");
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
