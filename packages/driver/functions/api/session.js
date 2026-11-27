import { makeSessionCookie, verifyGoogleIdToken } from "../../functions-lib/session.js";

export async function onRequestPost(context) {
  try {
    const { id_token: idToken } = await context.request.json();
    const claims = await verifyGoogleIdToken(String(idToken || ""), context.env.GOOGLE_CLIENT_ID);
    const cookie = await makeSessionCookie(context.env, { sub: claims.sub, email: claims.email || "" });
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json", "set-cookie": cookie },
    });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: String(error?.message || error) }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
}
