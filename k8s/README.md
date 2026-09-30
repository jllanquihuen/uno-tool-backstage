# Despliegue de Backstage en EKS

Punto de partida: **1 réplica**, **SQLite sobre un PVC** (EBS gp3), **TechDocs local**
sobre el mismo volumen, **Secret** de Kubernetes para los tokens, y **Service ClusterIP**.

**Exposición externa:** el workload queda ClusterIP (mismo principio que Grafana);
la exposición externa NO la impone la app y se define aparte cuando exista
dominio/conectividad. La plantilla de Ingress vive en `k8s/optional/ingress.yaml`
y NO se aplica por defecto (ver "Exposición externa" más abajo).

## Archivos

| Archivo | Qué hace |
|---|---|
| `namespace.yaml` | Crea el namespace `backstage` |
| `pvc.yaml` | Disco persistente de 10Gi para `/app/data` |
| `secret.example.yaml` | Plantilla del Secret con los tokens (no subir con valores reales) |
| `deployment.yaml` | El pod de Backstage, monta el volumen, lee el Secret |
| `service.yaml` | Service ClusterIP (puerto 7007 dentro del cluster) |
| `configmap-app-config.yaml` | ConfigMaps: app-config.eks + BACKSTAGE_BASE_URL |
| `optional/ingress.yaml` | Plantilla de exposición externa (ALB). NO se aplica por defecto |

## Requisitos previos

1. Cluster EKS activo y `kubectl` apuntando a él (`kubectl get nodes` debe responder).
2. **StorageClass `auto-ebs-sc`** disponible (la crea el stack de infra, módulo
   `storage_class`; `pvc.yaml` la usa). Verifica: `kubectl get storageclass`.
3. Imagen subida a **ECR** (EKS no puede usar tu imagen local de Docker).
4. (Solo si se expone externamente) **AWS Load Balancer Controller** u otro
   controlador de ingreso — ver "Exposición externa".

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
- `app-config.eks.yaml` (raíz del repo) usa `${BACKSTAGE_BASE_URL}` del ConfigMap
  `backstage-config` (no se hardcodea el dominio).

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
# NOTA: el Ingress (k8s/optional/) NO se aplica aquí: el workload queda ClusterIP.
```

## Exposición externa (opcional, por definir)

Mismo principio que Grafana: la app queda **ClusterIP** y la exposición externa
se define aparte, por entorno, cuando exista dominio + DNS + certificado + un
controlador de ingreso decidido (ALB Ingress Controller o Gateway API).

Mientras no esté definido, para acceder en pruebas usa **port-forward**:
```bash
kubectl port-forward -n backstage svc/backstage 7007:80   # http://localhost:7007
```

Cuando la exposición esté definida, edita y aplica la plantilla:
```bash
kubectl apply -f k8s/optional/ingress.yaml   # tras ajustar host + certificate-arn
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

## Nota sobre escala (fuera de alcance)

Este despliegue es **1 réplica a propósito**: SQLite es un archivo local (un solo
escritor) y el PVC es `ReadWriteOnce` (EBS se monta en un nodo a la vez). Es el
modelo definitivo para este alcance.

Escalar a varias réplicas (que exigiría Postgres/RDS y storage compartido S3/EFS)
**no está contemplado**; sería una decisión de un futuro lejano solo si aparece una
necesidad real de HA. No mantener `replicas > 1` con este setup.
