export function createRevisionsController({ revisionsService }) {
  return {
    async list(req, res) {
      res.json(await revisionsService.list(req.page, req.valid.query));
    },

    async get(req, res) {
      res.json(await revisionsService.get(req.page, req.params.revId));
    },

    async restore(req, res) {
      const { editSummary } = req.valid.body;
      res.json(await revisionsService.restore(req.page, req.params.revId, req.user, editSummary));
    },
  };
}
