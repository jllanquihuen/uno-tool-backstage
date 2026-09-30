# Despliegue de Backstage en EKS

Guía operativa completa para construir la imagen, publicarla en ECR y desplegar
Backstage en el cluster EKS. Cubre requisitos, pasos, acceso y troubleshooting.

El despliegue es **manual** (workflows `workflow_dispatch`): un flujo
**build → push a ECR → deploy al cluster**. La infraestructura base (cluster,
ECR, roles IAM, StorageClass, access entries) vive en el repo de infra
`uno-infra-ks8-platform`; este repo (la app) aporta el código, los manifiestos
`k8s/` y los dos workflows.

---

## Arquitectura del flujo

```
push manual "Build & Push"        ECR (cuenta de la plataforma)
  OIDC → github-actions-ecr-push  ─────►  backstage:<sha>
  yarn build + docker build                 │
                                            │ pull mismo-cuenta (node role)
push manual "Deploy to EKS"                 ▼
  OIDC → github-actions-backstage-deploy   EKS ns "backstage"
  kubectl apply k8s/ + set image           pod Running
```

- **Build/push**: rol OIDC `github-actions-ecr-push` (least-privilege: solo push a ECR).
- **Deploy**: rol OIDC `github-actions-backstage-deploy` (least-privilege: RBAC
  **solo en el namespace `backstage`**, vía EKS access entry namespace-scoped).

---

## Requisitos previos

### En el repo de infra (`uno-infra-ks8-platform`), ya aplicado

| Recurso | Stack | Detalle |
| --- | --- | --- |
| Cluster EKS + plataforma base | `bootstrap → vpc → infra` | El cluster existe y corre |
| **StorageClass `auto-ebs-sc`** | `terraform_platform_infra` (módulo `storage_class`) | gp3, cifrada, default. Sin ella los PVCs quedan `Pending` |
| Repo ECR `backstage` | `terraform_ecr` | `IMMUTABLE_WITH_EXCLUSION`, scan on push |
| Rol de push `github-actions-ecr-push` | `bootstrap` | Trust OIDC a este repo |
| Rol de deploy `github-actions-backstage-deploy` | `bootstrap` (`namespace_deployers`) | Trust OIDC a este repo |
| Access entry namespace-scoped | `terraform_platform_infra` (`namespace_access_entries`) | RBAC del rol de deploy limitado al ns `backstage` |

### En el cluster (una sola vez, con acceso admin)

El rol de deploy es namespace-scoped y NO puede crear el Namespace ni el Secret.
Estos se crean una vez con `kubectl` admin:

```bash
aws eks update-kubeconfig --name prod-cluster --region us-east-1

# 1. Namespace (cluster-scoped, fuera del alcance del rol de deploy)
kubectl apply -f k8s/namespace.yaml

# 2. Secret con los tokens (ver "Auth y secretos" más abajo)
kubectl create secret generic backstage-secrets \
  --namespace backstage \
  --from-literal=GITHUB_TOKEN=<token> \
  --from-literal=AUTH_GITHUB_CLIENT_ID=<id> \
  --from-literal=AUTH_GITHUB_CLIENT_SECRET=<secret>
```

> **Prod:** el Secret debería venir de AWS Secrets Manager vía External Secrets
> Operator (ya instalado en el cluster), no de `kubectl create secret`.

### Variables/Secrets de GitHub (Settings → Secrets and variables → Actions)

Todas como **Variables** (el ARN de un rol no es secreto; el acceso lo controla el
trust OIDC):

| Nombre | Valor de ejemplo | Usado por |
| --- | --- | --- |
| `AWS_ROLE_ARN` | `arn:aws:iam::618529336528:role/afp-uno/eks/github-actions-ecr-push` | build |
| `AWS_DEPLOY_ROLE_ARN` | `arn:aws:iam::618529336528:role/afp-uno/eks/github-actions-backstage-deploy` | deploy |
| `AWS_REGION` | `us-east-1` | build + deploy |
| `EKS_CLUSTER_NAME` | `prod-cluster` | deploy |
| `ECR_REPOSITORY` | `backstage` | build + deploy |

> **OIDC subject con IDs:** las cuentas personales (p. ej. `jllanquihuen`) emiten
> el `sub` con IDs inmutables (`repo:owner@<id>/repo@<id>:ref:...`). Si el
> assume-role falla con `Not authorized to perform sts:AssumeRoleWithWebIdentity`,
> hay que registrar ese `sub` en el trust del rol (variables del bootstrap
> `CI_ECR_PUSH_SUBJECT_CLAIMS_PROD` / `NAMESPACE_DEPLOYERS_PROD`) y re-aplicar.

---

## Paso a paso

### 1. Construir y publicar la imagen

**Actions → "Build & Push Backstage image to ECR" → Run workflow.**

