export function createSearchController({ searchService }) {
  return {
    async suggest(req, res) {
      const { q, limit } = req.valid.query;
      res.json(await searchService.suggest(q, limit));
    },

    async search(req, res) {
      const { q, limit, offset } = req.valid.query;
      res.json(await searchService.search(q, limit, offset));
    },
  };
}
