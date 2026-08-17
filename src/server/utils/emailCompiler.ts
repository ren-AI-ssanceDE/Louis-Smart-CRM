import * as fs from "node:fs";
import * as path from "node:path";
import juice from "juice";

export interface EmailCompilerResult {
  html: string;
  text: string;
}

export interface EmailCompilerOptions {
  subject: string;
  senderName?: string;
  recipientName?: string;
  lang?: "de" | "en";
}

export class EmailCompiler {
  private static templateHtmlCache: string | null = null;
  private static templateCssCache: string | null = null;

  /**
   * Loads the template files and caches them in production mode
   */
  private static loadTemplates(): { html: string; css: string } {
    if (process.env.NODE_ENV === "production" && this.templateHtmlCache && this.templateCssCache) {
      return { html: this.templateHtmlCache, css: this.templateCssCache };
    }

    const templateDir = path.join(process.cwd(), "src", "server", "templates");
    const htmlPath = path.join(templateDir, "base.html");
    const cssPath = path.join(templateDir, "style.css");

    const html = fs.readFileSync(htmlPath, "utf-8");
    const css = fs.readFileSync(cssPath, "utf-8");

    if (process.env.NODE_ENV === "production") {
      this.templateHtmlCache = html;
      this.templateCssCache = css;
    }

    return { html, css };
  }

  /**
   * Compiles an outgoing email. CSS classes are converted to inline styles.
   */
  public static compile(bodyContent: string, options: EmailCompilerOptions): EmailCompilerResult {
    const { html: baseHtml, css: styles } = this.loadTemplates();

    // 1. Optional sanitizing/parsing if input is Markdown
    const processedBody = this.ensureHtmlStructure(bodyContent);

    // 2. Perform clean replacement of placeholders in the HTML document
    const compiledHtml = baseHtml
      .replace(/{{subject}}/g, this.escapeHtml(options.subject))
      .replace(/{{content}}/g, processedBody);

    // 3. Perform automatic CSS inlining via Juice (locally)
    const inlinedHtml = juice.inlineContent(compiledHtml, styles, {
      removeStyleTags: true,
      preserveMediaQueries: true,
    });

    // 4. Create accessible plain text version
    const plainText = this.generatePlainText(processedBody);

    return {
      html: inlinedHtml,
      text: plainText,
    };
  }

  /**
   * Ensures that text lines without HTML are converted to standards-compliant email paragraphs.
   */
  private static ensureHtmlStructure(input: string): string {
    const hasHtmlTags = /<[a-z|/][\s\S]*>/i.test(input);
    if (hasHtmlTags) {
      return input;
    }

    // Line-based Markdown translation for a clean structure
    return input
      .split("\n")
      .map((line) => {
        const trimmed = line.trim();
        if (!trimmed) return "<br />";
        if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
          return `<li>${trimmed.substring(2)}</li>`;
        }
        if (trimmed.startsWith("### ")) {
          return `<h3>${trimmed.substring(4)}</h3>`;
        }
        if (trimmed.startsWith("## ")) {
          return `<h2>${trimmed.substring(3)}</h2>`;
        }
        return `<p>${trimmed}</p>`;
      })
      .join("");
  }

  /**
   * Removes HTML tags for an error-free text/plain fallback
   */
  private static generatePlainText(html: string): string {
    return html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<\/li>/gi, "\n")
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/g, " ")
      .trim();
  }

  private static escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
}
