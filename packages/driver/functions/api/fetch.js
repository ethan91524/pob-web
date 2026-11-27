// Same-origin relay for PoB build-sharing sites that do not send CORS headers.
// Only the hosts PoB's BuildSiteTools.lua talks to are allowed.
const ALLOWED_HOSTS = new Set([
  "maxroll.gg",
  "pob.codes",
  "api.pob.codes",
  "pobb.in",
  "poe.ninja",
  "pastebin.com",
  "pastebinp.com",
  "rentry.co",
  "poedb.tw",
]);

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

export async function onRequestPost(context) {
  let req;
  try {
    req = await context.request.json();
  } catch {
    return json({ body: "", headers: {}, error: "bad request" }, 400);
  }
  let target;
  try {
    target = new URL(req.url);
  } catch {
    return json({ body: "", headers: {}, error: "bad url" }, 400);
  }
  const host = target.hostname.replace(/^www\./, "");
  if (target.protocol !== "https:" || !ALLOWED_HOSTS.has(host)) {
    return json({ body: "", headers: {}, error: `host not allowed: ${target.hostname}` }, 403);
  }
  try {
    const headers = Object.assign({}, req.headers || {}, { "User-Agent": "Path of Building" });
    const rep = await fetch(target.toString(), {
      method: req.body ? "POST" : "GET",
      body: req.body || undefined,
      headers,
      redirect: "follow",
    });
    const repHeaders = {};
    for (const [key, value] of rep.headers.entries()) repHeaders[key] = value;
    return json({ body: await rep.text(), headers: repHeaders, status: rep.status });
  } catch (error) {
    return json({ body: "", headers: {}, error: error instanceof Error ? error.message : String(error) });
  }
}
