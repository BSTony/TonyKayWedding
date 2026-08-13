FROM node:20-slim

# 建立應用程式目錄
WORKDIR /usr/src/app

# 安裝應用程式依賴套件
# 確保 package.json 和 package-lock.json 都被複製
COPY package*.json ./

RUN npm install --only=production

# 複製應用程式程式碼
COPY . .

# 綁定 Google Cloud Run 預設的 8080 port
ENV PORT=8080
EXPOSE 8080

# 啟動應用程式
CMD ["npm", "start"]
