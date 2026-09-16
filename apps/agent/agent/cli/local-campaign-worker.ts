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
		const campaign = await loadCampaignFile(argument(args, "--campaign") ?? "");
		const seedFile = argument(args, "--seed-file");
		const seeds = seedFile
			? await loadCampaignSeeds(seedFile)
			: campaign.seed_urls;
		const result = await runLocalCampaign(campaign, seeds, {
			stagingPath: argument(args, "--staging-path"),
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
