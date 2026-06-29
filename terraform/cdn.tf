resource "aws_s3_bucket" "frontend" {
  bucket = "uk.bauk.blockwise"
}

# https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html
data "aws_iam_policy_document" "origin_bucket_policy" {
  statement {
    sid    = "AllowCloudFrontServicePrincipalRead"
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.frontend.arn}/public/*"]

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.cdn.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "frontend" {
  bucket = aws_s3_bucket.frontend.bucket
  policy = data.aws_iam_policy_document.origin_bucket_policy.json
}

locals {
  s3_origin_id = "myS3Origin"
  my_domain    = "blockwise.bauk.uk"
}

resource "aws_acm_certificate" "blockwise" {
  domain_name       = local.my_domain
  validation_method = "DNS"
  region            = "us-east-1" # CloudFront requires us-east-1 certs

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.blockwise.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      type   = dvo.resource_record_type
      record = dvo.resource_record_value
    }
  }
  zone_id         = data.aws_route53_zone.blockwise_zone.zone_id
  name            = each.value.name
  type            = each.value.type
  ttl             = 300
  records         = [each.value.record]
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "blockwise" {
  region                  = "us-east-1"
  certificate_arn         = aws_acm_certificate.blockwise.arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}

resource "aws_cloudfront_origin_access_control" "default" {
  name                              = "blockwise-default-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_origin_access_control" "lambda" {
  name                              = "blockwise-lambda-oac"
  origin_access_control_origin_type = "lambda"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "cdn" {
  origin {
    domain_name              = aws_s3_bucket.frontend.bucket_regional_domain_name
    origin_path              = "/public"
    origin_access_control_id = aws_cloudfront_origin_access_control.default.id
    origin_id                = local.s3_origin_id
  }
  origin {
    connection_attempts      = 2
    connection_timeout       = 10
    domain_name              = local.backend_lambda_function_domain
    origin_id                = "blockwise backend"
    origin_access_control_id = aws_cloudfront_origin_access_control.lambda.id

    custom_origin_config {
      http_port                = 80
      https_port               = 443
      origin_keepalive_timeout = 5
      origin_protocol_policy   = "https-only"
      origin_read_timeout      = 30
      origin_ssl_protocols     = ["TLSv1.2"]
    }
  }

  enabled             = true
  is_ipv6_enabled     = true
  comment             = "CDN for blockwise frontend and backend"
  default_root_object = "index.html"
  aliases             = [local.my_domain]

  # Single-page app: client-side routes return index.html instead of an error.
  dynamic "custom_error_response" {
    for_each = [403, 404]
    content {
      error_code         = custom_error_response.value
      response_code      = 200
      response_page_path = "/index.html"
    }
  }

  default_cache_behavior {
    allowed_methods  = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = local.s3_origin_id

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    viewer_protocol_policy = "redirect-to-https"
    min_ttl                = 0
    default_ttl            = 3600
    max_ttl                = 86400
    compress               = true
  }

  # API traffic → backend Lambda, no caching, cookies + auth headers forwarded.
  ordered_cache_behavior {
    path_pattern    = "/api/*"
    allowed_methods = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods  = ["GET", "HEAD", "OPTIONS"]
    # Managed CachingDisabled + AllViewerExceptHostHeader policies.
    cache_policy_id          = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
    origin_request_policy_id = "b689b0a8-53d0-40ab-baf2-68738e2966ac"
    compress                 = true
    target_origin_id         = "blockwise backend"
    viewer_protocol_policy   = "redirect-to-https"
  }

  restrictions {
    geo_restriction {
      restriction_type = "whitelist"
      locations        = ["US", "CA", "GB", "DE", "PL"]
    }
  }

  viewer_certificate {
    acm_certificate_arn = aws_acm_certificate_validation.blockwise.certificate_arn
    ssl_support_method  = "sni-only"
  }
}

# Route53 records for the CloudFront aliases
data "aws_route53_zone" "blockwise_zone" {
  name = local.my_domain
}

resource "aws_route53_record" "blockwise" {
  for_each = aws_cloudfront_distribution.cdn.aliases
  zone_id  = data.aws_route53_zone.blockwise_zone.zone_id
  name     = each.value
  type     = "A"

  alias {
    name                   = aws_cloudfront_distribution.cdn.domain_name
    zone_id                = aws_cloudfront_distribution.cdn.hosted_zone_id
    evaluate_target_health = false
  }
}
