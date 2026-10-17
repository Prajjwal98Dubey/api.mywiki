// npm run seed            → seeds an empty data dir
// npm run seed -- --force → wipes users/pages/revisions first
//
// Creates DemoUser (demo@mywiki.local / demo12345) and three cross-linked pages.
// Uses the real services, so seeded data passes the same validation as the API.

import { loadConfig } from '../src/config/env.js';
import { createRepositories } from '../src/repositories/index.js';
import { createServices } from '../src/routes/index.js';
import { createPageSchema, updatePageSchema } from '../src/validation/page.schemas.js';

const config = loadConfig();
const force = process.argv.includes('--force');

// The demo account has a published password; never create it in production by accident.
if (config.isProduction && !process.argv.includes('--allow-production')) {
  console.error('Refusing to seed demo data with NODE_ENV=production (the demo password is public).');
  console.error('If you really mean it: npm run seed -- --allow-production');
  process.exit(1);
}

// Works with both drivers (STORAGE_DRIVER=json | mongo). A corrupt JSON data file
// makes createRepositories throw, so it is never clobbered.
const repos = await createRepositories(config);
const where = repos.driver === 'mongo' ? `MongoDB database "${config.mongodbDbName}"` : config.dataDir;

if (await repos.hasData()) {
  if (!force) {
    console.error(`Data already exists in ${where}. Re-run with --force to wipe it and reseed:`);
    console.error('  npm run seed -- --force');
    await repos.close();
    process.exit(1);
  }
  await repos.wipe();
  console.log(`Wiped users, pages and revisions in ${where}`);
}

const { authService, pagesService } = createServices({ repos, config });

const { user } = await authService.register({
  username: 'DemoUser',
  email: 'demo@mywiki.local',
  password: 'demo12345',
});

const create = (input) => pagesService.create(createPageSchema.parse(input), user);
const update = async (slug, mutate, editSummary) => {
  const page = await repos.pages.findBySlug(slug);
  const next = structuredClone(page);
  mutate(next);
  return pagesService.update(page, updatePageSchema.parse({ ...next, baseRevisionId: page.currentRevisionId, editSummary }), user);
};

// ---- Jane Doe (full article, 3 revisions) -----------------------------------

const janeRefs = [
  {
    id: 'profile',
    type: 'web',
    title: 'Meet Jane Doe, the engineer behind Lumen',
    url: 'https://example.com/meet-jane-doe',
    author: 'A. Writer',
    publisher: 'Example News',
    date: '2024-05-01',
    accessDate: '2026-10-15',
  },
  {
    id: 'hire',
    type: 'news',
    title: 'Startup hires young open-source developer',
    url: 'https://example.com/news/startup-hires',
    author: '',
    publisher: 'Daily Example',
    date: '2020-02-10',
    accessDate: '2026-10-15',
  },
  {
    id: 'book',
    type: 'book',
    title: 'Builders of the Open Web',
    url: '',
    author: 'R. Historian',
    publisher: 'Example Press',
    date: '2025',
    accessDate: '',
  },
  {
    id: 'award',
    type: 'web',
    title: 'Open Source Awards 2025: the winners',
    url: 'https://example.org/awards/2025',
    author: '',
    publisher: 'Open Source Example Foundation',
    date: '2025-11-20',
    accessDate: '2026-10-15',
  },
];

await create({
  title: 'Jane Doe',
  shortDescription: 'Indian software engineer (born 1998)',
  infobox: {
    name: '',
    image: null,
    birthDate: '1998-03-15',
    birthPlace: '[[Mumbai]], India',
    deathDate: null,
    deathPlace: '',
    fields: [
      { label: 'Occupation', value: 'Software engineer' },
      { label: 'Nationality', value: 'Indian' },
      { label: 'Education', value: '[[Atlantis Institute]] (B.Tech)' },
      { label: 'Years active', value: '2019–present' },
      { label: 'Known for', value: "''Lumen'' build tool" },
    ],
  },
  lead:
    "'''Jane Doe''' (born 15 March 1998) is an Indian software engineer known for her work on open-source developer tooling.{{cite|profile}}",
  sections: [
    {
      heading: 'Early life and education',
      level: 2,
      content:
        'Doe was born in [[Mumbai]] and grew up writing small games on a shared family computer.{{cite|profile}}\n\nShe studied computer science at the [[Atlantis Institute]], graduating in 2019.',
    },
    {
      heading: 'Career',
      level: 2,
      content:
        'In 2020 Doe joined a developer-tools startup as its first engineer.{{cite|hire}} There she worked closely with [[John Doe]].',
    },
  ],
  references: janeRefs.slice(0, 2),
  seeAlso: ['John Doe'],
  externalLinks: [{ label: 'Official website', url: 'https://janedoe.example' }],
  categories: ['Living people', '1998 births'],
});

