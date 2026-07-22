resource "aws_sns_topic" "order_events" {
  name              = "${var.name_prefix}-events-topic"
  kms_master_key_id = aws_kms_key.events.id
}

resource "aws_sqs_queue" "dlq" {
  name                      = "${var.name_prefix}-dlq"
  kms_master_key_id         = aws_kms_key.events.id
  message_retention_seconds = var.message_retention_seconds
}

resource "aws_sqs_queue" "orders" {
  name                       = "${var.name_prefix}-queue"
  kms_master_key_id          = aws_kms_key.events.id
  visibility_timeout_seconds = var.visibility_timeout_seconds

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq.arn
    maxReceiveCount     = var.max_receive_count
  })
}

# Declared separately from the queues: putting it on the DLQ resource would make
# the two queues reference each other and Terraform would refuse the cycle.
resource "aws_sqs_queue_redrive_allow_policy" "dlq" {
  queue_url = aws_sqs_queue.dlq.id

  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue"
    sourceQueueArns   = [aws_sqs_queue.orders.arn]
  })
}

resource "aws_sqs_queue_policy" "orders" {
  queue_url = aws_sqs_queue.orders.id
  policy    = data.aws_iam_policy_document.orders_queue.json
}

data "aws_iam_policy_document" "orders_queue" {
  statement {
    sid       = "AllowSendFromOrderEventsTopic"
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.orders.arn]

    principals {
      type        = "Service"
      identifiers = ["sns.amazonaws.com"]
    }

    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [aws_sns_topic.order_events.arn]
    }
  }
}

resource "aws_sns_topic_subscription" "orders" {
  topic_arn = aws_sns_topic.order_events.arn
  protocol  = "sqs"
  endpoint  = aws_sqs_queue.orders.arn
}
