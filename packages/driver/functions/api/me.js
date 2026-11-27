export function onRequestGet(context) {
  return new Response(JSON.stringify({ email: context.data.email || "" }), {
    headers: { "content-type": "application/json" },
  });
}
