#!/bin/bash
set -e

echo "Configurando LocalStack SQS/SNS..."

# Cria o Tópico SNS
awslocal sns create-topic --name order-events-topic

# Cria a Fila SQS
awslocal sqs create-queue --queue-name orders-queue

# Inscreve a Fila no Tópico (Fan-out)
awslocal sns subscribe \
    --topic-arn arn:aws:sns:us-east-1:000000000000:order-events-topic \
    --protocol sqs \
    --notification-endpoint arn:aws:sqs:us-east-1:000000000000:orders-queue

echo "Infraestrutura local pronta!"
