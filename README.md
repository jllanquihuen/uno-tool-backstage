# uno-tool-backstage

Portal de desarrollador [Backstage](https://backstage.io) de UNO AFP. Monorepo
Yarn (Backstage 1.52.0, Node 22/24) preparado para desplegarse en EKS.

## Estructura

| Ruta | Qué es |
|---|---|
| `packages/app` | Frontend (New Frontend System). Módulos custom en `src/modules/` (nav, uno-github-deployments). |
| `packages/backend` | Backend (`createBackend`). Incluye el módulo custom `scaffolder/copierModule`. El `Dockerfile` vive aquí. |
| `plugins/` | Plugins locales (por ahora los plugins entran como dependencias npm en `packages/*`). |
| `app-config.yaml` | Config base (desarrollo local). |
| `app-config.production.yaml` | Overrides de producción (SQLite en `/app/data`). |
| `app-config.eks.yaml` | Overrides de EKS: `baseUrl`/CORS vía `${BACKSTAGE_BASE_URL}`. |
| `k8s/` | Manifiestos de despliegue en EKS (ver `k8s/README.md`). |
| `.github/workflows/build-push-ecr.yml` | CI: build de imagen + push a ECR vía OIDC. |

## Desarrollo local

```sh
yarn install
yarn start
```

## Build de la imagen (host build)

El `Dockerfile` (en `packages/backend/`) empaqueta el bundle ya construido, así
que primero se compila en el host y luego se arma la imagen:

```sh
yarn install --immutable
yarn tsc
yarn build:backend
docker build -f packages/backend/Dockerfile -t backstage .
```

En CI esto lo hace `.github/workflows/build-push-ecr.yml`, que publica en ECR con
tag = SHA del commit (imagen inmutable). Requiere configurar en el repo:

- Secret `AWS_ROLE_ARN` — rol `github-actions-ecr-push` (OIDC), creado en el repo
  de infra (`terraform/bootstrap`).
- Variables `AWS_REGION` y `ECR_REPOSITORY` (ej. `backstage`).

## Despliegue en EKS

Punto de partida: **1 réplica**, **SQLite sobre PVC** (EBS `auto-ebs-sc`),
**TechDocs local**, **Service + Ingress (ALB)**. El dominio se parametriza vía el
ConfigMap `backstage-config` (`BACKSTAGE_BASE_URL`), no se hornea en la imagen.

Ver **[`k8s/README.md`](k8s/README.md)** para los pasos completos (ECR, Secret,
apply de manifiestos, verificación) y el camino de escalado (Postgres/RDS + S3/EFS).

## Estado y pendientes

- Base de datos: **SQLite** (arranque). Migrar a **PostgreSQL (RDS)** para HA/escala.
- TechDocs: **local**. Migrar a **S3** (`publisher: awsS3`) para varias réplicas.
- Exposición/DNS: **por definir** (el `BACKSTAGE_BASE_URL` y el `host` del Ingress
  traen placeholder hasta entonces).
