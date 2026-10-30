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
