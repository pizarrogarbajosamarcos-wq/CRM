import { z } from "zod";

export const localLeadSchema = z
	.object({
		company_name: z.string().trim().min(1).nullable(),
		website: z.string().trim().min(1).nullable(),
		contact_name: z.string().trim().min(1).nullable(),
		role: z.string().trim().min(1).nullable(),
		email: z.string().trim().email().nullable(),
		phone: z.string().trim().min(1).nullable(),
		source_url: z.string().trim().url().nullable(),
		evidence_excerpt: z.string().trim().min(1),
		confidence_reason: z.string().trim().min(1),
		missing_fields: z.array(z.string().trim().min(1)),
	})
	.strict();

export type LocalLead = z.infer<typeof localLeadSchema>;

export const LOCAL_LEAD_FIELDS = [
	"company_name",
	"website",
	"contact_name",
	"role",
	"email",
	"phone",
	"source_url",
	"evidence_excerpt",
	"confidence_reason",
	"missing_fields",
] as const;
