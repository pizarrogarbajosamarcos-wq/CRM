import { z } from "zod";

export const localCampaignSchema = z
	.object({
		campaign_id: z.string().trim().min(1),
		project: z.string().trim().min(1),
		target_customer_type: z.string().trim().min(1),
		geography: z.array(z.string().trim().min(1)),
		event_window: z
			.object({ start: z.string().date(), end: z.string().date() })
			.strict()
			.optional(),
		source_types: z.array(z.enum(["seed_url", "manual_list", "search"])),
		seed_urls: z.array(z.string().trim().url()),
		keywords: z.array(z.string().trim().min(1)),
		exclusions: z.array(z.string().trim().min(1)),
		max_companies: z.number().int().positive().max(10_000),
		max_pages_per_domain: z.number().int().positive().max(100),
		required_fields: z.array(z.string().trim().min(1)),
		scoring_rules: z
			.object({
				fit_keyword_points: z.number().int().nonnegative().max(100),
				evidence_points: z.number().int().nonnegative().max(100),
				contact_field_points: z.number().int().nonnegative().max(100),
			})
			.strict(),
	})
	.strict();

export type LocalCampaign = z.infer<typeof localCampaignSchema>;

export const localCampaignSeedSchema = z.object({
	url: z.string().trim().url(),
});
