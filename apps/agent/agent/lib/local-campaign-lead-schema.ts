import { z } from "zod";

export const localCampaignLeadSchema = z
	.object({
		company_name: z.string().trim().min(1).nullable(),
		website: z.string().trim().url().nullable(),
		contact_name: z.string().trim().min(1).nullable(),
		role: z.string().trim().min(1).nullable(),
		email: z.string().trim().email().nullable(),
		phone: z.string().trim().min(1).nullable(),
		location: z.string().trim().min(1).nullable(),
		source_url: z.string().trim().url(),
		evidence_excerpt: z.string().trim().min(1).max(2_000),
		project_fit_reason: z.string().trim().min(1).max(1_000),
		missing_fields: z.array(z.string().trim().min(1)),
	})
	.strict();

export type LocalCampaignLead = z.infer<typeof localCampaignLeadSchema>;

export const LOCAL_CAMPAIGN_SCALAR_FIELDS = [
	"company_name",
	"website",
	"contact_name",
	"role",
	"email",
	"phone",
	"location",
] as const;
