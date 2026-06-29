# Blockwise infrastructure

Mirrors the `tallio` setup. One CloudFront distribution fronts a static S3 bucket
(frontend) and the API Lambda function URL (`/api/*`). A separate worker Lambda runs
the ILP solver asynchronously.

```
CloudFront ── /*      → S3  (uk.bauk.blockwise, /public)
           └─ /api/*  → blockwise-backend Lambda (FastAPI/Mangum, function URL, IAM-signed)
                              │  invokes (async)
                              ▼
                        blockwise-solver Lambda (HiGHS ILP, 15-min timeout)
DynamoDB (blockwise-*)  ·  SES (blockwise.bauk.uk)  ·  Route53 (A + DKIM/SPF/DMARC)
```

## Prerequisites

- AWS profile `bauk-blockwise-admin` configured locally.
- Shared tfstate bucket `uk.bauk.tfstate` (already used by tallio).
- Route53 hosted zone for `blockwise.bauk.uk` (referenced as a data source).
- Docker running (Lambda deps are built in a manylinux container for native wheels:
  highspy, pydantic-core, bcrypt, cryptography).

## Deploy

```bash
# 1. Build the frontend (terraform uploads frontend/dist)
make build            # from repo root

# 2. Apply
cd terraform
terraform init
terraform apply
```

Optional Google sign-in:

```bash
terraform apply \
  -var="google_client_id=..." \
  -var="google_client_secret=..."
```

## Notes

- `SECRET_KEY` is a generated `random_password` shared by both Lambdas (so JWTs and
  timed tokens verify across them).
- The API Lambda passes `SOLVER_FUNCTION_NAME` so `/process` offloads to the worker;
  locally that env is unset and solves run inline.
- Tables auto-create on the API Lambda's cold start (`create_tables()`), or hit
  `/api/admin/create-tables` once if `ADMIN_ENDPOINTS_ENABLED=true`.
- ACM cert lives in `us-east-1` (CloudFront requirement) and is DNS-validated via
  Route53 before the distribution is created.
