"use client";

import TrashCan from "@carbon/icons-react/es/TrashCan";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@crm/ui/components/alert-dialog";
import { Button } from "@crm/ui/components/button";
import { DataTable, type DataTableColumn } from "@crm/ui/components/data-table";
import { EmptyCellValue } from "@crm/ui/components/empty-cell";
import { Icon } from "@crm/ui/components/icon";
import { Input } from "@crm/ui/components/input";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ListSearch } from "@/components/data-table/list-search";
import { useTableQuery } from "@/components/data-table/use-table-query";
import { useCrmCache } from "@/lib/trpc/cache";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";
import { materialsSearchParams } from "./materials-search-params";

type MaterialRow =
	RouterOutputs["materials"]["listRawMaterials"]["rows"][number];

function VariantCell({ row }: { row: MaterialRow }) {
	const parts = [row.color, row.measure, row.design].filter(Boolean);
	if (parts.length === 0) return <EmptyCellValue />;
	return (
		<span className="truncate text-muted-foreground">{parts.join(" · ")}</span>
	);
}

function StockCell({ row }: { row: MaterialRow }) {
	const trpc = useTRPC();
	const cache = useCrmCache();
	const [value, setValue] = useState(String(row.stockQty));

	const updateStock = useMutation(
		trpc.materials.updateStock.mutationOptions({
			onSuccess: () => cache.materials(),
			onError: (error) => {
				toast.error(error.message);
				setValue(String(row.stockQty));
			},
		}),
	);

	return (
		<Input
			type="number"
			min={0}
			step="0.001"
			value={value}
			onChange={(event) => setValue(event.target.value)}
			onBlur={() => {
				const next = Number(value);
				if (!Number.isFinite(next) || next < 0 || next === row.stockQty) {
					setValue(String(row.stockQty));
					return;
				}
				updateStock.mutate({ id: row.id, stockQty: next });
			}}
			onClick={(event) => event.stopPropagation()}
			className="h-8 w-28 text-right"
			disabled={updateStock.isPending}
		/>
	);
}

function DeleteMaterialButton({ row }: { row: MaterialRow }) {
	const trpc = useTRPC();
	const cache = useCrmCache();

	const remove = useMutation(
		trpc.materials.deleteRawMaterial.mutationOptions({
			onSuccess: () => cache.materials(),
			onError: (error) => toast.error(error.message),
		}),
	);

	return (
		<AlertDialog>
			<AlertDialogTrigger asChild>
				<Button
					variant="ghost"
					size="icon"
					onClick={(event) => event.stopPropagation()}
				>
					<Icon icon={TrashCan} />
					<span className="sr-only">Delete {row.article}</span>
				</Button>
			</AlertDialogTrigger>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Delete this raw material?</AlertDialogTitle>
					<AlertDialogDescription>
						{row.article} will no longer be tracked. Any ficha that consumes it
						keeps its own record of the consumption.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<AlertDialogAction onClick={() => remove.mutate({ id: row.id })}>
						Delete
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

const COLUMNS: DataTableColumn<MaterialRow>[] = [
	{
		id: "article",
		header: "Article",
		sortable: true,
		hideable: false,
		width: "w-[20%]",
		cell: (row) => <span className="truncate font-medium">{row.article}</span>,
	},
	{
		id: "variant",
		header: "Color · measure · design",
		width: "w-[26%]",
		cell: (row) => <VariantCell row={row} />,
	},
	{
		id: "name",
		header: "Name",
		sortable: true,
		width: "w-[20%]",
		hideBelow: "md",
		cell: (row) =>
			row.name ? (
				<span className="truncate text-muted-foreground">{row.name}</span>
			) : (
				<EmptyCellValue />
			),
	},
	{
		id: "unit",
		header: "Unit",
		sortable: true,
		width: "w-[8%]",
		cell: (row) => <span className="text-muted-foreground">{row.unit}</span>,
	},
	{
		id: "stockQty",
		header: "Stock",
		label: "Stock quantity",
		sortable: true,
		align: "right",
		width: "w-[16%]",
		cell: (row) => <StockCell row={row} />,
	},
	{
		id: "actions",
		header: "",
		hideable: false,
		align: "right",
		width: "w-[6%]",
		cell: (row) => <DeleteMaterialButton row={row} />,
	},
];

export function MaterialsTable() {
	const trpc = useTRPC();
	const table = useTableQuery(materialsSearchParams);
	const { query, input } = table;

	const materials = useQuery({
		...trpc.materials.listRawMaterials.queryOptions(input),
		placeholderData: (previous) => previous,
	});

	const rows = materials.data?.rows ?? [];

	return (
		<DataTable
			query={query}
			search={<ListSearch placeholder="Search by article, color, design…" />}
			columns={COLUMNS}
			rows={rows}
			total={materials.data?.total ?? 0}
			getRowId={(row) => row.id}
			loading={materials.isFetching}
			empty="No raw materials yet. Import an Excel file to get started."
		/>
	);
}
