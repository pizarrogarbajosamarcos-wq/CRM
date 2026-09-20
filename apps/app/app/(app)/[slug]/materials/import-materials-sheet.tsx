"use client";

import Upload from "@carbon/icons-react/es/Upload";
import { Button } from "@crm/ui/components/button";
import { Icon } from "@crm/ui/components/icon";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "@crm/ui/components/sheet";
import { Spinner } from "@crm/ui/components/spinner";
import { useMutation } from "@tanstack/react-query";
import { parseAsBoolean, useQueryState } from "nuqs";
import { useId, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { SEARCH_PARAM } from "@/lib/search-param-keys";
import { useCrmCache } from "@/lib/trpc/cache";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";

type ImportResult = RouterOutputs["materials"]["importExcel"];

const dataUrl = z.string();

function readAsBase64(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onerror = () => reject(reader.error ?? new Error("Read failed."));
		reader.onload = () => {
			const text = dataUrl.parse(reader.result);
			resolve(text.slice(text.indexOf(",") + 1));
		};
		reader.readAsDataURL(file);
	});
}

function ResultSummary({ result }: { result: ImportResult }) {
	if (result.errors.length > 0) {
		return (
			<div className="flex flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
				<p className="font-medium text-destructive">
					Nothing was imported. Fix these rows and try again.
				</p>
				<ul className="flex flex-col gap-1 text-muted-foreground">
					{result.errors.map((issue) => (
						<li key={`${issue.sheet}-${issue.row}-${issue.message}`}>
							<span className="font-medium text-foreground">
								{issue.sheet} · row {issue.row}
							</span>{" "}
							— {issue.message}
						</li>
					))}
				</ul>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-1 rounded-lg border bg-muted/40 p-3 text-sm">
			<p>
				Materials: {result.materialsCreated} added, {result.materialsUpdated}{" "}
				updated.
			</p>
			<p>
				Models: {result.modelsCreated} added, {result.modelsUpdated} updated.
			</p>
			<p>
				BOM lines: {result.bomLinesCreated} added, {result.bomLinesUpdated}{" "}
				updated.
			</p>
		</div>
	);
}

export function ImportMaterialsSheet() {
	const trpc = useTRPC();
	const cache = useCrmCache();
	const fileInputId = useId();

	const [open, setOpen] = useQueryState(
		SEARCH_PARAM.dialog.importSheet,
		parseAsBoolean.withDefault(false),
	);
	const [file, setFile] = useState<File | null>(null);
	const [result, setResult] = useState<ImportResult | null>(null);

	const importExcel = useMutation(
		trpc.materials.importExcel.mutationOptions({
			onSuccess: async (data) => {
				setResult(data);
				if (data.errors.length === 0) {
					toast.success("Materials imported.");
					await cache.materials();
					setFile(null);
				}
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	return (
		<Sheet
			open={open}
			onOpenChange={(next) => {
				setOpen(next || null);
				if (!next) {
					setFile(null);
					setResult(null);
				}
			}}
		>
			<SheetTrigger asChild>
				<Button variant="outline">
					<Icon icon={Upload} data-icon="inline-start" />
					Import Excel
				</Button>
			</SheetTrigger>
			<SheetContent side="right">
				<SheetHeader>
					<SheetTitle>Import materials and fichas</SheetTitle>
					<SheetDescription>
						An Excel file with a "Materiales" sheet, a "Fichas" sheet, or both.
						Re-importing the same article, color, measure and design updates it
						instead of duplicating it.
					</SheetDescription>
				</SheetHeader>

				<div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4">
					<a
						className="text-primary text-sm underline underline-offset-4"
						href="/templates/plantilla-materiales.xlsx"
						download
					>
						Download the template
					</a>

					<div className="flex flex-col gap-2">
						<input
							id={fileInputId}
							type="file"
							accept=".xlsx"
							onChange={(event) => {
								setResult(null);
								setFile(event.target.files?.[0] ?? null);
							}}
							className="text-sm"
						/>
					</div>

					{result ? <ResultSummary result={result} /> : null}
				</div>

				<SheetFooter>
					<Button
						disabled={!file || importExcel.isPending}
						onClick={async () => {
							if (!file) return;
							const fileBase64 = await readAsBase64(file);
							importExcel.mutate({ fileName: file.name, fileBase64 });
						}}
					>
						{importExcel.isPending ? <Spinner /> : null}
						Import
					</Button>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}
