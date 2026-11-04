const { webhookHandler, sendResult, readNodeRequest } = require("../server/lib/handlers");

module.exports = async (req, res) => {
  sendResult(res, await webhookHandler(await readNodeRequest(req)));
};

module.exports.config = { api: { bodyParser: false } };
