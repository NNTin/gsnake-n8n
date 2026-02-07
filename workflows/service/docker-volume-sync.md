Service are n8n webhook endpoints that can be called.

For first proof of concept we need to create an n8n endpoint that can be triggered via a GitHub Event.  
Since our n8n instance is reachable in the web and the code open source we need to properly protect it so only authorized users can send.
using `X-Hub-Signature-256`
```ts
const crypto = require('crypto');

const secret = $env.N8N_WEBHOOK_SECRET;
const signature = $headers['x-hub-signature-256'];
const rawBody = $json; // see note below

const hmac = crypto
  .createHmac('sha256', secret)
  .update(JSON.stringify(rawBody))
  .digest('hex');

const expected = `sha256=${hmac}`;

if (signature !== expected) {
  throw new Error('Invalid GitHub signature');
}

return items;
```

n8n webhook endpoint triggers custom docker volume sync node, see workflows/actions/node-docker-volume-sync.md