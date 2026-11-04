let app;
let initError = null;

try {
  app = require("../dist/app").default;
} catch (err) {
  initError = err;
  console.error("[vercel-init-error]", err);
}

module.exports = (req, res) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-csrf-token, X-Requested-With, Accept, Origin");
  }

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (initError) {
    return res.status(500).json({
      error: "Backend Initialization Failed",
      message: initError.message,
      stack: initError.stack,
    });
  }

  return app(req, res);
};
