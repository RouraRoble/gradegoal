/**
 * Product-level configuration. Every product edits this file.
 * Keep values honest: they end up in metadata, structured data and legal pages.
 */
export const site = {
  name: 'GradeGoal',
  slug: 'gradegoal',
  tagline: 'What do I need on my final? Instant grade & GPA answers.',
  description:
    'Free final grade calculator, weighted grade book and GPA planner. Type your scores, get the exact grade you need, and share the result — no sign-up required.',
  locale: 'en',
  ogLocale: 'en_US',
  themeColor: '#211d4f',
  backgroundColor: '#fbfaf7',
  accent: '#4f46e5',
  author: { name: 'RouraRoble', url: 'https://github.com/RouraRoble' },
  contactEmail: 'roura.roble@gmail.com',
  launched: '2026-09-23',
  category: 'EducationalApplication', // schema.org SoftwareApplication applicationCategory
  keywords: [
    'final grade calculator',
    'what do i need on my final',
    'grade calculator',
    'weighted grade calculator',
    'gpa calculator',
    'cumulative gpa calculator',
    'gpa scale',
    'cgpa to percentage',
  ] as string[],
  social: { twitter: '' },
  // Monetization / analytics hooks (all optional, env-driven at build time)
  adsenseClient: import.meta.env.PUBLIC_ADSENSE_CLIENT || '',
  beaconUrl: import.meta.env.PUBLIC_BEACON_URL || '',
  plausibleDomain: import.meta.env.PUBLIC_PLAUSIBLE_DOMAIN || '',
};
export type SiteConfig = typeof site;
