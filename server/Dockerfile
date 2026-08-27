# Author: Tony Hsieh
# Date: 2026-08-27
# Version: 1.2.0
#
# Google Cloud Run 建議：
#   gcloud run deploy badminton-physics --source . --project tonykaywendding --region asia-southeast1 \
#     --min-instances 1 --max-instances 1 --no-cpu-throttling --session-affinity \
#     --timeout 3600 --port 8080 --allow-unauthenticated
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

EXPOSE 8080

CMD ["node", "gameServer.js"]
