const { activateHandler, sendResult, readNodeRequest } = require("../server/lib/handlers");

module.exports = async (req, res) => {
  sendResult(res, await activateHandler(await readNodeRequest(req)));
};
