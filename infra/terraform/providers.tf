provider "aws" {
  region = var.aws_region

  # LocalStack accepts any credentials and has no metadata service, so the
  # provider's pre-flight checks are skipped when pointed at it. Against real
  # AWS every value below falls back to the standard credential chain.
  access_key                  = var.localstack_endpoint != "" ? "test" : null
  secret_key                  = var.localstack_endpoint != "" ? "test" : null
  skip_credentials_validation = var.localstack_endpoint != ""
  skip_metadata_api_check     = var.localstack_endpoint != ""

  dynamic "endpoints" {
    for_each = var.localstack_endpoint != "" ? [var.localstack_endpoint] : []

    content {
      sns = endpoints.value
      sqs = endpoints.value
      kms = endpoints.value
      iam = endpoints.value
      sts = endpoints.value
    }
  }

  default_tags {
    tags = {
      Project   = "event-driven-order-processor"
      ManagedBy = "terraform"
    }
  }
}

data "aws_caller_identity" "current" {}
