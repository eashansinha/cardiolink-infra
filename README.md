# cardiolink-infra

Infrastructure for the CardioLink connected cardiac monitoring platform.

- `terraform/` — AWS: firmware distribution bucket, clinician portal EC2 + IAM role.
- `local/` — docker compose stack mirroring prod for local dev and testing:
  an S3 stand-in (moto) for the firmware bucket, an IMDS stand-in at 169.254.169.254,
  a seeder that signs and uploads a firmware image, the device gateway and the clinician portal.

## Run locally

Clone all four repos side by side, then:

```
cd cardiolink-infra/local
docker compose up --build -d
curl localhost:8080/health      # gateway
curl localhost:3000/health      # portal
```
