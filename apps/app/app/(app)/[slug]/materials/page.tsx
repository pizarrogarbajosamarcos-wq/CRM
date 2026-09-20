import type { Metadata } from "next";
import { Suspense } from "react";
import {
	PageShell,
	PageShellActions,
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
import { ImportMaterialsSheet } from "./import-materials-sheet";
import { MaterialsNav, MaterialsNavFallback } from "./materials-nav";
import { materialsSearchParams } from "./materials-search-params";
import { MaterialsTable } from "./materials-table";

export const metadata: Metadata = {
	title: "Materials",
};

export default function MaterialsPage({
	searchParams,
}: PageProps<"/[slug]/materials">) {
	return (
		<PageShell className="min-h-0">
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>Raw materials</PageShellTitle>
					<PageShellDescription>
						The materials repository, grouped by article, color, measure and
						design.
					</PageShellDescription>
				</PageShellHeading>
				<PageShellActions>
					<ImportMaterialsSheet />
				</PageShellActions>
			</PageShellHeader>

			<Suspense fallback={<MaterialsNavFallback />}>
				<MaterialsNav />
			</Suspense>

			<PageShellContent className="min-h-0">
				<Suspense fallback={<PageShellLoading />}>
					<RawMaterials searchParams={searchParams} />
				</Suspense>
			</PageShellContent>
		</PageShell>
	);
}

async function RawMaterials({
	searchParams,
}: Pick<PageProps<"/[slug]/materials">, "searchParams">) {
	const [, values] = await Promise.all([
		requireSession(),
		materialsSearchParams.load(searchParams),
	]);

	const trpc = getServerTrpc();
	const queryClient = getServerQueryClient();
	await queryClient.prefetchQuery(
		trpc.materials.listRawMaterials.queryOptions(
			materialsSearchParams.toInput(values),
		),
	);

	return (
		<HydrateClient>
			<MaterialsTable />
		</HydrateClient>
	);
}
