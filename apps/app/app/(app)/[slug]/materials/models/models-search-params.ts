import { createListSearchParams } from "@/components/data-table/list-search-params";

export const modelsSearchParams = createListSearchParams({
	defaultSort: "code",
	defaultDir: "asc",
});
