import { createApp } from '@backstage/frontend-defaults';
import catalogPlugin from '@backstage/plugin-catalog/alpha';
import { navModule } from './modules/nav';

import cicdStatisticsPlugin from '@backstage-community/plugin-cicd-statistics/alpha';
import cicdStatisticsModuleGithub from '@backstage-community/plugin-cicd-statistics-module-github/alpha';
import githubInsightsPlugin from '@roadiehq/backstage-plugin-github-insights/alpha';

import { unoGithubDeploymentsModule } from './modules/uno-github-deployments';

const app = createApp({
  features: [
    catalogPlugin,
    navModule,

    cicdStatisticsPlugin,
    cicdStatisticsModuleGithub,

    githubInsightsPlugin,

    unoGithubDeploymentsModule,
  ],
});

export default app;
