import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const web = (p: string) => new URL(`../web/${p}`, import.meta.url);
const read = (p: string) => readFileSync(web(p), "utf8");
const PAGES = ["index.html", "rules.html", "privacy.html", "credits.html"];

describe("website", () => {
  it("homepage says what Talesreach is and links to play", () => {
    const html = read("index.html");
    expect(html).toContain("<title>Talesreach — free browser MMORPG, no download</title>");
    expect(html).toMatch(/<meta name="description" content="[^"]{60,}"/);
    expect(html).toContain('href="/play/"');
    expect(html).toContain('rel="manifest"');
  });

  it("every page links to rules, privacy and credits, and has a viewport for phones", () => {
    for (const page of PAGES) {
      const html = read(page);
      for (const link of ["/rules.html", "/privacy.html", "/credits.html"]) expect(html, `${page} -> ${link}`).toContain(`href="${link}"`);
      expect(html, page).toContain('name="viewport"');
      expect(html, page).toMatch(/<html lang="en">/);
    }
  });

  it("all images referenced by the pages exist", () => {
    for (const page of PAGES) {
      for (const [, src] of read(page).matchAll(/src="\/([^"]+)"/g)) expect(existsSync(web(src!)), `${page}: ${src}`).toBe(true);
    }
  });

  it("the app manifest is valid and its icons exist at the stated sizes", () => {
    const m = JSON.parse(read("manifest.webmanifest")) as { start_url: string; display: string; icons: { src: string; sizes: string; purpose: string }[] };
    expect(m.start_url).toBe("/play/");
    expect(m.icons.some((i) => i.purpose === "maskable")).toBe(true);
    for (const icon of m.icons) {
      const png = readFileSync(web(icon.src.slice(1)));
      const w = png.readUInt32BE(16);
      const h = png.readUInt32BE(20);
      expect(`${w}x${h}`).toBe(icon.sizes);
    }
    expect(existsSync(web("sw.js"))).toBe(true);
  });

  it("the credits page names every creator listed in assets/CREDITS.md", () => {
    const credits = readFileSync(new URL("../assets/CREDITS.md", import.meta.url), "utf8");
    const authors = new Set<string>();
    for (const line of credits.split("\n")) {
      const cells = line.split("|").map((c) => c.trim());
      if (cells.length > 4 && cells[2] && !/^(Author|-+)$/.test(cells[2])) authors.add(cells[2].replace(/ \(kenney\.nl\)/, ""));
    }
    expect(authors.size).toBeGreaterThan(5);
    const page = read("credits.html");
    for (const a of authors) expect(page, a).toContain(a);
  });

  it("privacy policy covers date of birth, chat evidence and no selling of data", () => {
    const html = read("privacy.html");
    for (const phrase of ["date of birth", "13", "never sell", "chat"]) expect(html.toLowerCase()).toContain(phrase.toLowerCase());
  });
});
