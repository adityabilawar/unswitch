/**
 * Local license server. Test mode only.
 *   STRIPE_SECRET_KEY=sk_test_... STRIPE_WEBHOOK_SECRET=whsec_... \
 *   LICENSE_SIGNING_SECRET=... PUBLIC_BASE_URL=http://127.0.0.1:8787 \
 *   npm start --prefix server
 */

const http = require("node:http");
const { route, readNodeRequest } = require("./lib/handlers");

function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const request = await readNodeRequest(req);
      const result = await route(request);
      res.writeHead(result.status, result.headers);
      res.end(result.body);
    } catch (error) {
      res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: error.message || "Server error." }));
    }
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT || 8787);
  const server = createServer();
  server.listen(port, "127.0.0.1", () => {
    console.log(`Tab Lock license server listening on http://127.0.0.1:${port}`);
  });
}

module.exports = { createServer };
