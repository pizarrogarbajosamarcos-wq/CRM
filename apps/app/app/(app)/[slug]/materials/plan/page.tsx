import type { Metadata } from "next";
import {
	PageShell,
	PageShellContent,
	PageShellDescription,
	PageShellHeader,
	PageShellHeading,
	PageShellTitle,
} from "@/components/page-shell";
import { MaterialsNav } from "../materials-nav";
import { PlanForm } from "./plan-form";

export const metadata: Metadata = {
	title: "What to order",
};

export default function PlanPage() {
	return (
		<PageShell className="min-h-0">
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>What to order</PageShellTitle>
					<PageShellDescription>
						Plan quantities to produce and see what falls short of stock.
					</PageShellDescription>
				</PageShellHeading>
			</PageShellHeader>

			<MaterialsNav />

			<PageShellContent className="min-h-0">
				<PlanForm />
			</PageShellContent>
		</PageShell>
	);
}
