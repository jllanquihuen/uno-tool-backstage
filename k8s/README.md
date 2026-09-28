# Despliegue de Backstage en EKS

Punto de partida: **1 réplica**, **SQLite sobre un PVC** (EBS gp3), **TechDocs local**
sobre el mismo volumen, **Secret** de Kubernetes para los tokens, y **Service + Ingress (ALB)**.

Es un setup para arrancar. Para escalar a varias réplicas hay que migrar a
Postgres (RDS) y a storage compartido (EFS o S3). Ver el final de este documento.

## Archivos

| Archivo | Qué hace |
|---|---|
| `namespace.yaml` | Crea el namespace `backstage` |
| `pvc.yaml` | Disco persistente de 10Gi para `/app/data` |
| `secret.example.yaml` | Plantilla del Secret con los tokens (no subir con valores reales) |
| `deployment.yaml` | El pod de Backstage, monta el volumen, lee el Secret |
| `service.yaml` | Expone el puerto 7007 dentro del cluster |
| `ingress.yaml` | ALB que expone Backstage al exterior |

## Requisitos previos

1. Cluster EKS activo y `kubectl` apuntando a él (`kubectl get nodes` debe responder).
2. **AWS Load Balancer Controller** instalado (para que el Ingress cree el ALB).
   - Verifica: `kubectl get deploy -n kube-system aws-load-balancer-controller`
3. **Almacenamiento EBS** disponible. En EKS Auto Mode la StorageClass es `auto-ebs-sc`
   (ya usada en `pvc.yaml`). NO uses `gp3`: ese provisioner no existe en Auto Mode.
   - Verifica: `kubectl get storageclass`
4. Imagen subida a **ECR** (EKS no puede usar tu imagen local de Docker).

## Paso 1: Subir la imagen a ECR

```bash
# Login
aws ecr get-login-password --region <region> \
  | docker login --username AWS --password-stdin <account>.dkr.ecr.<region>.amazonaws.com

# Crear el repo (una sola vez)
aws ecr create-repository --repository-name backstage --region <region>

# Tag + push (la imagen local ya se llama uno-backstage:local)
docker tag uno-backstage:local <account>.dkr.ecr.<region>.amazonaws.com/backstage:latest
docker push <account>.dkr.ecr.<region>.amazonaws.com/backstage:latest
```

## Paso 2: Ajustar los valores a reemplazar

- `deployment.yaml` → `image:` con la URI real de ECR.
- `ingress.yaml` → `host:` con tu dominio, y el `certificate-arn` de ACM si usas HTTPS.
- `app-config.eks.yaml` (en la raíz del repo) → `baseUrl` con tu dominio.

## Paso 3: Crear el Secret con los tokens

Recomendado por CLI (los tokens no quedan en ningún YAML):

```bash
kubectl create namespace backstage
kubectl create secret generic backstage-secrets \
  --namespace backstage \
  --from-literal=GITHUB_TOKEN=ghp_xxx \
  --from-literal=AUTH_GITHUB_CLIENT_ID=xxx \
  --from-literal=AUTH_GITHUB_CLIENT_SECRET=xxx
```

## Paso 4: Aplicar los manifiestos

```bash
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/pvc.yaml
kubectl apply -f k8s/configmap-app-config.yaml
kubectl apply -f k8s/service.yaml
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/ingress.yaml
```

## Paso 5: Verificar

```bash
kubectl get pods -n backstage
kubectl logs -n backstage deploy/backstage -f
kubectl get ingress -n backstage      # muestra la URL del ALB
```

Cuando el ALB esté listo, apunta tu DNS (Route53) al hostname del ALB y abre tu dominio.

## Sobre app-config.eks.yaml (dominio como variable)

El `baseUrl` DEBE apuntar al dominio real, no a localhost, o el frontend y el
login por GitHub fallan detras del ALB. La solucion aqui NO hardcodea el dominio:

- `app-config.eks.yaml` usa `${BACKSTAGE_BASE_URL}` (Backstage interpola `${VAR}`
  al arrancar).
- Se monta como archivo desde el ConfigMap `backstage-app-config-eks`
  (`k8s/configmap-app-config.yaml`) y se pasa como `--config` extra en los `args`
  del Deployment (ultimo config gana).
- La variable `BACKSTAGE_BASE_URL` vive en el ConfigMap `backstage-config` y se
  inyecta via `envFrom`.

Ventaja: la **misma imagen** sirve para cualquier dominio/ambiente. Para cambiar
el dominio solo editas el ConfigMap `backstage-config` y reinicias el pod
(`kubectl rollout restart deploy/backstage -n backstage`), sin reconstruir imagen.

> El dominio/exposicion aun esta POR DEFINIR: el ConfigMap trae un placeholder
> (`https://backstage.PLACEHOLDER.example.com`). Reemplazarlo por el dominio real
> (debe coincidir con el `host` del Ingress) cuando exista.

## Cuando quieras escalar (más de 1 réplica)

Con el setup actual NO puedes subir `replicas` por encima de 1, porque:

- SQLite es un archivo local, no soporta múltiples escritores.
- El PVC es `ReadWriteOnce` (EBS solo se monta en un nodo a la vez).

Para escalar hay que:

1. Migrar la base de datos a **PostgreSQL (RDS)** → cambiar `database.client` a `pg`.
2. Cambiar el storage de TechDocs a **EFS** (`ReadWriteMany`) o a **S3** (`publisher: awsS3`).

Cuando llegues a ese punto, avísame y adaptamos los manifiestos.
