#!/bin/bash
set -e

echo "Configurando LocalStack SQS/SNS com DLQ..."

# 1. Cria o Tópico SNS
awslocal sns create-topic --name order-events-topic

# 2. Cria a DLQ (Dead Letter Queue)
awslocal sqs create-queue --queue-name orders-dlq

# 3. Cria a Fila Principal com Redrive Policy (maxReceiveCount = 3)
awslocal sqs create-queue \
    --queue-name orders-queue \
    --attributes '{"RedrivePolicy": "{\"deadLetterTargetArn\":\"arn:aws:sqs:us-east-1:000000000000:orders-dlq\",\"maxReceiveCount\":\"3\"}"}'

# 4. Inscreve a Fila Principal no Tópico SNS
awslocal sns subscribe \
    --topic-arn arn:aws:sns:us-east-1:000000000000:order-events-topic \
    --protocol sqs \
    --notification-endpoint arn:aws:sqs:us-east-1:000000000000:orders-queue

echo "Infraestrutura local com DLQ pronta!"
