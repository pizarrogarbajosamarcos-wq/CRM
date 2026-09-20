"use client";

import { DataTable, type DataTableColumn } from "@crm/ui/components/data-table";
import { EmptyCellValue } from "@crm/ui/components/empty-cell";
import { useQuery } from "@tanstack/react-query";
import { parseAsString, useQueryState } from "nuqs";
import { ListSearch } from "@/components/data-table/list-search";
import { useTableQuery } from "@/components/data-table/use-table-query";
import { SEARCH_PARAM } from "@/lib/search-param-keys";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";
import { modelsSearchParams } from "./models-search-params";

type ModelRow = RouterOutputs["materials"]["listModels"]["rows"][number];

const COLUMNS: DataTableColumn<ModelRow>[] = [
	{
		id: "code",
		header: "Model",
		sortable: true,
		hideable: false,
		width: "w-[24%]",
		cell: (row) => <span className="truncate font-medium">{row.code}</span>,
	},
	{
		id: "name",
		header: "Name",
		sortable: true,
		width: "w-[40%]",
		cell: (row) =>
			row.name ? (
				<span className="truncate text-muted-foreground">{row.name}</span>
			) : (
				<EmptyCellValue />
			),
	},
	{
		id: "materialsCount",
		header: "Materials",
		align: "right",
		width: "w-[18%]",
		cell: (row) => <span className="tabular-nums">{row.materialsCount}</span>,
	},
];

export function ModelsTable() {
	const trpc = useTRPC();
	const table = useTableQuery(modelsSearchParams);
	const { query, input } = table;
	const [, setModelId] = useQueryState(
		SEARCH_PARAM.materials.model,
		parseAsString,
	);

	const models = useQuery({
		...trpc.materials.listModels.queryOptions(input),
		placeholderData: (previous) => previous,
	});

	const rows = models.data?.rows ?? [];

	return (
		<DataTable
			query={query}
			search={<ListSearch placeholder="Search by model code or name…" />}
			columns={COLUMNS}
			rows={rows}
			total={models.data?.total ?? 0}
			getRowId={(row) => row.id}
			loading={models.isFetching}
			onRowClick={(row) => setModelId(row.id)}
			empty="No fichas yet. Import an Excel file with a Fichas sheet."
		/>
	);
}
