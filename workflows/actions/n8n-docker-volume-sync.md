## Challenge

We are self-hosting n8n see ~/git/lair.nntin.xyz/projects/nntin-labs/services/n8n/docker-compose.yml
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