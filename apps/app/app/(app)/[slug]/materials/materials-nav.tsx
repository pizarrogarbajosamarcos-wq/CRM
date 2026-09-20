"use client";

import { Button } from "@crm/ui/components/button";
import { cn } from "@crm/ui/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";
import { useWorkspaceUrl } from "@/lib/use-workspace-url";

const ROOT = "/materials";

const ITEMS = [
	{ title: "Raw materials", href: ROOT },
	{ title: "Fichas (BOM)", href: `${ROOT}/models` },
	{ title: "What to order", href: `${ROOT}/plan` },
];

function isActive(href: string, root: string, pathname: string): boolean {
	return href === root ? pathname === href : pathname.startsWith(href);
}

export function MaterialsNav() {
	const pathname = usePathname();
	const workspaceUrl = useWorkspaceUrl();

	const root = workspaceUrl(ROOT);
	const items = useMemo(
		() => ITEMS.map((item) => ({ ...item, href: workspaceUrl(item.href) })),
		[workspaceUrl],
	);

	return (
		<nav
			aria-label="Materials"
			className="flex gap-1 overflow-x-auto border-b pb-3"
		>
			{items.map((item) => (
				<Button
					key={item.href}
					asChild
					variant="ghost"
					size="sm"
					className={cn(
						"shrink-0 font-normal text-muted-foreground",
						isActive(item.href, root, pathname) &&
							"bg-muted text-foreground hover:bg-muted hover:text-foreground",
					)}
				>
					<Link
						href={item.href}
						prefetch
						aria-current={
							isActive(item.href, root, pathname) ? "page" : undefined
						}
					>
						{item.title}
					</Link>
				</Button>
			))}
		</nav>
	);
}
