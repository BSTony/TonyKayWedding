# Author: Tony Hsieh
# Date: 2026-08-27
# Version: 1.3.1
#
# Cloud Run 服務 badminton-server（asia-east1）啟動物理裁判
FROM node:20-slim

WORKDIR /usr/src/app

COPY server/package*.json ./
RUN npm install --only=production

COPY server/ ./

ENV PORT=8080
EXPOSE 8080

CMD ["node", "gameServer.js"]
