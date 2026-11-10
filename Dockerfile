FROM node:22-alpine
WORKDIR /app
COPY server.mjs profile.md ./
COPY public ./public
ENV PORT=80
EXPOSE 80
CMD ["node", "server.mjs"]
