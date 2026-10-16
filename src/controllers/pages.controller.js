import { notFound } from '../lib/errors.js';

export function createPagesController({ pagesService }) {
  return {
    async list(req, res) {
      res.json(await pagesService.list(req.valid.query));
    },

    async mine(req, res) {
      res.json(await pagesService.listMine(req.user));
    },

    async count(_req, res) {
      res.json(await pagesService.count());
    },

    async random(_req, res) {
      const result = await pagesService.random();
      if (!result) throw notFound('There are no pages yet');
      res.set('Cache-Control', 'no-store');
      res.json(result);
    },

    async slugCheck(req, res) {
      res.json(await pagesService.slugCheck(req.valid.query.title));
    },

    async create(req, res) {
      res.status(201).json(await pagesService.create(req.valid.body, req.user));
    },

    async get(req, res) {
      res.json(await pagesService.get(req.page, req.user));
    },

    summary(req, res) {
      res.json(pagesService.summary(req.page));
    },

    async update(req, res) {
      res.json(await pagesService.update(req.page, req.valid.body, req.user));
    },

    async settings(req, res) {
      res.json(await pagesService.updateSettings(req.page, req.valid.body));
    },

    async remove(req, res) {
      await pagesService.remove(req.page);
      res.status(204).end();
    },
  };
}
