import { createFrontendModule } from '@backstage/frontend-plugin-api';
import { EntityContentBlueprint } from '@backstage/plugin-catalog-react/alpha';

const unoDeploymentsContent = EntityContentBlueprint.make({
  name: 'uno-deployments-by-environment',
  params: {
    path: '/uno-deployments',
    title: 'Deployments',
    group: 'deployment',
    filter: entity => entity.kind === 'Component',
    loader: async () =>
      import('./UnoDeploymentsByEnvironment').then(m => (
        <m.UnoDeploymentsByEnvironment />
      )),
  },
});

export const unoGithubDeploymentsModule = createFrontendModule({
  pluginId: 'catalog',
  extensions: [unoDeploymentsContent],
});
