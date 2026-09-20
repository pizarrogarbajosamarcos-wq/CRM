"use client";

import Add from "@carbon/icons-react/es/Add";
import TrashCan from "@carbon/icons-react/es/TrashCan";
import { Alert, AlertDescription, AlertTitle } from "@crm/ui/components/alert";
import { Button } from "@crm/ui/components/button";
import { Icon } from "@crm/ui/components/icon";
import { Input } from "@crm/ui/components/input";
import { SimpleTable } from "@crm/ui/components/simple-table";
import { Spinner } from "@crm/ui/components/spinner";
import { TableCell, TableRow } from "@crm/ui/components/table";
import { cn } from "@crm/ui/lib/utils";
import { useMutation } from "@tanstack/react-query";
import { useId, useRef, useState } from "react";
import { useTRPC } from "@/lib/trpc/client";

type PlanRow = { key: string; modelCode: string; quantity: string };

export function PlanForm() {
	const trpc = useTRPC();
	const formId = useId();
	const rowIdBase = useId();
	const nextRowIndex = useRef(1);
	const [rows, setRows] = useState<PlanRow[]>(() => [
		{ key: `${rowIdBase}-0`, modelCode: "", quantity: "" },
	]);

	const addRow = () => {
		const key = `${rowIdBase}-${nextRowIndex.current}`;
		nextRowIndex.current += 1;
		setRows((current) => [...current, { key, modelCode: "", quantity: "" }]);
	};

	const requirement = useMutation(trpc.materials.requirement.mutationOptions());

	const updateRow = (key: string, patch: Partial<PlanRow>) => {
		setRows((current) =>
			current.map((row) => (row.key === key ? { ...row, ...patch } : row)),
		);
	};

	const plan = rows
		.map((row) => ({
			modelCode: row.modelCode.trim(),
			quantity: Number(row.quantity),
		}))
		.filter(
			(row) =>
				row.modelCode !== "" &&
				Number.isFinite(row.quantity) &&
				row.quantity > 0,
		);

	return (
		<div className="flex flex-col gap-6">
			<form
				id={formId}
				className="flex flex-col gap-3"
				onSubmit={(event) => {
					event.preventDefault();
					if (plan.length === 0) return;
					requirement.mutate({ plan });
				}}
			>
				<div className="flex flex-col gap-2">
					{rows.map((row) => (
						<div key={row.key} className="flex items-center gap-2">
							<Input
								placeholder="Model code"
								value={row.modelCode}
								onChange={(event) =>
									updateRow(row.key, { modelCode: event.target.value })
								}
								className="w-48"
							/>
							<Input
								type="number"
								min={0}
								placeholder="Quantity to produce"
								value={row.quantity}
								onChange={(event) =>
									updateRow(row.key, { quantity: event.target.value })
								}
								className="w-48"
							/>
							<Button
								type="button"
								variant="ghost"
								size="icon"
								disabled={rows.length === 1}
								onClick={() =>
									setRows((current) =>
										current.filter((entry) => entry.key !== row.key),
									)
								}
							>
								<Icon icon={TrashCan} />
								<span className="sr-only">Remove row</span>
							</Button>
						</div>
					))}
				</div>

				<div className="flex items-center gap-2">
					<Button type="button" variant="outline" size="sm" onClick={addRow}>
						<Icon icon={Add} data-icon="inline-start" />
						Add model
					</Button>
					<Button
						type="submit"
						disabled={plan.length === 0 || requirement.isPending}
					>
						{requirement.isPending ? <Spinner /> : null}
						Calculate what to order
					</Button>
				</div>
			</form>

			{requirement.isError ? (
				<Alert variant="destructive">
					<AlertTitle>Could not calculate the requirement</AlertTitle>
					<AlertDescription>{requirement.error.message}</AlertDescription>
				</Alert>
			) : null}

			{requirement.data && requirement.data.unknownModelCodes.length > 0 ? (
				<Alert variant="destructive">
					<AlertTitle>Unknown model codes</AlertTitle>
					<AlertDescription>
						No ficha found for: {requirement.data.unknownModelCodes.join(", ")}
					</AlertDescription>
				</Alert>
			) : null}

			{requirement.data && requirement.data.rows.length > 0 ? (
				<SimpleTable
					columns={[
						{ id: "article", header: "Article" },
						{ id: "variant", header: "Color · measure · design" },
						{ id: "unit", header: "Unit" },
						{ id: "required", header: "Required", align: "right" },
						{ id: "stock", header: "In stock", align: "right" },
						{ id: "toOrder", header: "To order", align: "right" },
					]}
				>
					{requirement.data.rows.map((row) => (
						<TableRow key={row.rawMaterialId}>
							<TableCell className="font-medium">{row.article}</TableCell>
							<TableCell className="text-muted-foreground">
								{[row.color, row.measure, row.design]
									.filter(Boolean)
									.join(" · ") || "—"}
							</TableCell>
							<TableCell className="text-muted-foreground">
								{row.unit}
							</TableCell>
							<TableCell className="text-right tabular-nums">
								{row.required}
							</TableCell>
							<TableCell className="text-right tabular-nums">
								{row.stock}
							</TableCell>
							<TableCell
								className={cn(
									"text-right tabular-nums font-medium",
									row.toOrder > 0 && "text-destructive",
								)}
							>
								{row.toOrder}
							</TableCell>
						</TableRow>
					))}
				</SimpleTable>
			) : null}
		</div>
	);
}
