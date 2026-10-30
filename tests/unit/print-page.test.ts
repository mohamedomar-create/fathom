import { describe, expect, it } from "vitest";
import { pageBody, sameOriginStyles, imageSources } from "@/lib/pdf/print-page";

const page = `<!DOCTYPE html><html><head><link rel="stylesheet" href="/_next/static/css/a1.css" data-precedence="next"/>
<link rel="stylesheet" href="https://evil.example/x.css"/><link rel="preload" as="script" href="/_next/static/chunks/x.js"/></head>
<body class="b"><div id="report"><p onclick="steal()">Revenue 1,000</p><img src="https://proj.supabase.co/storage/v1/object/public/logos/a.png"/><img src="https://elsewhere.example/b.png"/></div>
<script>self.__next_f.push([1,"x"])</script><script src="/_next/static/chunks/main.js" async=""></script></body></html>`;

describe("printing a page the server drew", () => {
  it("keeps the body and drops every script and inline handler", () => {
    const b = pageBody(page);
    expect(b).toContain('<div id="report">');
    expect(b).toContain("Revenue 1,000");
    expect(b).not.toMatch(/<script/i);
    expect(b).not.toMatch(/onclick/i);
  });
  it("takes only the site's own stylesheets", () => {
    expect(sameOriginStyles(page)).toEqual(["/_next/static/css/a1.css"]);
  });
  it("lists the images, so the site's storage ones are inlined and others removed", () => {
    expect(imageSources(page)).toEqual(["https://proj.supabase.co/storage/v1/object/public/logos/a.png", "https://elsewhere.example/b.png"]);
  });
});

describe("where the PDF route fetches the print page from", () => {
  it("uses the configured address when there is one", async () => {
    const { printOrigin } = await import("@/lib/pdf/print-page");
    expect(printOrigin("https://evil.example/api/pdf", { APP_ORIGIN: "https://aql360.com" })).toBe("https://aql360.com");
  });
  it("on Vercel, the deployment's own address (Vercel routes by host)", async () => {
    const { printOrigin } = await import("@/lib/pdf/print-page");
    expect(printOrigin("https://aql360.com/api/pdf", { VERCEL: "1" })).toBe("https://aql360.com");
  });
  it("elsewhere, only a local address; a host sent in the request is never fetched", async () => {
    const { printOrigin } = await import("@/lib/pdf/print-page");
    expect(printOrigin("http://localhost:3000/api/pdf", {})).toBe("http://localhost:3000");
    expect(printOrigin("http://internal-db:8080/api/pdf", {})).toBeNull();
  });
});

describe("commentary text is printed as written", () => {
  it("only attributes inside tags are removed, never words in the text", () => {
    expect(pageBody(`<body><p class="c" onmouseover="x()">Staff onboarding = 5 people</p></body>`)).toBe(`<p class="c">Staff onboarding = 5 people</p>`);
  });
});
