const { licenseHandler, sendResult, readNodeRequest } = require("../server/lib/handlers");

module.exports = async (req, res) => {
  sendResult(res, await licenseHandler(await readNodeRequest(req)));
};

module.exports.config = { api: { bodyParser: false } };
