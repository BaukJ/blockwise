# Per-workspace deployment config.
#
# Each Terraform workspace deploys an independent copy of Blockwise. The default
# workspace deploys the primary site at blockwise.bauk.uk and reads no config file.
# Any other workspace "abc" reads terraform/sites/abc.yml, e.g.:
#
#   subdomain: school-x                       # → school-x.blockwise.bauk.uk
#   allowed_email_domains: ["@bauk.uk"]        # restrict sign-ups (optional)
#
# Usage:
#   terraform workspace new school-x
#   # create terraform/sites/school-x.yml
#   terraform apply
locals {
  is_default = terraform.workspace == "default"

  # Resource-name suffix so workspaces don't collide in the shared AWS account.
  suffix = local.is_default ? "" : "-${terraform.workspace}"

  zone_name = "blockwise.bauk.uk" # the Route53 hosted zone (shared by all sites)

  site_config = local.is_default ? {} : yamldecode(file("${path.module}/sites/${terraform.workspace}.yml"))

  subdomain = try(local.site_config.subdomain, "")
  my_domain = local.subdomain == "" ? local.zone_name : "${local.subdomain}.${local.zone_name}"

  bucket_name = "uk.bauk.blockwise${local.suffix}"

  # Comma-separated for the Lambda env var consumed by the backend.
  allowed_email_domains = try(join(",", local.site_config.allowed_email_domains), "")
}
