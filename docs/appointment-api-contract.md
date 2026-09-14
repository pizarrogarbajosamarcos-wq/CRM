---
title: Project appointments
status: implementation
updated: 2026-09-11
---

# Project appointments

Appointments and assets belong to the project independently.
An asset's optional `appointmentId` records the managed appointment selected by its path.
Files can arrive after appointment completion. Transfer state and appointment state are independent.

## HTTP contract

Base URL: `https://api.jobsteward.ai`.
Use the existing session, API key, or OAuth authentication.
OAuth reads require `crm.read`. Mutations require `crm.write`.
All successful responses use HTTP 200 and JSON.
AP1–AP5 POST, PATCH, and DELETE require an `Idempotency-Key` of 1 to 128 printable ASCII characters.
Retries reuse the same key and request. Distinct changes use different keys.
GET and DELETE accept no body. POST and PATCH require JSON objects.
Path identifiers cannot appear in request bodies or query parameters.
Unknown fields return `400 VALIDATION_ERROR`.
Responses include `Cache-Control: private, no-store` and `X-Request-Id`.
AP1–AP5 errors use the [asset error envelope](./asset-api-contract.md#errors).
AP6 and AP7 errors keep `{ code, message }` at the top level.

| ID | Method | Path | Response |
| --- | --- | --- | --- |
| AP1 | POST | `/projects/{projectId}/appointments` | `{"appointment": <Appointment>}` |
| AP2 | GET | `/projects/{projectId}/appointments` | Paginated appointment list |
| AP3 | GET | `/projects/{projectId}/appointments/{appointmentId}` | `{"appointment": <Appointment>}` |
| AP4 | PATCH | `/projects/{projectId}/appointments/{appointmentId}` | Updated or restored appointment |
| AP5 | DELETE | `/projects/{projectId}/appointments/{appointmentId}` | `{"appointmentId": "...", "archivedAt": "...", "version": 2}` |
| AP6 | POST | `/appointments/{appointmentId}/recordings/upload-url` | Flat upload slot |
| AP7 | POST | `/appointments/{appointmentId}/recordings/complete` | `{"ok": true}` |

Public appointment paths have no bridge prefix, version segment, or version header.
Runtime OpenAPI at `/openapi.json` describes these canonical paths and the other root REST paths.
It exposes no asset or appointment compatibility HTTP aliases.

AP1–AP5 require an `Idempotency-Key` on POST, PATCH, and DELETE.
AP6 and AP7 do not require that header. JobSteward never sends it.
When present, the API uses it. Otherwise the service derives a key for replay.

## Appointment fields

| Field | Rule |
| --- | --- |
| `id` | Server-generated `Activity.id`. |
| `projectId` | Immutable path project, stored as `Activity.dealId`. |
| `customerId` | Derived from the project's company. |
| `title` | Trimmed text, 1 to 255 characters. Required on create. |
| `notes` | Optional text, maximum 20,000 characters. Null clears it. |
| `startsAt` | Required timestamp with an explicit UTC offset. Stored in UTC. |
| `endsAt` | Optional timestamp after the start. Null clears it. |
| `timeZone` | Required IANA time zone. |
| `location` | Optional text, maximum 1,000 characters. Null clears it. |
| `ownerId` | Organization member. Defaults to the project owner. |
| `status` | SCHEDULED, COMPLETED, or CANCELED. Defaults to SCHEDULED. |
| `statusChangedAt` | Server time of the last status change. |
| `version` | Positive integer, initially 1. Each change increments it. |
| `archivedAt` | Server archive time, or null. |
| `createdById`, `createdAt`, `updatedAt` | Server-managed audit fields. |

Responses include every field. Optional nullable fields appear as null.
Create accepts SCHEDULED or COMPLETED, not CANCELED.
COMPLETED always requires `startsAt` at or before server time.
Creation, completion, and date corrections enforce that invariant.

```json
{
  "title": "Kitchen site visit",
  "startsAt": "2026-09-15T15:00:00Z",
  "endsAt": "2026-09-15T16:00:00Z",
  "timeZone": "America/Chicago",
  "notes": "Review cabinet measurements."
}
```

## Queries and updates

AP2 accepts `page`, `pageSize`, `status`, `ownerId`, `from`, `to`, and `archived`.
Page defaults to 1. Page size defaults to 25, with a maximum of 100.
`archived=false` is the default. `archived=true` selects archived appointments only.
Date filters select `startsAt`, inclusive `from` and exclusive `to`.
A supplied `to` must follow `from`.
Sort by `startsAt ASC, id ASC`. Pagination is live, not a snapshot.
Return `{"items": [], "page": 1, "pageSize": 25, "total": 0, "hasNextPage": false}`.
AP3 also returns archived appointment metadata while its project exists.

AP4 requires numeric `expectedVersion` and at least one writable field.
Omitted fields stay unchanged. Validate dates against the combined stored and supplied values.
A stale version returns `409 VERSION_CONFLICT`.
Read the current record before submitting a correction with a new key.

| Current state | Allowed next state |
| --- | --- |
| SCHEDULED | COMPLETED or CANCELED |
| COMPLETED | SCHEDULED |
| CANCELED | SCHEDULED |
| Any active state | Same state |

Other transitions return `409 INVALID_APPOINTMENT_STATE`.
Completion sets the activity occurrence time to `startsAt`.
Reopening clears it. Correcting a completed start updates it.
Scheduled and canceled appointments sort after dated timeline entries using existing null-last ordering.
Neither a past end time nor file upload completes an appointment automatically.

## Archive, restore, and file retention

AP5 archives the current appointment under the project transaction lock.
It has no `expectedVersion` input. Repeated archive returns the existing timestamp and version.
Archive preserves the meeting row, project files, and optional file references.
Restore through AP4 with only `expectedVersion` and `archived: false`.
Reject `archived: true` and restore combined with ordinary edits using `400 VALIDATION_ERROR`.
Other edits to archived appointments return `409 APPOINTMENT_ARCHIVED`.
Restore preserves status and file references.

New assets through `/appointments/{appointmentId}/assets` reject archived managed appointments.
Previously accepted transfers can complete after appointment archive while the project remains active.
Files remain available through the project asset routes, including the archived appointment asset list.
Archived projects allow appointment reads and archive, but reject create, edit, and restore with `409 PROJECT_ARCHIVED`.
Permanent project purge uses existing file cleanup before related database rows disappear.
Appointment archive does not start a new retention job.

Timeline results and counts use the same active/archive filter.
Dashboard recent activity excludes archived appointments.
Archive and restore do not recompute activity stamps or remove retained rows from usage totals.

## Identity, tenancy, and replay

An appointment is a project MEETING activity with one typed `AppointmentDetails` row.
Details use the activity ID as their primary key and carry the organization ID.
The tenant-scoped database protects details like other CRM records.
Validate the project, activity, details, and owner within the authenticated organization.
The activity has no calendar-event or direct contact link.
Calendar sync, cancellation, and disconnect do not own these appointments.
Generic calendar meetings do not appear in appointment lists.
Generic project MEETING activities are not managed appointments and cannot be used as appointment asset parents.

Reuse `AssetMutations` and its project transaction lock for appointments and asset creation.
Asset parentage comes from the route. The asset PATCH operation cannot relink an asset.
The existing `AssetApiRequest` ledger stores distinct appointment operations and logical project paths.
Authentication and access checks run before replay. Successful replay runs before stale-version checks.
The same key with a different request returns `409 IDEMPOTENCY_CONFLICT`.
The replay window remains 24 hours.
A missing or inaccessible appointment path returns 404 before asset creation or replay.
Archive alone does not invalidate a saved successful response.

## Client workflow and verification boundary

The deal record sheet contains the Project workspace.
It supports appointment filters and lifecycle controls, project files, per-file uploads, metadata edits, and file deletion.
Upload progress distinguishes transfer from verification. PUT success is not READY.
The client retains request keys and asset IDs during the workspace session for retry and reconciliation.
Storage requests use only the returned transfer headers, without CRM credentials.
Repeat the original asset POST with the same key to refresh an expired transfer while its intent remains valid.
Send `PATCH /assets/{assetId}` with `{ "uploadCompleted": true }` to queue verification, then poll the asset detail until `READY`.
Use the [asset contract](./asset-api-contract.md) for transfer and worker behavior.

## Mobile meeting recordings

JobSteward uses AP6 and AP7 for onsite meeting audio.
AP6 accepts `{ "contentType", "byteSize", "filename" }` and returns a flat slot:

```json
{
  "uploadUrl": "https://...",
  "method": "PUT",
  "headers": {
    "Content-Type": "audio/mp4",
    "Content-Length": "1843200"
  },
  "objectKey": "<asset.id>",
  "expiresAt": "2026-09-03T16:00:00.000Z"
}
```

`objectKey` is the artifact id. The client echoes it on AP7.
AP7 accepts `{ "objectKey", "contentType", "byteSize", "durationSeconds" }` and returns `{ "ok": true }` as soon as verification is queued.
The client does not poll A5 after End meeting.
One current `meeting_recording` with source `MOBILE_RECORDING` exists per appointment.
A pending unexpired upload refreshes the signed PUT and keeps the same `objectKey`.
Otherwise AP6 creates a new artifact and retires the previous mobile recording.
Missing, foreign, or expired complete requests return `409`.
Recording routes stay off the nested asset error wrapper. Errors keep `{ code, message }` at the top level.

Tests use disposable local PostgreSQL and storage fixtures.
Local verification does not prove production R2 configuration, browser CORS, or deployment.
No calendar invitations, transcription, summaries, or estimates are included.
