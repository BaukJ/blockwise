resource "random_password" "secret_key" {
  length  = 101
  special = false
}

locals {
  # Shared IAM for both functions: DynamoDB + SES.
  lambda_policy_json = <<JSON
    {
      "Version": "2012-10-17",
      "Statement": [
        {
          "Sid": "FullDynamoDBAccess",
          "Effect": "Allow",
          "Action": "dynamodb:*",
          "Resource": "*"
        },
        {
          "Sid": "FullSES",
          "Effect": "Allow",
          "Action": ["ses:SendEmail", "ses:SendRawEmail"],
          "Resource": "*"
        }
      ]
    }
  JSON
}

# ── Worker Lambda: solves one job, invoked asynchronously by the API ─────────────
module "solver_lambda" {
  source = "terraform-aws-modules/lambda/aws"

  function_name = "blockwise-solver"
  handler       = "lambda_worker.lambda_handler"
  runtime       = "python3.12"
  timeout       = 900  # ILP solves can run for minutes
  memory_size   = 3008 # more memory = more vCPU for HiGHS

  source_path     = "../backend"
  build_in_docker = true # native wheels (highspy, pydantic-core, bcrypt) need manylinux

  environment_variables = {
    SECRET_KEY = random_password.secret_key.result
    LOG_LEVEL  = "INFO"
  }

  attach_policy_json = true
  policy_json        = local.lambda_policy_json
}

# ── API Lambda (FastAPI via Mangum), fronted by CloudFront ───────────────────────
module "backend_lambda" {
  source = "terraform-aws-modules/lambda/aws"

  function_name = "blockwise-backend"
  handler       = "lambda_handler.lambda_handler"
  runtime       = "python3.12"
  timeout       = 300 # admin/table tasks can take longer
  memory_size   = 1024

  source_path     = "../backend"
  build_in_docker = true

  environment_variables = {
    SECRET_KEY           = random_password.secret_key.result
    GOOGLE_CLIENT_ID     = var.google_client_id
    GOOGLE_CLIENT_SECRET = var.google_client_secret
    SOLVER_FUNCTION_NAME = module.solver_lambda.lambda_function_name
    DOMAIN               = local.my_domain
    LOG_LEVEL            = "INFO"
  }

  attach_policy_json = true
  policy_json        = <<JSON
    {
      "Version": "2012-10-17",
      "Statement": [
        {
          "Sid": "FullDynamoDBAccess",
          "Effect": "Allow",
          "Action": "dynamodb:*",
          "Resource": "*"
        },
        {
          "Sid": "FullSES",
          "Effect": "Allow",
          "Action": ["ses:SendEmail", "ses:SendRawEmail"],
          "Resource": "*"
        },
        {
          "Sid": "InvokeSolver",
          "Effect": "Allow",
          "Action": "lambda:InvokeFunction",
          "Resource": "${module.solver_lambda.lambda_function_arn}"
        }
      ]
    }
  JSON

  # Function URL instead of API Gateway, for cost.
  create_lambda_function_url = true
  authorization_type         = "AWS_IAM"
}

resource "aws_lambda_permission" "allow_cloudfront_function" {
  statement_id  = "AllowFunctionExecutionFromCloudFront"
  action        = "lambda:InvokeFunction"
  function_name = module.backend_lambda.lambda_function_name
  principal     = "cloudfront.amazonaws.com"
  source_arn    = aws_cloudfront_distribution.cdn.arn
}

resource "aws_lambda_permission" "allow_cloudfront_function_url" {
  statement_id  = "AllowFunctionUrlExecutionFromCloudFront"
  action        = "lambda:InvokeFunctionUrl"
  function_name = module.backend_lambda.lambda_function_name
  principal     = "cloudfront.amazonaws.com"
  source_arn    = aws_cloudfront_distribution.cdn.arn
}

locals {
  backend_lambda_function_domain = trimsuffix(replace(module.backend_lambda.lambda_function_url, "https://", ""), "/")
}

output "backend_function_url" {
  value = module.backend_lambda.lambda_function_url
}
