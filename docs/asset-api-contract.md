---
title: Project and appointment asset API
status: implemented-pending-r2-verification
updated: 2026-09-11
---

# Project and appointment asset API

This contract describes the seven implemented asset operations. Production R2 configuration and live R2 checks remain release requirements. See [storage operations](./assets-storage-operations.md) for those checks.

An asset belongs to exactly one project. An asset can reference one managed appointment in that project. The path supplies the parent. The request body cannot change parentage.

The public API has no upload ID workflow, customer-wide asset list, upload confirmation route, URL renewal route, cancellation route, or asset download route. `AssetUpload` and `AssetStorageJob` remain internal storage records.

Mobile meeting audio from JobSteward uses the appointment recordings routes in [appointment-api-contract.md](./appointment-api-contract.md), not A1–A7.
Those routes accept AAC-LC in an MPEG-4 container (`.m4a`) with `contentType` `audio/mp4`.
A1–A7 remain the CRM workspace file API. Polling A5 is not part of End meeting.

## Common contract

Base URL: `https://api.jobsteward.ai`. All paths below are relative to this base. All asset requests and responses use JSON except the direct R2 `PUT` transfer.

Use the existing session, API key, or OAuth authentication. OAuth reads require `crm.read`. OAuth mutations require `crm.write`. Missing or inaccessible records return `404 RESOURCE_NOT_FOUND`.

All successful REST responses use `200 OK`. Asset responses include `Cache-Control: private, no-store` and `X-Request-Id`. The caller can supply a valid `X-Request-Id`; the API generates one when absent or invalid.

Public paths have no bridge prefix, version segment, or version header. The runtime OpenAPI document describes these canonical paths. It exposes no asset compatibility aliases.

Path identifiers are the only parent and resource identifiers. Do not send `projectId`, `appointmentId`, `assetId`, `customerId`, or upload IDs in a request body or query string. GET and DELETE accept no body. POST and PATCH require a JSON object. Mutations accept no query parameters. Unknown fields return `400 VALIDATION_ERROR`.

POST, PATCH, and DELETE require an `Idempotency-Key` with 1 to 128 printable ASCII characters. GET does not require the header.

## Endpoints

| ID | Method | Path | Purpose |
| --- | --- | --- | --- |
| A1 | POST | `/projects/{projectId}/assets` | Create a project asset and receive a direct transfer. |
| A2 | GET | `/projects/{projectId}/assets` | List assets for one project. |
| A3 | POST | `/appointments/{appointmentId}/assets` | Create an asset for one managed appointment. |
| A4 | GET | `/appointments/{appointmentId}/assets` | List assets for one managed appointment. |
| A5 | GET | `/assets/{assetId}` | Read asset metadata and a temporary download when ready. |
| A6 | PATCH | `/assets/{assetId}` | Start verification or update file metadata. |
| A7 | DELETE | `/assets/{assetId}` | Start durable asset deletion. |

## A1 and A3: Create an asset

The project route takes its required project from `{projectId}`. The appointment route resolves the appointment's project and requires a managed `MEETING` activity with `AppointmentDetails`. The appointment and project must match.

Both routes accept the same JSON metadata:

```json
{
  "fileName": "kitchen-visit.mp3",
  "contentType": "audio/mpeg",
  "sizeBytes": 57600000,
  "kind": "meeting_recording",
  "source": "MOBILE_RECORDING",
  "durationMilliseconds": 3600000,
  "capturedAt": "2026-07-15T15:00:00Z"
}
```

