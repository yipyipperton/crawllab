FROM mcr.microsoft.com/playwright:v1.65.1-noble

WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV HOST=0.0.0.0
ENV PORT=43123
ENV HEADLESS=true
ENV NODE_ENV=development

COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 43123
CMD ["node", "dist/api/main.js"]
