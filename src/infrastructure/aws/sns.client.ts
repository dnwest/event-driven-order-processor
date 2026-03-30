import { SNSClient } from '@aws-sdk/client-sns';
import { env } from '../../config/env.js';

export const snsClient = new SNSClient({
  region: env.AWS_REGION,
  credentials: {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  },
  endpoint: env.AWS_ENDPOINT,
});