Hace host build (`yarn install --immutable` + `tsc` + `build:backend`) +
`docker build` con `packages/backend/Dockerfile` + push a ECR con **tag = SHA
corto (12)** del commit.

Verifica el tag publicado:
```bash
aws ecr list-images --repository-name backstage --region us-east-1 \
  --query 'imageIds[].imageTag' --output table
```

### 2. Desplegar al cluster

**Actions → "Deploy Backstage to EKS" → Run workflow.**

- Input `image_tag`: **pon el tag que existe en ECR** (paso 1). Si lo dejas vacío,
  el workflow usa el SHA del commit actual — que puede NO coincidir con el de la
  imagen construida (ver troubleshooting `ImagePullBackOff`).

El workflow asume el rol de deploy, aplica `k8s/` en el namespace `backstage`
(configmap, pvc, service, deployment, ingress — **no** namespace.yaml) y hace
`set image` + `rollout status`.

### 3. Verificar

```bash
kubectl get pods -n backstage           # debe quedar Running 1/1
kubectl logs -n backstage deploy/backstage --tail=50
```

---

## Acceso

### Prueba local (port-forward)

Sin dominio ni Ingress. Requiere que el `baseUrl` apunte a localhost:

```bash
kubectl patch configmap backstage-config -n backstage --type merge \
  -p '{"data":{"BACKSTAGE_BASE_URL":"http://localhost:7007"}}'
kubectl rollout restart deploy/backstage -n backstage

kubectl port-forward -n backstage svc/backstage 7007:80
# abrir http://localhost:7007  (login: Guest)
```

### Producción (Ingress + dominio)

El `k8s/ingress.yaml` crea un ALB. Requiere: AWS Load Balancer Controller en el
cluster, un dominio real, certificado ACM, y que `BACKSTAGE_BASE_URL` (ConfigMap
`backstage-config`) y el `host` del Ingress coincidan con ese dominio.

---

## Auth y secretos

El `app-config.production.yaml` declara el provider `github`, que **exige**
`AUTH_GITHUB_CLIENT_ID` y `AUTH_GITHUB_CLIENT_SECRET`. Sin esas keys, el plugin
`auth` crashea y el backend no arranca (readiness 503).

Opciones:
- **Guest para probar:** poner valores dummy en esas keys → el backend arranca,
  entras con Guest (el login GitHub no funciona).
- **Login GitHub real:** crear una GitHub OAuth App y usar sus clientId/secret.
- **Solo guest definitivo:** quitar el bloque `auth.providers.github` de
  `app-config.production.yaml`.

---

## Troubleshooting (errores reales vistos)

| Síntoma | Causa | Solución |
| --- | --- | --- |
| PVC `Pending`: `StorageClass "auto-ebs-sc" not found` | La StorageClass no existe en el cluster | Aplicar el stack de infra (módulo `storage_class`). Verificar `kubectl get storageclass` |
| `ImagePullBackOff`: `...backstage:<tag> not found` | El tag desplegado no existe en ECR (deploy calculó un SHA distinto al del build) | Desplegar con `image_tag` = un tag real (`aws ecr list-images`) |
| Readiness `503` (liveness 200) + `Missing config auth.providers.github.development.clientId` | Falta `AUTH_GITHUB_CLIENT_ID/SECRET` en el Secret | Agregar esas keys (dummy para guest, reales para OAuth) |
| Readiness `503` + warn `backend.baseUrl localhost` | `BACKSTAGE_BASE_URL` con placeholder | Ajustar el ConfigMap `backstage-config` (localhost para port-forward, dominio para prod) + rollout restart |
| `sts:AssumeRoleWithWebIdentity` denegado | Subject OIDC con IDs no registrado en el trust | Registrar el `sub` con IDs en el rol (vars del bootstrap) y re-aplicar |
| `Could not load credentials` (falta `role-to-assume`) | La var del ARN llegó vacía al workflow | Verificar que la GH Var/Secret existe con el nombre exacto que lee el workflow |

---

## Estado actual y pendientes para producción

Lo validado corre con **SQLite sobre PVC + TechDocs local, 1 réplica** (modelo
definitivo de este alcance; Postgres/S3 no se contemplan). Pendientes antes de
prod, hoy resueltos con parches manuales en vivo:

1. **Dominio real** para `BACKSTAGE_BASE_URL` + Ingress (hoy localhost/port-forward).
2. **Auth GitHub real** (hoy dummy) o quitar el provider si solo se usa guest.
3. **Secret vía External Secrets Operator** desde AWS Secrets Manager (hoy `kubectl`).
4. **Tag del deploy**: encadenar build→deploy o exigir `image_tag` explícito (hoy
   el default puede apuntar a un tag inexistente).

> Los `kubectl patch` de la prueba (baseUrl, secret) son cambios en vivo, NO en el
> repo: se pierden en un redeploy. Llevar al código/ESO lo que corresponda.
