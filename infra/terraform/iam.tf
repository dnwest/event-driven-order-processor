# Two managed policies, one per role in the pipeline. They are intentionally not
# attached to anything: the principal depends on where the producer and the
# worker are deployed, which this repository does not decide.

resource "aws_iam_policy" "publisher" {
  name        = "${var.name_prefix}-publisher"
  description = "Publish order events to the topic. Grants no queue access."
  policy      = data.aws_iam_policy_document.publisher.json
}

resource "aws_iam_policy" "consumer" {
  name        = "${var.name_prefix}-consumer"
  description = "Consume the orders queue and inspect the DLQ. Grants no publish rights."
  policy      = data.aws_iam_policy_document.consumer.json
}

data "aws_iam_policy_document" "publisher" {
  statement {
    sid       = "PublishOrderEvents"
    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.order_events.arn]
  }

  statement {
    sid       = "EncryptOrderEvents"
    actions   = ["kms:GenerateDataKey", "kms:Decrypt"]
    resources = [aws_kms_key.events.arn]
  }
}

data "aws_iam_policy_document" "consumer" {
  statement {
    sid = "ConsumeOrdersQueue"

    actions = [
      "sqs:ReceiveMessage",
      "sqs:DeleteMessage",
      "sqs:GetQueueAttributes",
      "sqs:ChangeMessageVisibility",
    ]

    resources = [aws_sqs_queue.orders.arn]
  }

  # Read-only on the DLQ: inspecting poison messages is part of the runbook,
  # draining them by hand is not.
  statement {
    sid       = "InspectDeadLetterQueue"
    actions   = ["sqs:ReceiveMessage", "sqs:GetQueueAttributes"]
    resources = [aws_sqs_queue.dlq.arn]
  }

  statement {
    sid       = "DecryptOrderEvents"
    actions   = ["kms:Decrypt"]
    resources = [aws_kms_key.events.arn]
  }
}
