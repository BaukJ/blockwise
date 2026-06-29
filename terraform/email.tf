resource "aws_ses_domain_identity" "blockwise" {
  domain = local.my_domain
}

resource "aws_ses_domain_dkim" "blockwise" {
  domain = aws_ses_domain_identity.blockwise.domain
}

resource "aws_route53_record" "blockwise_dkim" {
  count   = 3
  zone_id = data.aws_route53_zone.blockwise_zone.zone_id
  name    = "${element(aws_ses_domain_dkim.blockwise.dkim_tokens, count.index)}._domainkey.${local.my_domain}"
  type    = "CNAME"
  ttl     = 300
  records = ["${element(aws_ses_domain_dkim.blockwise.dkim_tokens, count.index)}.dkim.amazonses.com"]
}

resource "aws_route53_record" "blockwise_ses_verification" {
  zone_id = data.aws_route53_zone.blockwise_zone.zone_id
  name    = "_amazonses.${local.my_domain}"
  type    = "TXT"
  ttl     = 300
  records = [aws_ses_domain_identity.blockwise.verification_token]
}

resource "aws_route53_record" "blockwise_spf" {
  zone_id = data.aws_route53_zone.blockwise_zone.zone_id
  name    = local.my_domain
  type    = "TXT"
  ttl     = 300
  records = ["v=spf1 include:amazonses.com -all"]
}

resource "aws_route53_record" "blockwise_dmarc" {
  zone_id = data.aws_route53_zone.blockwise_zone.zone_id
  name    = "_dmarc.${local.my_domain}"
  type    = "TXT"
  ttl     = 300
  records = ["v=DMARC1; p=none; rua=mailto:support@${local.my_domain}"]
}
