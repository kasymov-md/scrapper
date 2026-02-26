FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

RUN npx playwright install --with-deps chromium

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

EXPOSE 8080

CMD ["npm", "run", "start"]
