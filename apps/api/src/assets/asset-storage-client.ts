import { S3Client } from "@aws-sdk/client-s3";
import { ConfigService } from "@nestjs/config";
import type { EnvironmentVariables } from "../config/env.validation";
import { ASSETS } from "./asset-config";
import { AssetError } from "./asset-error";

export type R2Config = {
	accountId?: string;
	accessKeyId?: string;
	secretAccessKey?: string;
	bucket?: string;
};

export function readR2Config(
	config?: ConfigService<EnvironmentVariables, false>,
): R2Config {
	return {
		accountId: readConfigValue(config, "R2_ACCOUNT_ID"),
		accessKeyId: readConfigValue(config, "R2_ACCESS_KEY_ID"),
		secretAccessKey: readConfigValue(config, "R2_SECRET_ACCESS_KEY"),
		bucket: readConfigValue(config, "R2_BUCKET"),
	};
}

export function isR2Configured(r2: R2Config): boolean {
	return Boolean(
		r2.accountId && r2.accessKeyId && r2.secretAccessKey && r2.bucket,
	);
}

export function createR2Client(r2: R2Config): S3Client | null {
	if (!isR2Configured(r2)) return null;

	return new S3Client({
		region: "auto",
		endpoint: `https://${r2.accountId}.r2.cloudflarestorage.com`,
		forcePathStyle: true,
		credentials: {
			accessKeyId: r2.accessKeyId as string,
			secretAccessKey: r2.secretAccessKey as string,
		},
		maxAttempts: 1,
		requestChecksumCalculation: "WHEN_REQUIRED",
		responseChecksumValidation: "WHEN_REQUIRED",
		requestHandler: {
			connectionTimeout: ASSETS.network.connectionTimeoutMs,
			requestTimeout: ASSETS.network.requestTimeoutMs,
			throwOnRequestTimeout: true,
		},
	});
}

export function requireStorageClient(
	client: S3Client | null,
	configured: boolean,
): S3Client {
	if (!configured || !client) {
		throw new AssetError(
			503,
			"STORAGE_UNAVAILABLE",
			"Object storage is not configured.",
			undefined,
			false,
		);
	}

	return client;
}

export function requireBucketName(bucket: string): void {
	if (!bucket.trim()) {
		throw new AssetError(
			400,
			"VALIDATION_ERROR",
			"A storage bucket is required.",
			undefined,
			false,
		);
	}
}

function readConfigValue(
	config: ConfigService<EnvironmentVariables, false> | undefined,
	key: keyof Pick<
		EnvironmentVariables,
		"R2_ACCOUNT_ID" | "R2_ACCESS_KEY_ID" | "R2_SECRET_ACCESS_KEY" | "R2_BUCKET"
	>,
): string | undefined {
	const configured = config?.get<string>(key);
	const value = configured ?? process.env[key];
	const normalized = value?.trim();
	return normalized || undefined;
}
