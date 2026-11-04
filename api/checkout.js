const { checkoutHandler, sendResult, readNodeRequest } = require("../server/lib/handlers");

module.exports = async (req, res) => {
  sendResult(res, await checkoutHandler(await readNodeRequest(req)));
};

module.exports.config = { api: { bodyParser: false } };
