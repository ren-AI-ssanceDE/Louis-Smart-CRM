import { GoogleGenAI } from "@google/genai";
import { pool, isUsingFallback, fallbackStore } from "../../db.js";
import { WebSearchConfig } from "../../../types.js";

// Helper to sanitize/extract text from DuckDuckGo HTML output
function extractTextFromHtml(html: string): string {
  // Strip script and style tags first
  let cleaned = html.replace(/<script[^>]*>([\s\S]*?)<\/script>/gi, "");
  cleaned = cleaned.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, "");
  
  // Check for captcha indicators
  const isCaptcha = html.includes("ddg-captcha") || 
                    html.includes("Captcha") || 
                    html.includes("unusual activity") || 
                    html.includes("checking your browser") ||
                    html.includes("Verifizierung") ||
                    html.includes("Forbidden");
  if (isCaptcha) {
    console.warn("[DuckDuckGo Scraper] Captcha oder Bot-Sperre auf der Seite erkannt!");
  }

  // Try robust structured block parsing first to gather URLs and Titles
  const results: { title: string; url: string; snippet: string }[] = [];
  const bodyRegex = /<div class="[^"]*result__body[^"]*">([\s\S]*?)<div class="clear"><\/div>/gi;
  let blockMatch;
  while ((blockMatch = bodyRegex.exec(html)) !== null) {
    const block = blockMatch[1];
    const titleMatch = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi.exec(block);
    const snippetMatch = /<a[^>]+class="[^"]*result__snippet[^"]*"[^]*>([\s\S]*?)<\/a>/gi.exec(block);
    if (titleMatch) {
      let href = titleMatch[1];
      let title = titleMatch[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
      let snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() : "";
      let realUrl = href;
      if (href.includes("uddg=")) {
        const queryParams = href.split("uddg=")[1]?.split("&")[0];
        if (queryParams) {
          realUrl = decodeURIComponent(queryParams);
        }
      }
      if (realUrl.startsWith("//")) {
        realUrl = "https:" + realUrl;
      }
      results.push({ title, url: realUrl, snippet });
    }
  }

  if (results.length > 0) {
    return results
      .map((r, idx) => `Title: ${r.title}\nSnippet: ${r.snippet}\nURL: ${r.url}`)
      .slice(0, 10)
      .join("\n\n");
  }

  // Parse simple tags or just strip all tags (Fallback)
  const textMatches: string[] = [];
  const tagRegex = /<[^>]+>/g;
  
  // Find search result blocks on html.duckduckgo.com or lite.duckduckgo.com page.
  // We match diverse potential result snippet patterns layout
  const snippetRegexes = [
    /<td class="result-snippet">([\s\S]*?)<\/td>/gi,
    /<(?:div|span|p|a|td) class="result__snippet"[^>]*>([\s\S]*?)<\/(?:div|span|p|a|td)>/gi,
    /<(?:div|span|p|a|td) class="result-snippet"[^>]*>([\s\S]*?)<\/(?:div|span|p|a|td)>/gi
  ];

  for (const regex of snippetRegexes) {
    let match;
    while ((match = regex.exec(html)) !== null) {
      const rawSnippet = match[1];
      const cleanSnippet = rawSnippet.replace(tagRegex, "").replace(/\s+/g, " ").trim();
      if (cleanSnippet && !textMatches.includes(cleanSnippet)) {
        textMatches.push(cleanSnippet);
      }
    }
  }

  // If we couldn't parse snippets, fall back to basic line-by-line strip tags
  if (textMatches.length === 0) {
    const lines = cleaned.split("\n");
    for (const line of lines) {
      const parsed = line.replace(tagRegex, "").replace(/\s+/g, " ").trim();
      if (parsed && parsed.length > 30 && !parsed.includes("ddg") && !parsed.includes("CAPTCHA") && !parsed.includes("checking your browser") && !parsed.includes("robot")) {
        textMatches.push(parsed);
      }
    }
  }

  return textMatches.slice(0, 15).join("\n\n");
}

// Simulated real desktop browsers pool for stealth & bypass
const userAgentsWithHints = [
  {
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    chUa: '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    platform: '"Windows"'
  },
  {
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    chUa: '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    platform: '"macOS"'
  },
  {
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 Edg/123.0.0.0",
    chUa: '"Chromium";v="123", "Microsoft Edge";v="123", "Not-A.Brand";v="99"',
    platform: '"Windows"'
  },
  {
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0",
    chUa: null,
    platform: '"Windows"'
  },
  {
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
    chUa: null,
    platform: '"macOS"'
  }
];

function getHumanHeaders() {
  const choice = userAgentsWithHints[Math.floor(Math.random() * userAgentsWithHints.length)];
  const headers: Record<string, string> = {
    "User-Agent": choice.ua,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "Accept-Language": "de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7",
    "Cache-Control": "max-age=0",
    "Referer": "https://duckduckgo.com/",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "DNT": "1",
    "Connection": "keep-alive"
  };

  if (choice.chUa) {
    headers["Sec-Ch-Ua"] = choice.chUa;
    headers["Sec-Ch-Ua-Mobile"] = "?0";
    headers["Sec-Ch-Ua-Platform"] = choice.platform;
  }

  return headers;
}

/**
 * Tool 2: Web Search Tool (Config-aware SearXNG or DuckDuckGo Scraper) with Linear Backoff Retry
 */
export async function executeWebSearch(query: string, attempt: number = 1, tenantId: string = '1', aiClient?: GoogleGenAI): Promise<string> {
  let selectedEngine = 'duckduckgo';
  let duckduckgoUrl = 'https://html.duckduckgo.com/html/';
  let searxngUrl = 'https://searxng.org/search';
  let searxngCategories = '';
  let googleApiKey = '';
  let googleCx = '';

  try {
    if (isUsingFallback) {
      if (fallbackStore.webSearchConfig) {
        const found = fallbackStore.webSearchConfig.find((c: WebSearchConfig) => c.tenant_id === tenantId) || fallbackStore.webSearchConfig.find((c: WebSearchConfig) => c.tenant_id === '1');
        if (found) {
          selectedEngine = found.selected_engine || 'duckduckgo';
          duckduckgoUrl = found.duckduckgo_url || 'https://html.duckduckgo.com/html/';
          searxngUrl = found.searxng_url || 'https://searxng.org/search';
          searxngCategories = found.searxng_categories || '';
          googleApiKey = found.google_api_key || '';
          googleCx = found.google_cx || '';
        }
      }
    } else {
      const res = await pool.query(
        "SELECT selected_engine, duckduckgo_url, searxng_url, searxng_categories, google_api_key, google_cx FROM sys_integrations_web_search_config WHERE tenant_id = $1 OR tenant_id = '1' ORDER BY CASE WHEN tenant_id = $1 THEN 0 ELSE 1 END LIMIT 1",
        [tenantId]
      );
      if (res.rows.length > 0) {
        const row = res.rows[0];
        selectedEngine = row.selected_engine || 'duckduckgo';
        duckduckgoUrl = row.duckduckgo_url || 'https://html.duckduckgo.com/html/';
        searxngUrl = row.searxng_url || 'https://searxng.org/search';
        searxngCategories = row.searxng_categories || '';
        googleApiKey = row.google_api_key || '';
        googleCx = row.google_cx || '';
      }
    }
  } catch (err) {
    console.warn("Failed to load web search configuration during tool run, using defaults:", err);
  }

  // --- 1. Google Search Grounding via Gemini API (Excellent dynamic LLM integration) ---
  if (selectedEngine === 'google_grounding') {
    try {
      const gAI = aiClient || new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY || "dummy",
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });
      console.log(`[executeWebSearch] Using Gemini native Google Search Grounding for: "${query}"`);
      const response = await gAI.models.generateContent({
        model: "gemini-3.5-flash",
        contents: `Suche im Web nach folgendem Begriff und liefere eine detaillierte Zusammenfassung der relevantesten Suchergebnisse. Falls du konkrete Fakten wie Adressen, Firmennamen, Steuernummern oder Umsätze findest, markiere sie deutlich: "${query}"`,
        config: {
          tools: [{ googleSearch: {} }]
        }
      });
      let responseText = response.text || "Kein Text generiert über Gemini Google Grounding.";
      const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
      if (chunks && Array.isArray(chunks)) {
        const citedSources = chunks
          .map((c) => {
            const chunk = c as { web?: { title?: string; uri?: string } };
            return chunk.web ? `- **${chunk.web.title || 'Quelle'}**: ${chunk.web.uri}` : null;
          })
          .filter(Boolean)
          .join('\n');
        if (citedSources) {
          responseText += `\n\n**Quellen / Referenzen:**\n${citedSources}`;
        }
      }
      return responseText;
    } catch (gErr) {
      console.error("[executeWebSearch] Gemini Grounding Search failed, falling back to other search engines:", gErr);
      selectedEngine = 'duckduckgo';
    }
  }

  // --- 2. Google Custom Search JSON API (Highly configurable, extremely robust JSON endpoint) ---
  if (selectedEngine === 'google_custom_search') {
    if (!googleApiKey || !googleCx) {
      return "Google Custom Search JSON-Schnittstelle wurde ausgewählt, aber der Google API-Key oder die Custom Search Engine ID (CX) ist in den Einstellungen nicht konfiguriert.";
    }
    try {
      console.log(`[executeWebSearch] Calling Google Custom Search JSON API for: "${query}"`);
      const searchUrl = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(googleApiKey)}&cx=${encodeURIComponent(googleCx)}&q=${encodeURIComponent(query)}`;
      const response = await fetch(searchUrl);
      if (!response.ok) {
        throw new Error(`Google Search API responded with status ${response.status}`);
      }
      const data = await response.json();
      if (data && data.items && Array.isArray(data.items)) {
        const textContent = data.items
          .map((item) => {
            const it = item as { title?: string; snippet?: string; link?: string };
            return `Titel: ${it.title || 'Ohne Titel'}\nBeschreibung: ${it.snippet || ''}\nURL: ${it.link || ''}`;
          })
          .slice(0, 10)
          .join("\n\n");
        return textContent || "Google Custom Search hat keine Ergebnisse geliefert.";
      }
      return "Die Google Custom Search JSON-Schnittstelle hat keine Items zurückgegeben.";
    } catch (gSearchErr) {
      console.error("[executeWebSearch] Google Custom Search failed, falling back to other search engines:", gSearchErr);
      selectedEngine = 'duckduckgo';
    }
  }

  // --- 3. SearXNG JSON API ---
  if (selectedEngine === 'searxng') {
    try {
      const urlObj = new URL(searxngUrl || 'https://searxng.org/search');
      urlObj.searchParams.set('q', query);
      urlObj.searchParams.set('format', 'json');
      if (searxngCategories) {
        urlObj.searchParams.set('categories', searxngCategories);
      }
      
      const response = await fetch(urlObj.toString(), {
        headers: { 
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36" 
        }
      });
      if (!response.ok) {
        throw new Error(`HTTP status ${response.status}`);
      }
      const data = await response.json();
      if (data && data.results && Array.isArray(data.results)) {
        const textContent = data.results
          .map((r) => {
            const result = r as { title?: string; content?: string; url?: string };
            return `${result.title || 'Untitled'}\n${result.content || ''}\nURL: ${result.url || ''}`;
          })
          .slice(0, 10)
          .join("\n\n");
        return textContent || "No results found on SearXNG.";
      }
      throw new Error("Invalid json or no results key in SearXNG response");
    } catch (searxErr) {
      if (attempt < 4) {
        await new Promise(resolve => setTimeout(resolve, attempt * 1000));
        return executeWebSearch(query, attempt + 1, tenantId, aiClient);
      }
      console.warn("SearXNG JSON request failed, attempting fallback Scrape:", searxErr);
      try {
        const urlObj = new URL(searxngUrl || 'https://searxng.org/search');
        urlObj.searchParams.set('q', query);
        if (searxngCategories) {
          urlObj.searchParams.set('categories', searxngCategories);
        }
        const response = await fetch(urlObj.toString(), {
          headers: { 
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36" 
          }
        });
        if (!response.ok) {
          throw new Error(`HTML route status ${response.status}`);
        }
        const htmlText = await response.text();
        let cleaned = htmlText.replace(/<script[^>]*>([\s\S]*?)<\/script>/gi, "");
        cleaned = cleaned.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, "");
        const textMatches: string[] = [];
        
        const articleRegex = /<article[^>]*>([\s\S]*?)<\/article>/gi;
        let match;
        while ((match = articleRegex.exec(cleaned)) !== null) {
          const rawClassText = match[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
          if (rawClassText && rawClassText.length > 20) {
            textMatches.push(rawClassText);
          }
        }
        
        if (textMatches.length === 0) {
          const lines = cleaned.split("\n");
          for (const line of lines) {
            const parsed = line.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
            if (parsed && parsed.length > 50) {
              textMatches.push(parsed);
            }
          }
        }
        
        return textMatches.slice(0, 12).join("\n\n") || "SearXNG Scrape produced no text.";
      } catch (htmlErr) {
        return `SearXNG web search failed: ${(htmlErr as Error).message}`;
      }
    }
  }

  // Fallback / default to DuckDuckGo Scraper
  try {
    const baseUrl = duckduckgoUrl || 'https://html.duckduckgo.com/html/';
    const formattedUrl = `${baseUrl.endsWith('html/') || baseUrl.endsWith('html') ? baseUrl : baseUrl + (baseUrl.endsWith('/') ? '' : '/') + 'html/'}?q=${encodeURIComponent(query)}`;
    const response = await fetch(formattedUrl, {
      headers: getHumanHeaders()
    });
    
    if (!response.ok) {
      throw new Error(`HTTP status ${response.status}`);
    }

    const htmlText = await response.text();
    const textContent = extractTextFromHtml(htmlText);
    
    if ((!textContent || textContent.trim().length === 0) && attempt < 4) {
      await new Promise(resolve => setTimeout(resolve, attempt * 1000));
      return executeWebSearch(query, attempt + 1, tenantId, aiClient);
    }
    return textContent || "No results found.";
  } catch (err) {
    if (attempt < 4) {
      await new Promise(resolve => setTimeout(resolve, attempt * 1000));
      return executeWebSearch(query, attempt + 1, tenantId, aiClient);
    }
    return `Web search failed after 4 attempts (Sperren/Captchas der Engine blockieren eventuell den Container): ${(err as Error).message}`;
  }
}
