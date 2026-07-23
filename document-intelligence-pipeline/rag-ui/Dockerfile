FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

# Changed npm ci -> npm install
RUN npm config set fetch-retry-maxtimeout 600000 && \
    npm install

COPY . .

RUN npm run build

EXPOSE 3000

CMD ["npm", "run", "start"]