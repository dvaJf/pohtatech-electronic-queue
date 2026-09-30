FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
# The development compose setup mounts /app/node_modules as a named volume.
# Keep an image-owned copy so a stale or interrupted volume can be repaired
# without relying on a registry request during container startup.
RUN cp -a node_modules /opt/node_modules
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev"]
