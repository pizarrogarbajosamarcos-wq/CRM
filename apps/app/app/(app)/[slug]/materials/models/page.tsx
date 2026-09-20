import type { Metadata } from "next";
import { Suspense } from "react";
import {
	PageShell,
	PageShellContent,
	PageShellDescription,
	PageShellHeader,
	PageShellHeading,
	PageShellLoading,
	PageShellTitle,
} from "@/components/page-shell";
import { requireSession } from "@/lib/session";
import { HydrateClient } from "@/lib/trpc/hydrate";
import { getServerQueryClient, getServerTrpc } from "@/lib/trpc/server";
import { MaterialsNav } from "../materials-nav";
import { ModelDetailSheet } from "./model-detail-sheet";
import { modelsSearchParams } from "./models-search-params";
import { ModelsTable } from "./models-table";

export const metadata: Metadata = {
	title: "Fichas",
};

export default function ModelsPage({
	searchParams,
}: PageProps<"/[slug]/materials/models">) {
	return (
		<PageShell className="min-h-0">
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>Fichas (BOM)</PageShellTitle>
					<PageShellDescription>
						What each model is made of, and how much of it.
					</PageShellDescription>
				</PageShellHeading>
			</PageShellHeader>

			<MaterialsNav />

			<PageShellContent className="min-h-0">
				<Suspense fallback={<PageShellLoading />}>
					<Models searchParams={searchParams} />
				</Suspense>
			</PageShellContent>

			<ModelDetailSheet />
		</PageShell>
	);
}

async function Models({
	searchParams,
}: Pick<PageProps<"/[slug]/materials/models">, "searchParams">) {
	const [, values] = await Promise.all([
		requireSession(),
		modelsSearchParams.load(searchParams),
	]);

	const trpc = getServerTrpc();
	const queryClient = getServerQueryClient();
	await queryClient.prefetchQuery(
		trpc.materials.listModels.queryOptions(modelsSearchParams.toInput(values)),
	);

	return (
		<HydrateClient>
			<ModelsTable />
		</HydrateClient>
	);
}
