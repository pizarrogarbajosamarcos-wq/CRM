import type { AuthedTrpcContext } from "../trpc/context.types";
import type { AssetActor } from "./asset-actor";
import { AssetError } from "./asset-error";

export function assetUser(ctx: AuthedTrpcContext): AssetActor {
	return { type: "USER", userId: ctx.user.id };
}

export function idempotencyKey(ctx: AuthedTrpcContext): string {
	const key = optionalIdempotencyKey(ctx);
	if (!key) {
		throw new AssetError(
			400,
			"VALIDATION_ERROR",
			"A valid Idempotency-Key header is required.",
		);
	}
	return key;
}

export function optionalIdempotencyKey(
	ctx: AuthedTrpcContext,
): string | undefined {
	const key = ctx.req?.header("Idempotency-Key");
	if (key === undefined || key === "") return undefined;
	if (!/^[\x20-\x7e]{1,128}$/.test(key)) {
		throw new AssetError(
			400,
			"VALIDATION_ERROR",
			"A valid Idempotency-Key header is required.",
		);
	}
	return key;
}
