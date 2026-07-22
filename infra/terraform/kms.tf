resource "aws_kms_key" "events" {
  description             = "Encrypts the order events at rest in SNS and SQS."
  enable_key_rotation     = true
  deletion_window_in_days = 7
  policy                  = data.aws_iam_policy_document.events_key.json
}

resource "aws_kms_alias" "events" {
  name          = "alias/${var.name_prefix}-events"
  target_key_id = aws_kms_key.events.key_id
}

data "aws_iam_policy_document" "events_key" {
  statement {
    sid       = "AccountAdministration"
    actions   = ["kms:*"]
    resources = ["*"]

    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"]
    }
  }

  # Without this, SNS cannot write an encrypted message into the queue and the
  # fan-out silently drops every event.
  statement {
    sid       = "AllowSNSFanOut"
    actions   = ["kms:GenerateDataKey*", "kms:Decrypt"]
    resources = ["*"]

    principals {
      type        = "Service"
      identifiers = ["sns.amazonaws.com"]
    }
  }
}
