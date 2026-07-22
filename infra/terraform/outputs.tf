output "sns_topic_arn" {
  description = "Value for the producer's SNS_TOPIC_ARN."
  value       = aws_sns_topic.order_events.arn
}

output "sqs_queue_url" {
  description = "Value for the worker's SQS_QUEUE_URL."
  value       = aws_sqs_queue.orders.url
}

output "dlq_url" {
  description = "Dead letter queue URL, for the inspection runbook."
  value       = aws_sqs_queue.dlq.url
}

output "kms_key_arn" {
  description = "Key encrypting the topic and both queues at rest."
  value       = aws_kms_key.events.arn
}

output "iam_policy_arns" {
  description = "Least-privilege policies to attach to the producer and the worker."
  value = {
    publisher = aws_iam_policy.publisher.arn
    consumer  = aws_iam_policy.consumer.arn
  }
}
