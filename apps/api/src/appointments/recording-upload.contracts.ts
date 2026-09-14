import { z } from "zod";

const appointmentId = z.string().min(1).max(128);
const contentType = z
	.string()
	.min(1)
	.max(255)
	.regex(/^[^\p{Cc}]+$/u);
const byteSize = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const filename = z
	.string()
	.min(1)
	.max(255)
	.regex(/^[^/\\\p{Cc}]+$/u);

export const recordingUploadUrlBody = z.strictObject({
	contentType,
	byteSize,
	filename,
});
export type RecordingUploadUrlBody = z.infer<typeof recordingUploadUrlBody>;

export const recordingUploadUrlInput = recordingUploadUrlBody.extend({
	appointmentId,
});

export const recordingUploadSlotSchema = z.object({
	uploadUrl: z.url(),
	method: z.literal("PUT"),
	headers: z.object({
		"Content-Type": z.string(),
		"Content-Length": z.string(),
	}),
	objectKey: z.string().min(1).max(128),
	expiresAt: z.iso.datetime(),
});
export type RecordingUploadSlot = z.infer<typeof recordingUploadSlotSchema>;

export const recordingCompleteBody = z.strictObject({
	objectKey: z.string().min(1).max(128),
	contentType,
	byteSize,
	durationSeconds: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});
export type RecordingCompleteBody = z.infer<typeof recordingCompleteBody>;

export const recordingCompleteInput = recordingCompleteBody.extend({
	appointmentId,
});

export const recordingCompleteSchema = z.object({
	ok: z.literal(true),
});