| Field | Rule |
| --- | --- |
| `fileName` | Required string, 1 to 255 characters. Path separators and control characters are rejected. |
| `contentType` | Optional string, 1 to 255 characters. Defaults to `application/octet-stream`. Control characters are rejected. |
| `sizeBytes` | Required nonnegative integer. The single PUT limit is `5363466240` bytes. |
| `kind` | Optional string, 1 to 64 characters. Defaults to `file`. |
| `source` | Required: `MANUAL`, `MOBILE_RECORDING`, or `EMAIL_ATTACHMENT`. |
| `durationMilliseconds` | Optional nonnegative integer or null. |
| `capturedAt` | Optional RFC 3339 timestamp with an offset or null. |
| `emailSource` | Required only for `EMAIL_ATTACHMENT`. A strict object with nonempty `messageId` and `attachmentId`, each at most 255 characters. |

The body has no `activityId`. Use the appointment path to associate an asset with a managed appointment. The body cannot set the customer, project, appointment, uploader, storage bucket, storage key, or URL.

Any file format is accepted. No filename extension, media type, or recording duration allowlist applies. A size above the limit returns `413 UPLOAD_TOO_LARGE` before a new asset is created.

The API derives `customerId` from the project's company. It creates the asset with status `UNVERIFIED`, creates internal upload state, and returns:

```json
{
  "asset": {
    "id": "artifact_123",
    "customerId": "company_alice",
    "projectId": "project_bathroom_2026",
    "appointmentId": null,
    "fileName": "kitchen-visit.mp3",
    "contentType": "audio/mpeg",
    "sizeBytes": 57600000,
    "kind": "meeting_recording",
    "source": "MOBILE_RECORDING",
    "emailSource": null,
    "uploadedById": "user_gc",
    "durationMilliseconds": 3600000,
    "capturedAt": "2026-07-15T15:00:00.000Z",
    "createdAt": "2026-09-11T15:03:00.000Z",
    "updatedAt": "2026-09-11T15:03:00.000Z",
    "version": 1,
    "status": "UNVERIFIED",
    "deletedAt": null
  },
  "download": null,
  "failure": null,
  "transfer": {
    "method": "PUT",
    "url": "https://example.r2.cloudflarestorage.com/private/temporary-object?signature=example",
    "headers": {
      "Content-Type": "audio/mpeg",
      "Content-Length": "57600000"
    },
    "expiresAt": "2026-09-11T15:18:00.000Z",
    "maxBytes": 5363466240
  }
}
```

For a new asset, `download` and `failure` are null. `transfer` contains the R2 upload authorization. On replay or source deduplication, `transfer` is null when the asset has no pending, unexpired transfer.

Send the original bytes to the returned URL. Send every returned transfer header. Do not send CRM credentials to R2. The API does not receive the file bytes.

The transfer URL expires after 15 minutes or at the internal 24-hour upload-intent deadline, whichever comes first. The URL lifetime does not define how long R2 permits an already started transfer.

## A2 and A4: List assets

The project route lists all visible assets for the project. The appointment route lists only assets whose appointment parent is the path appointment. A project list includes assets linked to appointments.

Supported query parameters are `page`, `pageSize`, `kind`, and `source`.

| Parameter | Rule |
| --- | --- |
| `page` | Integer, minimum 1. Defaults to 1. |
| `pageSize` | Integer, 1 to 100. Defaults to 25. |
| `kind` | Optional exact kind filter. |
| `source` | Optional exact source filter. |

Return:

```json
{
  "items": [],
  "page": 1,
  "pageSize": 25,
  "total": 0,
  "hasNextPage": false
}
```

Sort by `createdAt DESC, id DESC`. Lists include `READY` and `UNVERIFIED` assets. They exclude `DELETING` and `DELETED` assets. Unknown query parameters return `400 VALIDATION_ERROR`.

Reads can inspect retained assets for archived projects or appointments while their rows exist. New asset creation requires an active project. New assets for an appointment also require an active managed appointment.

## A5: Read asset detail

Return `{"asset": <Asset>, "download": <Download-or-null>, "failure": <Failure-or-null>}`.

The asset response contains:

