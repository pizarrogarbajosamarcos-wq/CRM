import {
	extractLocalLead,
	fetchLocalLeadSource,
} from "../lib/local-lead-extraction";
import {
	defaultLocalLeadStagingPath,
	stageLocalLead,
} from "../lib/local-lead-staging";

function valueAfter(args: string[], flag: string): string | undefined {
	const index = args.indexOf(flag);
	return index >= 0 ? args[index + 1] : undefined;
}

function valueEquals(args: string[], flag: string): string | undefined {
	const prefix = `${flag}=`;
	return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function argument(args: string[], flag: string): string | undefined {
	return valueEquals(args, flag) ?? valueAfter(args, flag);
}

function assertDryRun(args: string[]): void {
	const forbidden = args.filter((arg) =>
		["--sync", "--sync-crm", "--production", "--neon"].includes(
			arg.split("=", 1)[0] ?? "",
		),
	);
	if (forbidden.length > 0) {
		throw new Error(
			`CRM synchronization is not implemented. Refused: ${forbidden.join(", ")}`,
		);
	}
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	assertDryRun(args);

	const text = argument(args, "--text");
	const url = argument(args, "--url");
	if ((text ? 1 : 0) + (url ? 1 : 0) !== 1) {
		throw new Error("Provide exactly one of --text or --url.");
	}

	const source = url
		? await fetchLocalLeadSource(url)
		: {
				sourceUrl:
					argument(args, "--source-url") ?? "https://local.invalid/sample",
				text: text as string,
			};
	const lead = await extractLocalLead(source.text, source.sourceUrl);
	const staged = await stageLocalLead(
		lead,
		argument(args, "--staging-path") ?? defaultLocalLeadStagingPath(),
	);

	console.log(
		JSON.stringify(
			{ mode: "dry-run", extracted: lead, staging: staged },
			null,
			2,
		),
	);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
