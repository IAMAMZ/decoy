# Cloud Run image: the built page plus backend/server.py (headless Chrome, /browser, /api/boson).
FROM node:20-slim AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM python:3.12-slim
WORKDIR /app
COPY backend/requirements.txt backend/
RUN pip install --no-cache-dir -r backend/requirements.txt \
 && playwright install --with-deps chrome
COPY backend backend
COPY --from=web /app/dist dist
ENV HOST=0.0.0.0 PORT=8080
CMD ["python", "backend/server.py"]
