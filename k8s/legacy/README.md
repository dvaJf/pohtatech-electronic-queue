# Legacy Kubernetes Manifests (ARCHIVE / REFERENCE ONLY)

> ⚠️ **ВНИМАНИЕ: НЕ ПРИМЕНЯТЬ ЭТИ ФАЙЛЫ В PRODUCTION!**

Данные манифесты перенесены в архив, так как они дублируют ресурсы, управляемые Helm-чартом `helm/queue-chart`.

Единственным источником истины (**Single Source of Truth**) для production является:
👉 `helm/queue-chart/`

ArgoCD Application `queue-system` отслеживает именно путь `helm/queue-chart` в репозитории.
Применение файлов из этой папки вручную (`kubectl apply -f k8s/legacy/`) нарушит GitOps-синхронизацию и приведет к конфликтам версий с ArgoCD.