await update(
  'jane-doe',
  (p) => {
    p.sections.push(
      {
        heading: 'Lumen',
        level: 3,
        content:
          "In 2022 she released ''Lumen'', a fast incremental build tool.{{cite|book}}\n\n* Written in Rust\n* Used by thousands of projects\n* Inspired by the work of [[Ada Example]]",
      },
      {
        heading: 'Teaching',
        level: 3,
        content: 'Doe runs free weekend workshops on compilers for students.{{cite|profile}}',
      },
    );
    p.references.push(janeRefs[2]);
    p.seeAlso.push('Ada Example');
  },
  'Added career subsections on Lumen and teaching',
);

await update(
  'jane-doe',
  (p) => {
    p.sections.push(
      {
        heading: 'Personal life',
        level: 2,
        content: 'Doe lives in [[Bengaluru]]. She is an avid long-distance runner.',
      },
      {
        heading: 'Awards and honours',
        level: 2,
        content:
          '# Open Source Award, 2025{{cite|award}}\n# Young Engineer of the Year, 2023{{cite|book}}',
      },
      {
        heading: 'Recognition',
        level: 3,
        content: "Her work has been described as ''quietly foundational''.{{cite|award}}",
      },
    );
    p.references.push(janeRefs[3]);
    p.categories.push('Indian software engineers', 'Open-source developers');
    p.externalLinks.push({ label: 'Lumen project', url: 'https://lumen.example' });
  },
  'Added personal life and awards',
);

// ---- John Doe (medium) -------------------------------------------------------

await create({
  title: 'John Doe',
  shortDescription: 'British civil engineer (born 1990)',
  infobox: {
    name: 'John A. Doe',
    image: null,
    birthDate: '1990',
    birthPlace: 'Leeds, England',
    deathDate: null,
    deathPlace: '',
    fields: [
      { label: 'Occupation', value: 'Civil engineer' },
      { label: 'Known for', value: 'Bridge design' },
    ],
  },
  lead:
    "'''John Doe''' (born 1990) is a British civil engineer and occasional software developer who has collaborated with [[Jane Doe]].{{cite|j1}}",
  sections: [
    {
      heading: 'Career',
      level: 2,
      content:
        'Doe designed several pedestrian bridges before moving into software for structural analysis.{{cite|j1}}',
    },
    {
      heading: 'Collaboration with Jane Doe',
      level: 3,
      content: 'In 2020 he co-founded a tooling project with [[Jane Doe|his namesake]].{{cite|j2}}',
    },
  ],
  references: [
    {
      id: 'j1',
      type: 'web',
      title: 'John Doe — speaker profile',
      url: 'https://example.com/speakers/john-doe',
      author: '',
      publisher: 'Example Conf',
      date: '2023-06-01',
      accessDate: '2026-10-15',
    },
    {
      id: 'j2',
      type: 'news',
      title: 'Two Does, one project',
      url: 'https://example.com/news/two-does',
      author: 'B. Reporter',
      publisher: 'Daily Example',
      date: '2020-09-12',
      accessDate: '2026-10-15',
    },
  ],
  seeAlso: ['Jane Doe', 'Ada Example'],
  externalLinks: [],
  categories: ['Living people', '1990 births', 'British civil engineers'],
});

// ---- Ada Example (minimal) ---------------------------------------------------

await create({
  title: 'Ada Example',
  shortDescription: 'Fictional mathematician',
  lead: "'''Ada Example''' is a fictional mathematician whose notes inspired [[Jane Doe]].",
  categories: ['Fictional mathematicians'],
});

await repos.close();
console.log(`Seeded MyWiki (${where}):`);
console.log('  user  DemoUser  demo@mywiki.local / demo12345');
console.log('  pages jane-doe (3 revisions), john-doe, ada-example');
