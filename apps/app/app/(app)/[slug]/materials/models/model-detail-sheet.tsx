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
import { Icon } from "@crm/ui/components/icon";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@crm/ui/components/sheet";
import { SimpleTable } from "@crm/ui/components/simple-table";
import { Spinner } from "@crm/ui/components/spinner";
import { TableCell, TableRow } from "@crm/ui/components/table";
import { useMutation, useQuery } from "@tanstack/react-query";
import { parseAsString, useQueryState } from "nuqs";
import { toast } from "sonner";
import { SEARCH_PARAM } from "@/lib/search-param-keys";
import { useCrmCache } from "@/lib/trpc/cache";
import { useTRPC } from "@/lib/trpc/client";

export function ModelDetailSheet() {
	const trpc = useTRPC();
	const cache = useCrmCache();
	const [id, setId] = useQueryState(
		SEARCH_PARAM.materials.model,
		parseAsString,
	);

	const model = useQuery({
		...trpc.materials.modelDetail.queryOptions({ id: id ?? "" }),
		enabled: id != null,
	});

	const remove = useMutation(
		trpc.materials.deleteModel.mutationOptions({
			onSuccess: async () => {
				toast.success("Ficha deleted.");
				await cache.materials();
				await setId(null);
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	return (
		<Sheet open={id != null} onOpenChange={(next) => setId(next ? id : null)}>
			<SheetContent side="right">
				<SheetHeader>
					<SheetTitle>{model.data?.code ?? "Ficha"}</SheetTitle>
					<SheetDescription>
						{model.data?.name ?? "Materials and consumption for this model."}
					</SheetDescription>
				</SheetHeader>

				<div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4">
					{model.isLoading ? (
						<Spinner />
					) : (
						<SimpleTable
							variant="panel"
							columns={[
								{ id: "article", header: "Article" },
								{ id: "variant", header: "Color · measure · design" },
								{ id: "unit", header: "Unit" },
								{
									id: "consumption",
									header: "Consumption per unit",
									align: "right",
								},
							]}
						>
							{(model.data?.materials ?? []).map((line) => (
								<TableRow key={line.id}>
									<TableCell className="font-medium">{line.article}</TableCell>
									<TableCell className="text-muted-foreground">
										{[line.color, line.measure, line.design]
											.filter(Boolean)
											.join(" · ") || "—"}
									</TableCell>
									<TableCell className="text-muted-foreground">
										{line.unit}
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{line.consumptionPerUnit}
									</TableCell>
								</TableRow>
							))}
						</SimpleTable>
					)}
				</div>

				<div className="flex justify-end p-4">
					<AlertDialog>
						<AlertDialogTrigger asChild>
							<Button variant="outline">
								<Icon icon={TrashCan} data-icon="inline-start" />
								Delete ficha
							</Button>
						</AlertDialogTrigger>
						<AlertDialogContent>
							<AlertDialogHeader>
								<AlertDialogTitle>Delete this ficha?</AlertDialogTitle>
								<AlertDialogDescription>
									{model.data?.code} and its bill of materials will be removed.
									The raw materials themselves stay in the repository.
								</AlertDialogDescription>
							</AlertDialogHeader>
							<AlertDialogFooter>
								<AlertDialogCancel>Cancel</AlertDialogCancel>
								<AlertDialogAction onClick={() => id && remove.mutate({ id })}>
									Delete
								</AlertDialogAction>
							</AlertDialogFooter>
						</AlertDialogContent>
					</AlertDialog>
				</div>
			</SheetContent>
		</Sheet>
	);
}
