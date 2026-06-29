# Uploads the built frontend (frontend/dist) into the bucket under public/.
# Run `make build` (or `npm run build`) before `terraform apply`.
locals {
  frontend_dir   = "${path.root}/../frontend/dist"
  frontend_files = fileset(local.frontend_dir, "**")
}

resource "aws_s3_object" "frontend_files" {
  for_each = local.frontend_files
  bucket   = aws_s3_bucket.frontend.id
  key      = "public/${each.value}"
  source   = "${local.frontend_dir}/${each.value}"
  content_type = lookup(
    {
      "html"        = "text/html",
      "js"          = "application/javascript",
      "css"         = "text/css",
      "json"        = "application/json",
      "map"         = "application/json",
      "png"         = "image/png",
      "jpg"         = "image/jpeg",
      "svg"         = "image/svg+xml",
      "ico"         = "image/x-icon",
      "webmanifest" = "application/manifest+json",
      "woff2"       = "font/woff2",
    },
    split(".", each.value)[length(split(".", each.value)) - 1], "application/octet-stream"
  )
  source_hash = filemd5("${local.frontend_dir}/${each.value}")

  lifecycle {
    ignore_changes = [version_id]
  }
}
