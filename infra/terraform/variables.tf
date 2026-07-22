variable "aws_region" {
  description = "Region the topology is provisioned in."
  type        = string
  default     = "us-east-1"
}

variable "name_prefix" {
  description = "Prefix for every resource name, so multiple environments can coexist in one account."
  type        = string
  default     = "orders"
}

variable "localstack_endpoint" {
  description = "LocalStack endpoint. Set to \"\" to target real AWS."
  type        = string
  default     = "http://localhost:4566"
}

variable "max_receive_count" {
  description = "Receives of a single message before the redrive policy sends it to the DLQ."
  type        = number
  default     = 3
}

variable "visibility_timeout_seconds" {
  description = "Time a received message stays invisible to other consumers."
  type        = number
  default     = 30
}

variable "message_retention_seconds" {
  description = "How long the DLQ keeps a message available for inspection."
  type        = number
  default     = 1209600 # 14 days, the SQS maximum
}
