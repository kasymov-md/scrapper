const express = require("express");
const cors = require("cors");
const { chromium } = require("playwright");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const ALLOWED_DOMAIN = process.env.ALLOWED_DOMAIN || "encar.com";

app.post("/scrape", async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: "URL is required" });
  }

  if (!url.includes(ALLOWED_DOMAIN)) {
    return res.status(400).json({ error: "Invalid domain" });
  }

  let browser;

  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    await page.goto(url, { timeout: 30000 });

    // ⚠️ Это пример. Селекторы нужно будет адаптировать под реальный marketplace.
    const title = await page.title();

    const data = {
      title,
      source_url: url,
      scraped_at: new Date().toISOString(),
    };

    await browser.close();

    res.json(data);

  } catch (error) {
    if (browser) await browser.close();
    console.error(error);
    res.status(500).json({ error: "Scraping failed" });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Scraper running on port ${PORT}`);
});
