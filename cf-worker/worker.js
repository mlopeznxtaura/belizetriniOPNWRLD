const ORIGIN = "https://app13-nextaura-us.284w7l87aq94.us-south.codeengine.appdomain.cloud";

export default {
  async fetch(request) {
    const incoming = new URL(request.url);
    const outbound = new URL(ORIGIN);
    outbound.pathname = incoming.pathname;
    outbound.search = incoming.search;
    const headers = new Headers(request.headers);
    headers.delete("host");
    headers.set("X-Forwarded-Host", incoming.host);
    headers.set("X-Forwarded-Proto", incoming.protocol.replace(":", ""));
    const res = await fetch(outbound.toString(), {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      redirect: "follow",
    });
    const out = new Headers(res.headers);
    out.set("x-proxied-by", "nextaura-app13-us");
    return new Response(res.body, { status: res.status, headers: out });
  },
};