| Field | Rule |
| --- | --- |
| `id` | Server-generated asset ID. |
| `customerId` | Derived from the asset's project company. |
| `projectId` | Immutable project parent. |
| `appointmentId` | Managed appointment parent or null. Immutable through this API. |
| `fileName` | Display name. |
| `contentType` | Stored metadata. |
| `sizeBytes` | Expected or verified byte count, or null for an unresolved existing row. |
| `kind` | Descriptive metadata. |
| `source` | Source enum, or null for an unresolved existing row. |
| `emailSource` | Source message and attachment identity, or null. |
| `uploadedById` | User ID, or null for system and unknown historical attribution. |
| `durationMilliseconds` | Duration or null. |
| `capturedAt` | Capture timestamp or null. |
| `createdAt`, `updatedAt` | Server timestamps. |
| `version` | Positive metadata version. New and existing rows start at 1. |
| `status` | `UNVERIFIED`, `READY`, `DELETING`, or `DELETED`. |
| `deletedAt` | Physical deletion timestamp, or null. |

`download` is null unless the asset is `READY`, has a verified size and storage bucket, and storage is configured. When available, it is an object with a temporary signed GET `url` and `expiresAt`. The URL expires after 15 minutes. There is no separate download route.

`failure` is null unless an `UNVERIFIED` asset has an expired or failed internal upload. Its code is `UPLOAD_EXPIRED`, `UPLOAD_VERIFICATION_FAILED`, or `UPLOAD_FINALIZATION_FAILED`. The API does not expose internal upload IDs, object keys, provider payloads, credentials, or stack traces.

## A6: Update an asset

The PATCH body is strict. It accepts `fileName`, `kind`, `expectedVersion`, and `uploadCompleted: true`.

Metadata edits require a positive numeric `expectedVersion` and at least one of `fileName` or `kind`. They update only the supplied metadata fields, increment `version` once, and update `updatedAt`. They do not change project or appointment parentage, source metadata, bytes, storage keys, status, or upload history.

`uploadCompleted: true` can be sent alone. It marks the internal upload for verification and enqueues durable worker work. The response is immediate. The asset remains `UNVERIFIED` until the worker verifies the object. Completion and verification do not change the metadata `version`. The client polls A5 for `READY` or a failure.

A PATCH can combine `uploadCompleted: true` with `fileName` or `kind`. In that case, `expectedVersion` is required. The completion request and metadata edit use one transaction. Metadata version increases once. Completion alone cannot include `expectedVersion`.

Only `READY` and `UNVERIFIED` assets accept metadata edits. `DELETING` and `DELETED` assets return `409 ASSET_NOT_READY`. A stale `expectedVersion` returns `409 VERSION_CONFLICT`. A successful request replay runs before the stale-version check for the same actor, path, operation, key, and request body.

The worker reads the temporary object, verifies its byte count and ETag, conditionally copies it to the final key, verifies the final object, and changes the asset from `UNVERIFIED` to `READY`. R2 and PostgreSQL do not share a transaction, so the worker reconciles durable state after timeouts.

## A7: Delete an asset

DELETE accepts no body and returns `{"assetId": "artifact_123", "status": "DELETING"}` after the deletion work is durably recorded. It changes the asset to `DELETING`, hides it from lists, and removes download access from A5.

The deletion worker removes the stored object and then changes the asset to `DELETED` with `deletedAt`. A repeated delete does not create duplicate work. The same idempotency key returns its recorded response. Read A5 for the current deletion state. A storage failure keeps the asset `DELETING` until a later worker retry succeeds.

Asset status has only these transitions:

```text
UNVERIFIED -> READY
UNVERIFIED -> DELETING -> DELETED
READY      -> DELETING -> DELETED
```

## Transfer retries and idempotency

The original POST request is the transfer retry operation. Repeat the same POST path, exact JSON body, and `Idempotency-Key` to receive the same asset and a refreshed transfer while the internal upload remains pending. No renewal endpoint exists.

The replay record is retained for 24 hours. A replayed POST does not create another asset. A different request on the same operation and path with the same key returns `409 IDEMPOTENCY_CONFLICT`. Use a new key for a distinct asset or a distinct PATCH or DELETE action.

