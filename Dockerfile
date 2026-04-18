FROM node:20-alpine
WORKDIR /app

# yt-dlp + ffmpeg (YouTube — spawn "yt-dlp"; konteynerde PATH'te olmalı)
RUN apk add --no-cache ffmpeg python3 ca-certificates curl \
  && curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
  && chmod a+rx /usr/local/bin/yt-dlp \
  && yt-dlp --version

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=3000

CMD ["node", "server.js"]
