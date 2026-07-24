terraform {
  # 1.10 is the floor for S3-native state locking (use_lockfile), which
  # replaces the traditional DynamoDB lock table.
  required_version = ">= 1.10"

  # Partial configuration: the backend is empty here because a backend block
  # cannot read variables. The bucket, endpoint and credentials are supplied at
  # init time via -backend-config (see infra/terraform/backend/). Targeting real
  # AWS is a matter of pointing init at a different backend-config file.
  backend "s3" {}

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}
