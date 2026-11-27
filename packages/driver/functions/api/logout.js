import { clearSessionCookie } from "../../functions-lib/session.js";

export function onRequest(context) {
  const origin = new URL(context.request.url).origin;
  return new Response(null, {
    status: 302,
    headers: { location: `${origin}/login`, "set-cookie": clearSessionCookie() },
  });
}
