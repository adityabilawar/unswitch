const { healthHandler, sendResult } = require("../server/lib/handlers");

module.exports = async (_req, res) => {
  sendResult(res, healthHandler());
};
