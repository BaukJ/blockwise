terraform {
  required_version = ">= 1.4"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
    external = {
      source  = "hashicorp/external"
      version = ">= 2.0"
    }
    random = {
      source  = "hashicorp/random"
      version = ">= 3.0"
    }
  }
  backend "s3" {
    bucket = "uk.bauk.tfstate"
    key    = "blockwise/prod/root"
    region = "eu-west-1"
  }
}

provider "aws" {
  region  = "eu-west-1"
  profile = "bauk-blockwise-admin"
}

# ACM for CloudFront must be in us-east-1
provider "aws" {
  alias   = "us_east_1"
  region  = "us-east-1"
  profile = "bauk-blockwise-admin"
}
