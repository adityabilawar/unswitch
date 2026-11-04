const { uninstallHandler, sendResult, readNodeRequest } = require("../server/lib/handlers");

module.exports = async (req, res) => {
  sendResult(res, uninstallHandler(await readNodeRequest(req)));
};
