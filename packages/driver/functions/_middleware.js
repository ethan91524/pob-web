// Site-wide gate: every request needs a signed session cookie issued after Google sign-in.
// Also sets the cross-origin isolation headers PoB needs (SharedArrayBuffer).
import { readSession } from "../functions-lib/session.js";

const PUBLIC_PATHS = new Set(["/login", "/login.html", "/api/session", "/favicon.ico"]);

function isolate(response) {
  const r = new Response(response.body, response);
  r.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  r.headers.set("Cross-Origin-Embedder-Policy", "require-corp");
  r.headers.set("Cross-Origin-Resource-Policy", "same-origin");
  return r;
}

export async function onRequest(context) {
  const url = new URL(context.request.url);
  if (PUBLIC_PATHS.has(url.pathname)) return isolate(await context.next());

  const session = await readSession(context.request, context.env);
  if (!session) {
    if (url.pathname.startsWith("/api/")) return new Response("Unauthorized", { status: 401 });
    const accept = context.request.headers.get("accept") || "";
    if (url.pathname === "/" || url.pathname.endsWith(".html") || accept.includes("text/html")) {
      return Response.redirect(`${url.origin}/login`, 302);
    }
    return new Response("Unauthorized", { status: 401 });
  }
  context.data.sub = session.sub;
  context.data.email = session.email;
  return isolate(await context.next());
}
