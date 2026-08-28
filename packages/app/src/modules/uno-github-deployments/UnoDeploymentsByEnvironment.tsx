import React from 'react';
import { useApi, githubAuthApiRef } from '@backstage/core-plugin-api';
import { useEntity } from '@backstage/plugin-catalog-react';
import { Progress, ResponseErrorPanel } from '@backstage/core-components';
import {
  Box,
  Chip,
  Link,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@material-ui/core';

type Deployment = {
  id: number;
  environment: string;
  ref: string;
  sha: string;
  created_at: string;
  updated_at: string;
  statuses_url: string;
  creator?: { login?: string };
};

type DeploymentStatus = {
  state: string;
  created_at: string;
  updated_at: string;
  log_url?: string;
  target_url?: string;
  environment_url?: string;
};

type Row = {
  deployment: Deployment;
  status?: DeploymentStatus;
};

type AheadBehind = {
  status?: string;
  ahead_by?: number;
  behind_by?: number;
  html_url?: string;
};

function parseProjectSlug(slug?: string) {
  if (!slug) return undefined;
  const [owner, repo] = slug.split('/');
  if (!owner || !repo) return undefined;
  return { owner, repo };
}

function statusColor(state?: string): 'default' | 'primary' | 'secondary' {
  if (state === 'success') return 'primary';
  if (state === 'failure' || state === 'error') return 'secondary';
  return 'default';
}

function shortDate(value?: string) {
  if (!value) return '-';
  return new Date(value).toLocaleString();
}

function deploymentLink(row: Row) {
  return (
    row.status?.target_url ||
    row.status?.log_url ||
    row.status?.environment_url ||
    undefined
  );
}

export function UnoDeploymentsByEnvironment() {
  const { entity } = useEntity();
  const githubAuthApi = useApi(githubAuthApiRef);

  const [rows, setRows] = React.useState<Row[]>([]);
  const [compare, setCompare] = React.useState<AheadBehind>();
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<Error>();

  React.useEffect(() => {
    async function load() {
      try {
        setLoading(true);

        const slug = entity.metadata.annotations?.['github.com/project-slug'];
        const parsed = parseProjectSlug(slug);

        if (!parsed) {
          throw new Error('La entidad no tiene github.com/project-slug válido');
        }

        const token = await githubAuthApi.getAccessToken(['repo']);

        const deploymentsResp = await fetch(
          `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/deployments?per_page=100`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: 'application/vnd.github+json',
              'X-GitHub-Api-Version': '2022-11-28',
            },
          },
        );

        if (!deploymentsResp.ok) {
          throw new Error(
            `GitHub deployments API respondió ${deploymentsResp.status}`,
          );
        }

        const deployments: Deployment[] = await deploymentsResp.json();

        const latestByEnv = new Map<string, Deployment>();

        for (const deployment of deployments) {
          if (!latestByEnv.has(deployment.environment)) {
            latestByEnv.set(deployment.environment, deployment);
          }
        }

        const result: Row[] = await Promise.all(
          Array.from(latestByEnv.values()).map(async deployment => {
            const statusesResp = await fetch(deployment.statuses_url, {
              headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28',
              },
            });

            if (!statusesResp.ok) {
              return { deployment };
            }

            const statuses: DeploymentStatus[] = await statusesResp.json();

            return {
              deployment,
              status: statuses[0],
            };
          }),
        );

        result.sort((a, b) =>
          a.deployment.environment.localeCompare(b.deployment.environment),
        );

        setRows(result);

        const qa = result.find(r => r.deployment.environment === 'qa');
        const prod = result.find(r => r.deployment.environment === 'prod');

        if (qa && prod && qa.deployment.sha !== prod.deployment.sha) {
          const compareResp = await fetch(
            `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/compare/${prod.deployment.sha}...${qa.deployment.sha}`,
            {
              headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28',
              },
            },
          );

          if (compareResp.ok) {
            setCompare(await compareResp.json());
          }
        } else {
          setCompare(undefined);
        }
      } catch (e) {
        setError(e as Error);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [entity, githubAuthApi]);

  if (loading) return <Progress />;
  if (error) return <ResponseErrorPanel error={error} />;

  return (
    <Box p={3}>
      <Typography variant="h4" gutterBottom>
        Deployments por ambiente
      </Typography>

      {compare && (
        <Box mb={3}>
          <Paper style={{ padding: 16 }}>
            <Typography variant="h6">Comparación QA vs PROD</Typography>

            <Typography>
              QA está <strong>{compare.ahead_by ?? 0}</strong> commits adelante
              de PROD y <strong>{compare.behind_by ?? 0}</strong> commits atrás.
            </Typography>

            {compare.html_url && (
              <Link href={compare.html_url} target="_blank" rel="noreferrer">
                Ver comparación en GitHub
              </Link>
            )}
          </Paper>
        </Box>
      )}

      <Paper>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Ambiente</TableCell>
              <TableCell>Estado</TableCell>
              <TableCell>Fecha</TableCell>
              <TableCell>Ref</TableCell>
              <TableCell>SHA</TableCell>
              <TableCell>Usuario</TableCell>
              <TableCell>Workflow / Log</TableCell>
            </TableRow>
          </TableHead>

          <TableBody>
            {rows.map(row => {
              const { deployment, status } = row;
              const link = deploymentLink(row);

              return (
                <TableRow key={deployment.environment}>
                  <TableCell>
                    <strong>{deployment.environment}</strong>
                  </TableCell>

                  <TableCell>
                    <Chip
                      label={status?.state ?? 'sin status'}
                      color={statusColor(status?.state)}
                      size="small"
                    />
                  </TableCell>

                  <TableCell>
                    {shortDate(status?.updated_at || deployment.updated_at)}
                  </TableCell>

                  <TableCell>{deployment.ref}</TableCell>

                  <TableCell>
                    <code>{deployment.sha.slice(0, 7)}</code>
                  </TableCell>

                  <TableCell>{deployment.creator?.login ?? '-'}</TableCell>

                  <TableCell>
                    {link ? (
                      <Link href={link} target="_blank" rel="noreferrer">
                        abrir
                      </Link>
                    ) : (
                      '-'
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Paper>
    </Box>
  );
}
