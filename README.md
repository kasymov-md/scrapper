# Scraper Microservice

Express + Playwright service that scrapes supported marketplace listing pages.

## Endpoint

`POST /scrape`

Payload:

```json
{
  "url": "https://auto.ria.com/....",
  "vin": "1HGCM82633A123456"
}
```

At least one of `url` or `vin` is required. If only VIN is provided, service returns a VIN-only payload.

## Features

- Domain allowlist validation (`ALLOWED_DOMAINS`)
- 30 second timeout
- Retry once on transient failures
- Basic rate limiting
- Structured JSON response

## Run locally

```bash
npm install
npm run dev
```

## Docker

```bash
docker build -t car-export-scraper .
docker run --rm -p 8080:8080 --env-file ../.env.example car-export-scraper
```
