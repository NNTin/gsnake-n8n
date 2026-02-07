## Challenge

We are self-hosting n8n see ~/git/lair.nntin.xyz/projects/nntin-labs/services/n8n/docker-compose.yml
```yml
services:
  n8n:
    image: n8nio/n8n:latest
    container_name: ${SERVICE_NAME}
    restart: unless-stopped
    environment:
      - SERVICE_NAME=${SERVICE_NAME}
      - N8N_HOST=${SERVICE_NAME}.labs.${DOMAIN}
      - N8N_PORT=5678
      - N8N_PROTOCOL=https
      - WEBHOOK_URL=https://${SERVICE_NAME}.labs.${DOMAIN}/
      - N8N_EDITOR_BASE_URL=https://${SERVICE_NAME}.labs.${DOMAIN}/
    volumes:
      - n8n-data:/home/node/.n8n

volumes:
  n8n-data:
    external: true
    name: nntin-labs-n8n-data
```
There we are volume mounting our n8n instance.

The free self-hosted version has the MCP limitation that writing to it is not possible. Reading is possible.  
Hence the import is done manually through the UI or by mounting.

## SOP

We need a way to retrieve the data of a mounted volume, e.g.
```sh
docker run --rm \
  -v my_volume:/data \
  -v "$(pwd)":/backup \
  alpine \
  sh -c "cp -a /data/. /backup/"
```

We need a way to write data to a mounted volume