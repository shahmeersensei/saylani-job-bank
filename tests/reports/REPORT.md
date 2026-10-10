# Consolidated Test Report

> Generated: 2026-10-10T15:08:36.089Z · Branch: `test/api-and-ui-test-suites`
> Sab kuch ek jagah: QA (functional) + Load (API/Web/DB) + Security.

## Index

- [QA Report](../../QA_REPORT.md) — functional defects (12)
- Load: API / Web / DB (summary below, HTML artefacts in this folder)
- Security: npm audit + retire.js (summary below)

## 1. Load — API (Artillery)

- **API**
  - requests: n/a (failed: 0)
  - status codes: n/a
  - latency p50/p95/p99: n/a / n/a / n/a
  - errors: none
  - artefacts: `load-api.html`

## 2. Load — Web (Artillery)

- **Web**
  - requests: n/a (failed: 0)
  - status codes: n/a
  - latency p50/p95/p99: n/a / n/a / n/a
  - errors: none
  - artefacts: `load-web.html`

## 3. Load — DB (direct Postgres)

```
��p�n�p�m�.�e�x�e� �:� �$� �n�o�d�e� �t�e�s�t�s�/�d�b�-�t�e�s�t�.�j�s�
�
�A�t� �C�:�\�n�v�m�4�w�\�n�o�d�e�j�s�\�p�n�p�m�.�p�s�1�:�1�4� �c�h�a�r�:�3�
�
�+� � � �&� �"�$�b�a�s�e�d�i�r�/�n�o�d�e�_�m�o�d�u�l�e�s�/�p�n�p�m�/�p�n�p�m�.�e�x�e�"� � � �$�a�r�g�s�
�
�+� � � �~�~�~�~�~�~�~�~�~�~�~�~�~�~�~�~�~�~�~�~�~�~�~�~�~�~�~�~�~�~�~�~�~�~�~�~�~�~�~�~�~�~�~�~�~�~�~�
�
� � � � �+� �C�a�t�e�g�o�r�y�I�n�f�o� � � � � � � � � � �:� �N�o�t�S�p�e�c�i�f�i�e�d�:� �(�$� �n�o�d�e� �t�e�s�t�s�/�d�b�-�t�e�s�t�.�j�s�:�S�t�r�i�n�g�)� �[�]�,� �R�e�m�o�t�e�E�x�c�e�p�t�i�o�n�
�
� � � � �+� �F�u�l�l�y�Q�u�a�l�i�f�i�e�d�E�r�r�o�r�I�d� �:� �N�a�t�i�v�e�C�o�m�m�a�n�d�E�r�r�o�r�
�
� �
�
�c�o�n�n�e�c�t�e�d�:� �P�o�s�t�g�r�e�S�Q�L� �1�6�.�4�
�
�
�
�=�=�=� �D�B� �s�t�r�e�s�s� �r�e�s�u�l�t�s� �(�m�s�)� �=�=�=�
�
�r�e�a�d�s� � �x�2�0�0�:� � �p�5�0�=�2�.�7� � �p�9�5�=�8�.�4� � �p�9�9�=�1�8�.�9� � �a�v�g�=�3�.�8� � �m�a�x�=�5�9�.�7�
�
�w�r�i�t�e�s� �x�1�0�0�:� � �p�5�0�=�3�.�3� � �p�9�5�=�1�5�.�7� � �p�9�9�=�1�9�.�9� � �a�v�g�=�4�.�8� � �m�a�x�=�1�9�.�9�
�
�
�
�v�e�r�d�i�c�t�:� �P�A�S�S� �(�p�9�5� �w�i�t�h�i�n� �b�u�d�g�e�t�:� �r�e�a�d�s�<�2�0�0�m�s�,� �w�r�i�t�e�s�<�3�0�0�m�s�)�
�
�
```

## 4. Security

- **audit-ci**: run via `pnpm test:security` (fails on moderate+ advisories).
- **retire.js**: not run (no JSON found)

## How to reproduce

```bash
pnpm infra:up && pnpm db:migrate && pnpm db:seed   # once
pnpm --filter @jobbank/web build && pnpm --filter @jobbank/web start &  # server for load tests
pnpm test:api-load      # API load → load-api.html
pnpm test:web-load      # Web load → load-web.html
pnpm test:db-load       # DB stress → db-stress.txt
pnpm test:security      # audit-ci + retire
pnpm test:reports       # regenerate this file
```

> Scope: **testing only**. Developers fix the findings; QA does not change product code.
