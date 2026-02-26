import express from "express";
import rateLimit from "express-rate-limit";
import { chromium } from "playwright";
import { z } from "zod";

const app = express();
app.use(express.json({ limit: "1mb" }));

const rateLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000),
  max: Number(process.env.RATE_LIMIT_MAX || 20),
  standardHeaders: true,
  legacyHeaders: false
});

app.use(rateLimiter);

const schema = z
  .object({
    url: z.string().url().optional(),
    vin: z.string().trim().min(6).max(64).optional()
  })
  .refine((value) => Boolean(value.url || value.vin), {
    message: "Either url or vin is required"
  });

const ALLOWED_DOMAINS = (process.env.ALLOWED_DOMAINS || "auto.ria.com,cars.com,copart.com,iaai.com")
  .split(",")
  .map((v) => v.trim().toLowerCase())
  .filter(Boolean);

function isAllowedDomain(urlString: string) {
  const hostname = new URL(urlString).hostname.toLowerCase();
  return ALLOWED_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

function parseNumber(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const normalized = raw.replace(/,/g, "").replace(/\s+/g, " ");
  const match = normalized.match(/\d+(?:[.]\d+)?/);
  if (!match) return null;
  return Number(match[0]);
}

function parseVin(text: string, fallback?: string) {
  const regex = /\b[A-HJ-NPR-Z0-9]{17}\b/i;
  const found = text.match(regex)?.[0]?.toUpperCase();
  return found || fallback || null;
}

function parseYear(text: string): number | null {
  const match = text.match(/\b(19\d{2}|20\d{2})\b/);
  return match ? Number(match[1]) : null;
}

async function scrapeFromUrl(url: string, vinInput?: string) {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
    });
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });

    const payload = await page.evaluate(() => {
      const getMeta = (name: string) =>
        (document.querySelector(`meta[property='${name}']`) as HTMLMetaElement | null)?.content ||
        (document.querySelector(`meta[name='${name}']`) as HTMLMetaElement | null)?.content ||
        null;

      const title =
        getMeta("og:title") || (document.querySelector("h1") as HTMLElement | null)?.innerText || document.title;
      const description = getMeta("description") || getMeta("og:description") || "";
      const bodyText = document.body?.innerText || "";

      return {
        title,
        description,
        bodyText
      };
    });

    const corpus = `${payload.title}\n${payload.description}\n${payload.bodyText}`;
    const title = payload.title || null;

    const brandMatch = corpus.match(/\b(Toyota|Honda|BMW|Mercedes|Audi|Volkswagen|Lexus|Kia|Hyundai|Nissan|Mazda|Ford|Chevrolet)\b/i);
    const engineMatch = corpus.match(/(\d(?:[.,]\d)?)\s*(L|lit(er|re)s?)/i);
    const mileageMatch = corpus.match(/(\d{2,7})\s*(km|kilometers|mi|miles)/i);
    const colorMatch = corpus.match(/\b(black|white|silver|gray|grey|blue|red|green|beige|brown|yellow|orange)\b/i);
    const usdMatch = corpus.match(/\$\s?([\d,]+(?:\.\d{1,2})?)/) || corpus.match(/([\d,]+(?:\.\d{1,2})?)\s*USD/i);

    const brand = brandMatch ? brandMatch[1] : null;
    const model = brand
      ? title
          ?.replace(new RegExp(brand, "i"), "")
          .split("|")[0]
          .trim()
          .split(" ")
          .slice(0, 3)
          .join(" ") || null
      : null;

    return {
      title,
      brand,
      model,
      year: parseYear(corpus),
      engine_volume: engineMatch ? Number(engineMatch[1].replace(",", ".")) : null,
      mileage: mileageMatch ? Number(mileageMatch[1]) : null,
      color: colorMatch ? colorMatch[1].toLowerCase() : null,
      price_usd: usdMatch ? parseNumber(usdMatch[1]) : null,
      vin: parseVin(corpus, vinInput)
    };
  } finally {
    await browser.close();
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number) {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error("Scrape timeout after 30s")), ms);
    })
  ]);
}

async function scrapeWithRetry(url: string, vin?: string) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await withTimeout(scrapeFromUrl(url, vin), 30_000);
    } catch (error) {
      lastError = error;
      if (attempt === 1) {
        throw error;
      }
    }
  }
  throw lastError;
}

app.post("/scrape", async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid payload" });
  }

  const { url, vin } = parsed.data;

  if (!url) {
    return res.status(200).json({
      title: null,
      brand: null,
      model: null,
      year: null,
      engine_volume: null,
      mileage: null,
      color: null,
      price_usd: null,
      vin: vin || null
    });
  }

  if (!isAllowedDomain(url)) {
    return res.status(400).json({ error: "Domain is not allowed" });
  }

  try {
    const result = await scrapeWithRetry(url, vin);
    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to scrape listing"
    });
  }
});

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true });
});

const port = Number(process.env.PORT || 8080);
app.listen(port, () => {
  console.log(`Scraper running on port ${port}`);
});