The same source email attachment is deduplicated through an internal source identity. A matching source can return an existing asset with `transfer: null` when it is already finalizing or ready. A different project or metadata hash returns `409 PROJECT_MISMATCH` or `409 SOURCE_CONFLICT`.

Direct R2 transfer retries use only the transfer URL and headers. If the URL expires before the intent deadline, repeat the original POST with the same key. If the intent expires, create a replacement asset with a new key.

## Errors

Asset errors use this envelope:

```json
{
  "error": {
    "code": "UPLOAD_TOO_LARGE",
    "message": "The file exceeds the single-upload limit.",
    "requestId": "request_123",
    "retryable": false,
    "details": { "maxBytes": 5363466240 }
  }
}
```

`details` is optional. Validation details use `fields`, an array of field and message objects. Error responses do not include provider payloads, private email data, object keys, credentials, or stack traces.

| HTTP | Code | Meaning |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Invalid JSON shape, unknown field, body identifier, query parameter, or idempotency header. |
| 401 | `AUTH_REQUIRED` | Authentication is missing or invalid. |
| 403 | `FORBIDDEN` | The caller lacks access or the required OAuth scope. |
| 404 | `RESOURCE_NOT_FOUND` | The resource is absent or inaccessible. |
| 409 | `IDEMPOTENCY_CONFLICT` | A key is reused with a different request. |
| 409 | `PROJECT_MISMATCH` | An appointment, email source, or asset parent does not match the project. |
| 409 | `SOURCE_CONFLICT` or `SOURCE_DELETED` | An email source conflicts with prior metadata or was deleted. |
| 409 | `ASSET_NOT_READY` | Completion or metadata editing is unavailable in the current asset state. |
| 409 | `PROJECT_ARCHIVED` | Restore the project before creating an asset or completing its upload. |
| 409 | `APPOINTMENT_ARCHIVED` | Restore the managed appointment before creating an appointment asset. |
| 409 | `VERSION_CONFLICT` | The supplied metadata version is stale. |
| 413 | `UPLOAD_TOO_LARGE` | `sizeBytes` exceeds `5363466240`. `details.maxBytes` is included. |
| 429 | `UPLOAD_CAPACITY_EXCEEDED` | The actor has 20 retained temporary-upload reservations. `Retry-After: 60` is included. |
| 503 | `STORAGE_UNAVAILABLE` | R2 is unconfigured or a storage request failed. |
| 500 | `INTERNAL_ERROR` | The backend failed. Reconcile asset state before retrying. |

`retryable` is true for capacity errors and transient storage errors. Missing storage configuration is not retryable until configuration changes. Direct R2 responses use R2's response format.

## Durable storage internals

`AssetUpload` stores the internal pending transfer, expected metadata, temporary key, final key, intent deadline, transfer grant deadline, source ETag, and internal lifecycle status. It has no public REST route.

`AssetStorageJob` stores durable `FINALIZE_UPLOAD` and `DELETE_OBJECT` work. The worker claims bounded jobs with leases, retries storage failures with exponential backoff from five seconds up to one hour, and processes at most five finalization attempts within 24 hours. Deletion jobs keep retrying until storage confirms removal and reconcile completed deletion records hourly.

`AssetApiRequest` stores idempotency responses for 24 hours. `AssetEmailSource` stores attachment-level source identity and project binding. These records remain internal and do not change the seven public operations.

`GET /internal/assets/process` uses `CRON_SECRET` and processes bounded storage work. It is an internal scheduler route, not an asset client workflow.

The API creates temporary keys under `temporary/{organizationId}/projects/{projectId}/{uploadId}` and final keys under `{organizationId}/projects/{projectId}/assets/{objectId}`. The client receives only signed transfer URLs. See [storage operations](./assets-storage-operations.md) for bucket, lifecycle, CORS, and release checks.
