# Uploads and privacy rollout

S3 is the production storage provider. The S3 adapter is implemented; bucket and
region values remain placeholders until infrastructure is ready. A private local
adapter is available for development. Production never falls back to disk if S3
configuration, credentials, or requests fail. Complete a live smoke test before deployment.
The AWS SDK requires Node 20 or newer; Docker and CI use Node 22.

## S3 configuration

Set these on the backend (placeholders are in `.env.example`):

```dotenv
FILE_STORAGE_PROVIDER=s3
S3_BUCKET_NAME=your_private_uploads_bucket
AWS_REGION=your_aws_region
```

Replace both placeholder values. Use the SDK's default credential chain: a workload
IAM role in production, or an AWS profile / private `AWS_ACCESS_KEY_ID`,
`AWS_SECRET_ACCESS_KEY` and optional `AWS_SESSION_TOKEN` variables locally. Never
place credentials in frontend code or commit them. In production S3 is the default
provider when `FILE_STORAGE_PROVIDER` is omitted; missing bucket/region returns 503.

Configure the bucket with Block Public Access enabled and bucket-owner-enforced
ownership. Both avatars and résumés remain private S3 objects; avatars are publicly
served through the API's image route. Bucket encryption can use the bucket's default
settings. No object ACL or public URL is created by the adapter. The backend IAM
role needs `s3:PutObject`, `s3:GetObject`, and `s3:DeleteObject` on only
`arn:aws:s3:::<bucket>/avatars/*` and `arn:aws:s3:::<bucket>/resumes/*`. S3 can return
403 for missing objects without ListBucket permission; this is reported as storage
unavailable rather than incorrectly treating every permission error as a missing file.
If using customer-managed KMS encryption, grant the corresponding KMS permissions.
Since the browser talks to the backend, bucket CORS is not needed for this flow.
Configure noncurrent-version retention if bucket versioning is enabled: cleanup
DeleteObject calls create delete markers rather than removing old versions.

## Storage contract

`src/files/storage/fileStorage.ts` defines `put`, `read`, and `remove`. Database
fields hold opaque keys such as `resumes/<random-uuid>.pdf`, never public URLs.
`s3FileStorage.ts` implements this contract using the AWS SDK v3.
Résumé objects must be private. The API authorizes the caller before reading their
bytes and sends them as an attachment; no public résumé URL is exposed.

For development, new files go to `private-uploads/` (override with
`PRIVATE_UPLOADS_DIR`). `FILE_STORAGE_PROVIDER=local` is permitted only outside
production. Use `FILE_STORAGE_PROVIDER=s3` to test against the development bucket. Existing `uploads/resumes/...`
and `uploads/avatars/...` relative keys can be read through the adapter's restricted
legacy fallback. Absolute filesystem paths and remote résumé URLs are rejected.

Avatars accept JPEG, PNG, and WebP; résumés accept PDF. Content detection uses file
signatures rather than the supplied MIME or filename. This is not a malware scan
or full document sanitization. PDFs are served with fixed MIME, attachment
Content-Disposition, no-sniff, no-store and a sandbox CSP. Avatar responses are
limited to detected image content. SVG and HTML uploads are rejected.

## Frontend changes

- Keep sending `resume` as a multipart file to `PATCH /onboarding/talent`, and
  `avatar` as a multipart file to `PATCH /users/me`. Maximum file size is 2 MiB.
  Never send `resume_path` or an avatar URL/path as a text field.
- Public talent lists and top talents no longer include email or `resume_path`.
  The formatter also omits these fields from saved and recommended talent results.
- The owner's profile and authenticated talent detail return
  `resume_download_url` instead of `resume_path`. It points to
  `GET /api/v1/talents/:id/resume` and requires authentication.
- Download using fetch/Axios with the normal access token and credentials enabled;
  convert the response to a Blob and trigger a download. A plain anchor cannot
  attach an Authorization header. Respect non-200 JSON errors before reading a Blob.
- Owners can download their own résumé. Authenticated recruiters can download
  résumés of completed, approved talent profiles. Other talents and anonymous
  callers cannot. Admin access is not added implicitly.
- Use the returned avatar URL. New and legacy local avatar keys resolve through
  `/api/v1/assets/avatars/:filename`; old `/uploads/...` URLs no longer work.
- Invalid file contents return 400, oversized uploads 413, and schema errors 422.

## Deployment and data cleanup

1. Provision/configure the private S3 bucket and IAM role, replace the bucket/region
   placeholders, and verify access. Keep development and production credentials separate.
2. Inventory existing database file references. Migrate file bytes into the provider
   with normalized keys, including any custom absolute paths or `UPLOADS_DIR`
   locations; update references transactionally and verify downloads.
3. Remove any reverse-proxy/CDN static mapping for `/uploads`, invalidate cached
   résumé objects, and disable public access to any existing cloud résumé objects.
   Removing Express static serving does not revoke independently hosted copies.
4. Coordinate the frontend changes before deploying. No new database migration is
   needed because the existing string columns hold storage keys.
5. The committed résumé is untracked and retained locally. Git and Docker ignore
   both upload directories. Its contents still exist in older Git commits; coordinate
   a separate repository-history cleanup and collaborator resync.

New files are persisted only after request validation. Failed database updates
remove the new object; committed files are retained if a later response/token step
fails. Superseded avatars are retained for now; provider retention and orphan cleanup
should be configured when the bucket is provisioned.

## Verification

```sh
yarn tsc --noEmit
yarn jest --runInBand --coverage=false --testPathPattern 'src/__tests__/files|src/__tests__/users|src/__tests__/onboarding/onboarding.controller|src/__tests__/utils/resolveAssetUrl'
```

The HTTP tests exercise anonymous/owner/recruiter access, approval checks, UUID
validation, traversal rejection, content spoofing and size limits. Live S3
connectivity, legacy-data migration and frontend Blob downloads need a staging smoke
test once the bucket is provisioned.

Validation on this branch: TypeScript and all 43 targeted tests pass. The full
suite has eight failing suites, all also failing on the clean branch baseline
(which has nine failing suites); no new failing suites were introduced.
