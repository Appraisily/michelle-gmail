import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

const client = new SecretManagerServiceClient();

export async function getSecrets() {
  try {
    const secrets = {};
    const secretNames = [
      'GMAIL_CLIENT_ID',
      'GMAIL_CLIENT_SECRET',
      'GMAIL_REFRESH_TOKEN',
      'OPENAI_API_KEY'
    ];

    for (const secretName of secretNames) {
      const [version] = await client.accessSecretVersion({
        name: `projects/${process.env.PROJECT_ID}/secrets/${secretName}/versions/latest`
      });
      
      secrets[secretName] = version.payload.data.toString();
    }

    return secrets;
  } catch (error) {
    throw new Error(`Error fetching secrets: ${error.message}`);
  }
}